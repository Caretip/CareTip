/**
 * Platform-admin resolution of a held QR print order: "release for fulfillment".
 *
 * Only two held states can be released, and only after the payment is re-verified with Stripe:
 *   IN_REVIEW           money arrived but did not match the order (amount, currency or state). Release
 *                       = the admin accepts this payment for this order → PAID / PROCESSING.
 *   PARTIALLY_REFUNDED  part of the payment was refunded. Release = fulfil anyway. The payment status
 *                       stays PARTIALLY_REFUNDED (it is the truth); a release marker makes the order
 *                       fulfillable until any further refund or dispute arrives.
 * Never releasable: REFUNDED, DISPUTED (open or lost), unpaid states. A won dispute returns the order
 * to its previous state through the dispute webhook; no admin action is involved.
 *
 * Release is refused when Stripe shows a dispute, when Stripe and CareTip disagree on the refunded
 * amount (reconcile first), or when other payment discrepancies for the order are still open.
 *
 * The write is atomic: under the order row lock the state is re-checked against what was verified
 * (status, release marker, adjustments), then the order is updated and an append-only
 * PhysicalQrHoldResolution row is written in the same transaction. No refund, cancellation or other
 * financial action is taken here.
 */
import type Stripe from "stripe";
import { PaymentDiscrepancyStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { retrievePaymentIntentAuthoritative } from "../stripe.service.js";
import { writeAuditLog } from "../audit.service.js";
import { PhysicalQrFulfillmentError } from "./physicalQrFulfillment.service.js";

export const HOLD_RELEASE_REASON_MIN = 10;
export const HOLD_RELEASE_REASON_MAX = 1000;
const RELEASABLE = new Set(["IN_REVIEW", "PARTIALLY_REFUNDED"]);
/** Findings that a hold itself represents; releasing the hold answers (resolves) them. */
const REVIEW_KINDS_IN_REVIEW = new Set(["payment_needs_review", "dispute_won_needs_review"]);
const REVIEW_KINDS_PARTIAL = new Set(["dispute_won_needs_review"]);
const OPEN_OR_LOST_DISPUTE = (status: string) => status !== "won" && status !== "warning_closed";

export type HoldReleaseResult = {
  orderId: string;
  previousPaymentStatus: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  resolutionId: string;
};

function fail(code: string, message: string, status = 409): never {
  throw new PhysicalQrFulfillmentError(code, message, status);
}

async function openDiscrepanciesFor(orderId: string) {
  return prisma.paymentDiscrepancy.findMany({
    where: {
      status: PaymentDiscrepancyStatus.open,
      OR: [{ physicalQrOrderId: orderId }, { subjectKey: `qr_order:${orderId}` }],
    },
    select: { id: true, kind: true },
  });
}

async function localRefundedCents(orderId: string): Promise<{ refunded: number; disputes: string[] }> {
  const rows = await prisma.physicalQrPaymentAdjustment.findMany({ where: { orderId }, select: { kind: true, status: true, amountCents: true } });
  return {
    refunded: rows.filter((r) => r.kind === "refund" && r.status === "succeeded").reduce((s, r) => s + r.amountCents, 0),
    disputes: rows.filter((r) => r.kind === "dispute").map((r) => r.status),
  };
}

export async function releasePhysicalQrOrderHold(input: {
  orderId: string;
  adminUserId: string;
  reason: unknown;
  /** The status the admin saw; guards against acting on a stale screen. */
  expectedPaymentStatus: unknown;
}): Promise<HoldReleaseResult> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < HOLD_RELEASE_REASON_MIN || reason.length > HOLD_RELEASE_REASON_MAX) {
    fail("REASON_REQUIRED", `A reason of ${HOLD_RELEASE_REASON_MIN}–${HOLD_RELEASE_REASON_MAX} characters is required.`, 400);
  }
  if (!input.adminUserId) fail("FORBIDDEN", "Not allowed.", 403);
  const expected = typeof input.expectedPaymentStatus === "string" ? input.expectedPaymentStatus : "";

  const order = await prisma.physicalQrOrder.findUnique({ where: { id: input.orderId } });
  if (!order) fail("ORDER_NOT_FOUND", "Order not found", 404);
  if (expected !== order.paymentStatus) {
    fail("ORDER_STATE_CHANGED", "This order changed since you opened it. Reload and review it again.");
  }
  if (!RELEASABLE.has(order.paymentStatus)) {
    const why: Record<string, string> = {
      PAID: "This order is not on hold.",
      REFUNDED: "A refunded order cannot be released for fulfillment.",
      DISPUTED: "A disputed order cannot be released. If the dispute is won, the order is released automatically.",
    };
    fail("HOLD_NOT_RELEASABLE", why[order.paymentStatus] ?? "This order cannot be released for fulfillment.");
  }
  if (order.holdReleasedAt) fail("ALREADY_RELEASED", "This order was already released for fulfillment.");
  if (!order.stripePaymentIntentId) fail("PAYMENT_NOT_VERIFIABLE", "This order has no Stripe payment to verify.");
  if (!["PENDING_PAYMENT", "PAYMENT_FAILED", "PAID", "PROCESSING", "PRINTING"].includes(order.fulfillmentStatus)) {
    fail("HOLD_NOT_RELEASABLE", "This order's fulfillment state does not allow a release.");
  }

  // Other open findings for this order make fulfilment unsafe until they are reviewed.
  const open = await openDiscrepanciesFor(order.id);
  const answered = order.paymentStatus === "IN_REVIEW" ? REVIEW_KINDS_IN_REVIEW : REVIEW_KINDS_PARTIAL;
  const blocking = open.filter((d) => !answered.has(d.kind));
  if (blocking.length) {
    fail("OPEN_PAYMENT_DISCREPANCY", `Resolve the open payment findings first: ${[...new Set(blocking.map((d) => d.kind))].join(", ")}.`);
  }

  // Re-verify the payment with Stripe (outside the transaction: never hold a row lock across HTTP).
  let pi: Stripe.PaymentIntent;
  try {
    pi = await retrievePaymentIntentAuthoritative(order.stripePaymentIntentId);
  } catch {
    fail("STRIPE_UNAVAILABLE", "The payment could not be verified with Stripe. Try again shortly.", 503);
  }
  const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? (pi.latest_charge as Stripe.Charge) : null;
  const received = pi.amount_received ?? 0;
  if (pi.status !== "succeeded" || received <= 0) fail("PAYMENT_NOT_SUCCEEDED", `Stripe reports this payment as "${pi.status}".`);
  if (String(pi.currency ?? "").toLowerCase() !== order.currency.toLowerCase()) fail("CURRENCY_MISMATCH", "The payment currency does not match the order.");
  const stripeRefunded = charge?.amount_refunded ?? 0;
  const local = await localRefundedCents(order.id);
  // Stripe keeps charge.disputed = true even after a dispute is won, so the outcome comes from the
  // recorded dispute events: open or lost blocks; a dispute Stripe knows about but CareTip has not
  // recorded blocks too (reconcile first).
  if (local.disputes.some(OPEN_OR_LOST_DISPUTE)) fail("PAYMENT_DISPUTED", "This payment has an open or lost dispute.");
  if (charge?.disputed && local.disputes.length === 0) {
    fail("PAYMENT_DISPUTED", "Stripe shows a dispute that CareTip has not recorded yet. Run reconciliation first.");
  }
  if (stripeRefunded !== local.refunded) {
    fail("REFUNDS_NOT_RECONCILED", `Stripe shows ${stripeRefunded} cents refunded but CareTip has ${local.refunded}. Run reconciliation first.`);
  }
  if (order.paymentStatus === "IN_REVIEW" && local.refunded > 0) fail("REFUNDS_NOT_RECONCILED", "Refunds exist for this payment; it cannot be accepted as-is.");
  if (order.paymentStatus === "PARTIALLY_REFUNDED" && (local.refunded <= 0 || local.refunded >= received)) {
    fail("HOLD_NOT_RELEASABLE", "The refunded amount does not describe a partial refund.");
  }

  const now = new Date();
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM physical_qr_orders WHERE id = ${order.id} FOR UPDATE`;
      const row = await tx.physicalQrOrder.findUniqueOrThrow({ where: { id: order.id } });
      const adj = await tx.physicalQrPaymentAdjustment.findMany({ where: { orderId: order.id }, select: { kind: true, status: true, amountCents: true } });
      const refundedNow = adj.filter((a) => a.kind === "refund" && a.status === "succeeded").reduce((s, a) => s + a.amountCents, 0);
      if (
        row.paymentStatus !== order.paymentStatus ||
        row.fulfillmentStatus !== order.fulfillmentStatus ||
        row.holdReleasedAt ||
        row.stripePaymentIntentId !== order.stripePaymentIntentId ||
        refundedNow !== local.refunded ||
        adj.filter((a) => a.kind === "dispute").length !== local.disputes.length ||
        adj.some((a) => a.kind === "dispute" && OPEN_OR_LOST_DISPUTE(a.status))
      ) {
        fail("ORDER_STATE_CHANGED", "This order changed while it was being verified. Reload and review it again.");
      }

      let newPayment = row.paymentStatus;
      let newFulfillment = row.fulfillmentStatus;
      if (row.paymentStatus === "IN_REVIEW") {
        newPayment = "PAID";
        newFulfillment = row.fulfillmentStatus === "PENDING_PAYMENT" || row.fulfillmentStatus === "PAYMENT_FAILED" ? "PROCESSING" : row.fulfillmentStatus;
        await tx.physicalQrOrder.update({
          where: { id: row.id },
          data: {
            paymentStatus: "PAID",
            fulfillmentStatus: newFulfillment as never,
            paidAt: row.paidAt ?? now,
            processingAt: row.processingAt ?? now,
            // Remembered so a replayed "dispute won" event does not re-hold an approved order.
            holdReleasedAt: now,
            holdReleasedByUserId: input.adminUserId,
            holdReleaseRefundedCents: refundedNow,
          },
        });
      } else {
        await tx.physicalQrOrder.update({
          where: { id: row.id },
          data: { holdReleasedAt: now, holdReleasedByUserId: input.adminUserId, holdReleaseRefundedCents: refundedNow },
        });
      }
      await tx.paymentDiscrepancy.updateMany({
        where: {
          status: PaymentDiscrepancyStatus.open,
          kind: { in: [...answered] },
          OR: [{ physicalQrOrderId: row.id }, { subjectKey: `qr_order:${row.id}` }],
        },
        data: { status: PaymentDiscrepancyStatus.resolved, resolvedAt: now },
      });
      const resolution = await tx.physicalQrHoldResolution.create({
        data: {
          orderId: row.id,
          businessId: row.businessId,
          adminUserId: input.adminUserId,
          action: "release_for_fulfillment",
          previousPaymentStatus: row.paymentStatus,
          newPaymentStatus: newPayment,
          previousFulfillmentStatus: row.fulfillmentStatus,
          newFulfillmentStatus: newFulfillment,
          reason,
          stripePaymentIntentId: row.stripePaymentIntentId,
          verifiedAmountReceivedCents: received,
          verifiedRefundedCents: refundedNow,
        },
      });
      return { previous: row.paymentStatus, newPayment, newFulfillment, resolutionId: resolution.id, businessId: row.businessId };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );

  await writeAuditLog({
    userId: input.adminUserId,
    action: "physical_qr.hold_released",
    metadata: JSON.stringify({
      orderId: order.id,
      resolutionId: result.resolutionId,
      previousPaymentStatus: result.previous,
      paymentStatus: result.newPayment,
      fulfillmentStatus: result.newFulfillment,
    }),
  });
  if (result.newPayment === "PAID" && result.previous === "IN_REVIEW") {
    const { notifyPhysicalQrPaymentReceived } = await import("./physicalQrNotify.service.js");
    notifyPhysicalQrPaymentReceived({ businessId: result.businessId, orderId: order.id });
  }
  return {
    orderId: order.id,
    previousPaymentStatus: result.previous,
    paymentStatus: result.newPayment,
    fulfillmentStatus: result.newFulfillment,
    resolutionId: result.resolutionId,
  };
}

export async function listPhysicalQrHoldResolutions(orderId: string) {
  const rows = await prisma.physicalQrHoldResolution.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    adminUserId: r.adminUserId,
    previousPaymentStatus: r.previousPaymentStatus,
    newPaymentStatus: r.newPaymentStatus,
    previousFulfillmentStatus: r.previousFulfillmentStatus,
    newFulfillmentStatus: r.newFulfillmentStatus,
    reason: r.reason,
    verifiedAmountReceivedCents: r.verifiedAmountReceivedCents,
    verifiedRefundedCents: r.verifiedRefundedCents,
    createdAt: r.createdAt.toISOString(),
  }));
}
