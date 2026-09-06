import type { Request, Response } from "express";
import { prisma } from "../prisma.js";
import * as businessService from "../services/business.service.js";
import * as feedbackService from "../services/feedback.service.js";
import { getTipCheckoutContext, isStripeConfigured } from "../services/stripe.service.js";
import { logServerError, clientSafeMessage, CLIENT_FALLBACK } from "../utils/httpErrors.js";
import { parseBoundedSkip } from "../utils/paginationLimits.js";
import { logDashboardTenant } from "../utils/dashboardTenantLog.js";

function parseTakeSkip(req: Request): { take: number; skip: number } {
  const take = Math.max(1, Math.min(100, Number(req.query.take ?? 20) || 20));
  const skip = parseBoundedSkip(req.query.skip);
  return { take, skip };
}

/**
 * POST /api/feedback/tip
 * Public — saves optional feedback tied to a completed Stripe Checkout session.
 */
export async function submitTipFeedback(req: Request, res: Response) {
  try {
    const body = req.body as Record<string, unknown>;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const ratingRaw = body.rating;
    const rating =
      typeof ratingRaw === "number" ? ratingRaw : typeof ratingRaw === "string" ? Number(ratingRaw) : null;
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const tagsIn = Array.isArray(body.tags) ? body.tags : [];
    const tags = tagsIn
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);
    // customerName may still arrive from the guest form; it is not stored locally.

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }
    const hasAnyContent = (rating != null && !Number.isNaN(rating)) || comment.length > 0 || tags.length > 0;
    if (!hasAnyContent) {
      return res.status(400).json({ message: "Please add a rating or a short note." });
    }
    if (rating != null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
      return res.status(400).json({ message: "rating must be between 1 and 5" });
    }
    if (comment.length > 1500) {
      return res.status(400).json({ message: "comment is too long" });
    }

    if (!isStripeConfigured()) {
      return res.status(503).json({
        message: "Payment processing is not configured yet.",
        code: "STRIPE_NOT_CONFIGURED",
      });
    }

    const ctx = await getTipCheckoutContext(sessionId);
    if (!ctx.paymentIntentId) {
      return res.status(400).json({ message: "Could not verify payment session." });
    }

    const tx = await prisma.transaction.findFirst({
      where: { stripePaymentIntentId: ctx.paymentIntentId, status: "success" },
      select: { id: true, businessId: true, employeeId: true, locationId: true, tableId: true },
    });
    if (!tx) {
      return res.status(409).json({
        message: "Tip is still processing. Please try again in a moment.",
        code: "TIP_PENDING",
      });
    }

    const saved = await prisma.tipFeedback.upsert({
      where: { transactionId: tx.id },
      create: {
        transactionId: tx.id,
        businessId: tx.businessId,
        employeeId: tx.employeeId,
        locationId: tx.locationId,
        tableId: tx.tableId,
        stripeCheckoutSessionId: ctx.sessionId,
        rating: rating != null && Number.isFinite(rating) ? Math.trunc(rating) : null,
        comment: comment ? comment : null,
        tags,
        // Guest names are anonymized on feedback completion — do not persist locally.
        // Stripe Checkout/PI metadata.customerName may still exist on Stripe; CareTip
        // does not call Stripe object deletion/metadata wipe (not a supported CareTip operation).
        customerName: null,
        nameAnonymizedAt: new Date(),
      },
      update: {
        rating: rating != null && Number.isFinite(rating) ? Math.trunc(rating) : null,
        comment: comment ? comment : null,
        tags,
        customerName: null,
        nameAnonymizedAt: new Date(),
        stripeCheckoutSessionId: ctx.sessionId,
      },
      select: { id: true, transactionId: true, rating: true },
    });

    return res.json({ ok: true, feedbackId: saved.id, transactionId: saved.transactionId });
  } catch (err) {
    logServerError("feedback.submitTipFeedback", err);
    return res.status(400).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.tipFeedback),
    });
  }
}

/**
 * GET /api/feedback/business
 * Manager — paginated customer feedback for the authenticated business.
 */
export async function listBusinessFeedback(req: Request, res: Response) {
  try {
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const business = await businessService.getBusinessByUserId(userId);
    if (!business) return res.status(404).json({ message: "Business not found" });

    const { take, skip } = parseTakeSkip(req);
    const employeeId =
      typeof req.query.employeeId === "string" ? req.query.employeeId.trim() : "";

    logDashboardTenant("feedback.listBusiness", {
      userId,
      businessId: business.id,
      role: req.user?.role ?? null,
      take,
      skip,
      employeeId: employeeId || null,
    });

    const result = await feedbackService.listBusinessCustomerFeedback({
      businessId: business.id,
      take,
      skip,
      employeeId: employeeId || undefined,
    });

    return res.json(result);
  } catch (err) {
    logServerError("feedback.listBusiness", err);
    return res.status(500).json({
      message: clientSafeMessage(err, CLIENT_FALLBACK.employee),
    });
  }
}

