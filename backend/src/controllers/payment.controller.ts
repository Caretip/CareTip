import type { Request, Response } from "express";
import {
  createTipCheckoutSession,
  getTipCheckoutContext,
  isStripeConfigured,
} from "../services/stripe.service.js";
import { prisma } from "../prisma.js";
import { logServerError, clientSafeMessage, CLIENT_FALLBACK } from "../utils/httpErrors.js";
import { TipPaymentEligibilityError } from "../services/tipPaymentEligibility.service.js";
import { absolutizePublicMediaPath } from "../utils/publicMediaUrl.js";
import { resolveScanSessionId } from "../services/qr/qrScanRequestContext.js";
import { QR_FUNNEL_EVENT_TYPES, recordQrFunnelEvent } from "../services/qr/qrFunnelEvent.service.js";
import { ensureTransactionReceiptNumber } from "../services/tipReceipt.service.js";

/**
 * POST /api/payments/create-tip-session
 * Public — guest tipping (no auth).
 */
export async function createTipSession(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
    const businessId = typeof body.businessId === "string" ? body.businessId : "";
    const amount = Number(body.amount);
    const tipAmount =
      body.tipAmount != null && body.tipAmount !== "" ? Number(body.tipAmount) : undefined;
    const locationId =
      typeof body.locationId === "string" ? body.locationId : undefined;
    const tableId = typeof body.tableId === "string" ? body.tableId : undefined;
    const customerName =
      typeof body.customerName === "string" ? body.customerName : undefined;
    const feedback = typeof body.feedback === "string" ? body.feedback : undefined;
    const qrScanSessionId =
      typeof body.qrScanSessionId === "string" && body.qrScanSessionId.trim()
        ? body.qrScanSessionId.trim().slice(0, 64)
        : resolveScanSessionId(req);

    if (!employeeId || !businessId) {
      return res.status(400).json({ message: "employeeId and businessId are required" });
    }
    if (Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }
    if (
      tipAmount != null &&
      !Number.isNaN(tipAmount) &&
      Math.abs(tipAmount - amount) > 0.001
    ) {
      return res.status(400).json({ message: "tipAmount must match amount" });
    }

    if (!isStripeConfigured()) {
      return res.status(503).json({
        message: "Payment processing is not configured yet.",
        code: "STRIPE_NOT_CONFIGURED",
      });
    }

    const result = await createTipCheckoutSession({
      amount,
      employeeId,
      businessId,
      tipAmount,
      locationId: locationId ?? null,
      tableId: tableId ?? null,
      customerName: customerName ?? null,
      feedback: feedback ?? null,
      qrScanSessionId,
    });

    recordQrFunnelEvent({
      businessId,
      sessionId: qrScanSessionId,
      eventType: QR_FUNNEL_EVENT_TYPES.TIP_STARTED,
      employeeId,
      locationId: locationId ?? null,
      tableId: tableId ?? null,
    });

    return res.json({
      sessionId: result.sessionId,
      url: result.url,
    });
  } catch (err) {
    logServerError("payment.createTipSession", err);
    if (err instanceof TipPaymentEligibilityError) {
      return res.status(400).json({
        message: err.message,
        code: err.code,
      });
    }
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.payment),
    });
  }
}

/**
 * GET /api/payments/tip-session/:sessionId
 * Public — verified tip context for post-checkout UX only.
 *
 * Privacy: employee/business/venue/customer fields are returned only when
 * a success ledger row exists (`status: "ready"`). Pending/expired/unpaid
 * responses expose session id + status only.
 */
export async function getTipSessionContext(req: Request, res: Response) {
  const lookupStarted = Date.now();
  try {
    const sessionId = String(req.params.sessionId ?? "").trim();
    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }
    if (!isStripeConfigured()) {
      return res.status(503).json({
        message: "Payment processing is not configured yet.",
        code: "STRIPE_NOT_CONFIGURED",
      });
    }

    const ctx = await getTipCheckoutContext(sessionId);

    if (ctx.checkoutStatus === "expired") {
      console.info("[tip-reconcile] lookup_expired", {
        sessionId: ctx.sessionId,
        checkoutStatus: ctx.checkoutStatus,
        paymentStatus: ctx.paymentStatus,
        elapsedMs: Date.now() - lookupStarted,
      });
      return res.status(410).json({
        status: "expired",
        sessionId: ctx.sessionId,
      });
    }

    const piId = ctx.paymentIntentId;
    const tipByPi = piId
      ? await prisma.transaction.findFirst({
          where: { stripePaymentIntentId: piId },
          select: {
            id: true,
            status: true,
            employeeId: true,
            businessId: true,
            locationId: true,
            tableId: true,
            receiptNumber: true,
            createdAt: true,
          },
        })
      : null;

    // Webhook already wrote a non-success tip (e.g. eligibility_failure + refund).
    // Do NOT keep returning pending — Stripe may still report payment_status=paid after refund.
    if (tipByPi && tipByPi.status !== "success") {
      console.info("[tip-reconcile] lookup_failed_ledger", {
        sessionId: ctx.sessionId,
        paymentIntentId: ctx.paymentIntentId,
        tipId: tipByPi.id,
        tipStatus: tipByPi.status,
        tipCreatedAt: tipByPi.createdAt.toISOString(),
        businessId: tipByPi.businessId,
        employeeId: tipByPi.employeeId,
        checkoutStatus: ctx.checkoutStatus,
        paymentStatus: ctx.paymentStatus,
        elapsedMs: Date.now() - lookupStarted,
      });
      return res.status(422).json({
        status: "failed",
        sessionId: ctx.sessionId,
        tipId: tipByPi.id,
        tipStatus: tipByPi.status,
        paymentIntentId: ctx.paymentIntentId,
      });
    }

    const tx = tipByPi?.status === "success" ? tipByPi : null;

    if (tx) {
      const employee = await prisma.employee.findUnique({
        where: { id: tx.employeeId },
        select: { id: true, name: true, avatar: true },
      });

      const receiptNumber =
        tx.receiptNumber?.trim() || (await ensureTransactionReceiptNumber(tx.id));

      console.info("[tip-reconcile] lookup_ready", {
        sessionId: ctx.sessionId,
        paymentIntentId: ctx.paymentIntentId,
        tipId: tx.id,
        tipCreatedAt: tx.createdAt.toISOString(),
        businessId: tx.businessId,
        employeeId: tx.employeeId,
        customerName: ctx.customerName,
        elapsedMs: Date.now() - lookupStarted,
      });

      return res.json({
        status: "ready",
        sessionId: ctx.sessionId,
        paymentIntentId: ctx.paymentIntentId,
        transactionId: tx.id,
        receiptNumber: receiptNumber ?? null,
        employee: employee
          ? {
              id: employee.id,
              name: employee.name,
              avatar: absolutizePublicMediaPath(employee.avatar),
            }
          : null,
        businessId: tx.businessId,
        locationId: tx.locationId,
        tableId: tx.tableId,
        customerName: ctx.customerName,
      });
    }

    if (
      ctx.checkoutStatus === "complete" &&
      ctx.paymentStatus &&
      ctx.paymentStatus !== "paid"
    ) {
      console.info("[tip-reconcile] lookup_unpaid", {
        sessionId: ctx.sessionId,
        paymentIntentId: ctx.paymentIntentId,
        checkoutStatus: ctx.checkoutStatus,
        paymentStatus: ctx.paymentStatus,
        elapsedMs: Date.now() - lookupStarted,
      });
      return res.status(422).json({
        status: "unpaid",
        sessionId: ctx.sessionId,
      });
    }

    // Webhook may not have persisted the Transaction yet; client polls until tip exists.
    console.info("[tip-reconcile] lookup_pending", {
      sessionId: ctx.sessionId,
      paymentIntentId: ctx.paymentIntentId,
      checkoutStatus: ctx.checkoutStatus,
      paymentStatus: ctx.paymentStatus,
      businessId: ctx.businessId,
      employeeId: ctx.employeeId,
      customerName: ctx.customerName,
      elapsedMs: Date.now() - lookupStarted,
    });
    return res.status(202).json({
      status: "pending",
      sessionId: ctx.sessionId,
      paymentIntentId: ctx.paymentIntentId,
      paymentStatus: ctx.paymentStatus,
      checkoutStatus: ctx.checkoutStatus,
      businessId: ctx.businessId,
      employeeId: ctx.employeeId,
    });
  } catch (err) {
    logServerError("payment.getTipSessionContext", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.payment),
    });
  }
}
