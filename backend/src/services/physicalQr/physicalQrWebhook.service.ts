import type Stripe from "stripe";
import { prisma } from "../../prisma.js";
import { retrievePaymentIntentAuthoritative } from "../stripe.service.js";
import {
  recordPaymentDiscrepancy,
  resolvePaymentDiscrepanciesForSubject,
} from "../payments/paymentDiscrepancy.service.js";
import { PHYSICAL_QR_CHECKOUT_METADATA_SOURCE } from "../../config/physicalQrCheckout.js";
import {
  berlinCalendarMonthStart,
  clearPhysicalQrOrderMonthlyFreeQuota,
  hasPaidPhysicalQrMonthlyFreeOrderThisMonth,
  parseStoredPhysicalQrQuote,
  readPhysicalQrQuotaState,
  releasePhysicalQrMonthlyFreeOrderClaim,
  shouldReleasePhysicalQrQuotaOnExpire,
} from "./physicalQrPricing.service.js";

export type PhysicalQrCheckoutOutcome = {
  ok: boolean;
  reason?: string;
  duplicate?: boolean;
  /** Payment not collected yet (delayed method); a checkout.session.async_payment_* event follows. */
  awaitingPayment?: boolean;
  /** Money was received but the order was not fulfilled; recorded for review. */
  review?: boolean;
  /** Infrastructure failure: let Stripe redeliver. Never set for business-rule outcomes. */
  retryable?: boolean;
};

function paymentIntentIdOf(session: Stripe.Checkout.Session): string | null {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
}

async function expireSupersededSession(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  try {
    const { getStripeClient } = await import("../stripe.service.js");
    await getStripeClient().checkout.sessions.expire(sessionId);
  } catch {
    /* already expired or completed — nothing to do */
  }
}

/**
 * Applies a paid (or not-yet-paid) Checkout Session to its order.
 *
 * - payment_status "unpaid": nothing changes (a delayed payment method; async events follow).
 * - "no_payment_required": never from CareTip QR checkout (zero-cost orders skip Stripe) → review.
 * - "paid": the PaymentIntent is verified with Stripe (succeeded, amount, currency) and the order is
 *   moved PENDING/FAILED → PAID under a row lock. A paid session that is not the order's latest one
 *   is still a legitimate payment for this order (metadata is set server-side) and is accepted.
 * - amount/currency/state mismatch → IN_REVIEW + discrepancy (never fulfilled, never a 500 loop).
 * - order already paid by a different PaymentIntent → duplicate payment: discrepancy + durable refund.
 */
async function markParentOrderPaid(input: {
  orderId: string;
  businessId: string;
  session: Stripe.Checkout.Session;
}): Promise<PhysicalQrCheckoutOutcome> {
  const { session } = input;
  const subjectKey = `qr_order:${input.orderId}`;
  const order = await prisma.physicalQrOrder.findFirst({
    where: { id: input.orderId, businessId: input.businessId },
    select: { id: true, businessId: true, currency: true, totalAmount: true, stripeCheckoutSessionId: true },
  });
  const paymentIntentId = paymentIntentIdOf(session);
  if (!order) {
    if (session.payment_status === "paid") {
      await recordPaymentDiscrepancy({
        workflow: "qr_order",
        kind: "paid_session_without_order",
        subjectKey: `qr_session:${session.id}`,
        businessId: input.businessId,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        details: { orderId: input.orderId, amountTotal: session.amount_total ?? null },
      });
    }
    return { ok: true, review: true, reason: "order_not_found" };
  }

  if (session.payment_status === "unpaid") {
    return { ok: true, awaitingPayment: true, reason: "payment_not_collected" };
  }
  if (session.payment_status !== "paid") {
    await recordPaymentDiscrepancy({
      workflow: "qr_order",
      kind: "unexpected_payment_status",
      subjectKey,
      businessId: order.businessId,
      physicalQrOrderId: order.id,
      stripeCheckoutSessionId: session.id,
      details: { paymentStatus: session.payment_status ?? null },
    });
    return { ok: true, review: true, reason: "unexpected_payment_status" };
  }
  if (!paymentIntentId) {
    await recordPaymentDiscrepancy({
      workflow: "qr_order",
      kind: "paid_session_without_payment_intent",
      subjectKey,
      businessId: order.businessId,
      physicalQrOrderId: order.id,
      stripeCheckoutSessionId: session.id,
    });
    return { ok: true, review: true, reason: "missing_payment_intent" };
  }

  // Authoritative check: the PaymentIntent must have succeeded for exactly what the session charged.
  let pi: Stripe.PaymentIntent;
  try {
    pi = await retrievePaymentIntentAuthoritative(paymentIntentId);
  } catch (err) {
    console.error("[physicalQr.webhook] PaymentIntent retrieve failed", {
      orderId: order.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, retryable: true, reason: "payment_intent_unavailable" };
  }
  if (pi.status === "processing" || pi.status === "requires_action") {
    return { ok: true, awaitingPayment: true, reason: "payment_processing" };
  }

  const problems: string[] = [];
  if (pi.status !== "succeeded") problems.push("payment_intent_not_succeeded");
  const received = pi.amount_received ?? 0;
  if (typeof session.amount_total === "number" && received !== session.amount_total) problems.push("amount_mismatch");
  if (typeof session.amount_total === "number" && session.amount_total !== order.totalAmount) problems.push("amount_mismatch");
  const orderCurrency = order.currency.toLowerCase();
  if (
    String(session.currency ?? "").toLowerCase() !== orderCurrency ||
    String(pi.currency ?? "").toLowerCase() !== orderCurrency
  ) {
    problems.push("currency_mismatch");
  }
  if (pi.metadata?.orderId && pi.metadata.orderId !== order.id) problems.push("order_mismatch");
  const uniqueProblems = [...new Set(problems)];

  const now = new Date();
  type TxResult =
    | { kind: "paid"; superseded: string | null }
    | { kind: "duplicate" }
    | { kind: "duplicate_payment"; existingPaymentIntentId: string | null }
    | { kind: "review"; reasons: string[] }
    | { kind: "not_payable"; paymentStatus: string };

  const result: TxResult = await prisma.$transaction(
    async (tx): Promise<TxResult> => {
      await tx.$queryRaw`SELECT id FROM physical_qr_orders WHERE id = ${order.id} FOR UPDATE`;
      const row = await tx.physicalQrOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { paymentStatus: true, stripePaymentIntentId: true, stripeCheckoutSessionId: true },
      });
      if (row.stripePaymentIntentId === paymentIntentId) {
        return { kind: "duplicate" };
      }
      if (row.paymentStatus !== "PENDING" && row.paymentStatus !== "FAILED") {
        if (row.stripePaymentIntentId || row.paymentStatus === "PAID") {
          return { kind: "duplicate_payment", existingPaymentIntentId: row.stripePaymentIntentId };
        }
        return { kind: "not_payable", paymentStatus: row.paymentStatus };
      }
      if (uniqueProblems.length > 0) {
        // Money is in, but it does not match this order: hold for review, never fulfil.
        await tx.physicalQrOrder.update({
          where: { id: order.id },
          data: { paymentStatus: "IN_REVIEW", stripePaymentIntentId: paymentIntentId },
        });
        return { kind: "review", reasons: uniqueProblems };
      }
      const superseded =
        row.stripeCheckoutSessionId && row.stripeCheckoutSessionId !== session.id ? row.stripeCheckoutSessionId : null;
      await tx.physicalQrOrder.update({
        where: { id: order.id },
        data: {
          paymentStatus: "PAID",
          fulfillmentStatus: "PROCESSING",
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: paymentIntentId,
          paidAt: now,
          processingAt: now,
        },
      });
      return { kind: "paid", superseded };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );

  if (result.kind === "duplicate") return { ok: true, duplicate: true };

  if (result.kind === "paid") {
    if (result.superseded) {
      // The customer paid an older session; close the newer one so it cannot be paid as well.
      await expireSupersededSession(result.superseded);
      console.info("[physicalQr.webhook] paid via earlier checkout session", {
        orderId: order.id,
        paidSessionId: session.id,
        supersededSessionId: result.superseded,
      });
    }
    await resolvePaymentDiscrepanciesForSubject({
      workflow: "qr_order",
      subjectKey,
      stillPresentKinds: [],
      onlyKinds: ["paid_session_pending_order"],
      status: "auto_repaired",
    });
    const { notifyPhysicalQrPaymentReceived } = await import("./physicalQrNotify.service.js");
    notifyPhysicalQrPaymentReceived({ businessId: order.businessId, orderId: order.id });
    return { ok: true };
  }

  if (result.kind === "duplicate_payment") {
    await recordPaymentDiscrepancy({
      workflow: "qr_order",
      kind: "duplicate_payment",
      subjectKey: `qr_payment:${paymentIntentId}`,
      businessId: order.businessId,
      physicalQrOrderId: order.id,
      stripePaymentIntentId: paymentIntentId,
      stripeCheckoutSessionId: session.id,
      details: { existingPaymentIntentId: result.existingPaymentIntentId, amountTotal: session.amount_total ?? null },
    });
    // The order is already paid by another payment: this second charge is refunded in full.
    const { requestRefundOperation } = await import("../payments/refundOperations.service.js");
    await requestRefundOperation({
      operationKey: `qr_duplicate_payment_refund:${paymentIntentId}`,
      purpose: "qr_duplicate_payment",
      paymentIntentId,
      businessId: order.businessId,
      physicalQrOrderId: order.id,
      context: { source: "physicalQr.checkout.completed", sessionId: session.id },
    });
    return { ok: true, review: true, reason: "duplicate_payment_refunded" };
  }

  if (result.kind === "not_payable") {
    await recordPaymentDiscrepancy({
      workflow: "qr_order",
      kind: "paid_session_for_unpayable_order",
      subjectKey,
      businessId: order.businessId,
      physicalQrOrderId: order.id,
      stripePaymentIntentId: paymentIntentId,
      stripeCheckoutSessionId: session.id,
      details: { orderPaymentStatus: result.paymentStatus, amountTotal: session.amount_total ?? null },
    });
    return { ok: true, review: true, reason: "order_not_payable" };
  }

  await recordPaymentDiscrepancy({
    workflow: "qr_order",
    kind: "payment_needs_review",
    subjectKey,
    businessId: order.businessId,
    physicalQrOrderId: order.id,
    stripePaymentIntentId: paymentIntentId,
    stripeCheckoutSessionId: session.id,
    details: {
      reasons: result.reasons,
      sessionAmountTotal: session.amount_total ?? null,
      amountReceived: received,
      orderTotalAmount: order.totalAmount,
      sessionCurrency: session.currency ?? null,
      orderCurrency: order.currency,
      paymentIntentStatus: pi.status,
    },
  });
  return { ok: true, review: true, reason: result.reasons.join(",") };
}

/** Legacy: multiple sibling orders from pre-migration batch checkout. */
async function markLegacyBatchPaid(input: {
  orderIds: string[];
  businessId: string;
  session: Stripe.Checkout.Session;
}): Promise<{ ok: boolean; reason?: string; duplicate?: boolean }> {
  const orders = await prisma.physicalQrOrder.findMany({
    where: { id: { in: input.orderIds }, businessId: input.businessId },
  });
  if (orders.length !== input.orderIds.length) {
    return { ok: false, reason: "order_not_found" };
  }

  const expectedTotal = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  if (typeof input.session.amount_total === "number" && input.session.amount_total !== expectedTotal) {
    return { ok: false, reason: "amount_mismatch" };
  }

  if (orders.every((o) => o.paymentStatus === "PAID")) {
    return { ok: true, duplicate: true };
  }

  const paymentIntentId =
    typeof input.session.payment_intent === "string"
      ? input.session.payment_intent
      : input.session.payment_intent?.id ?? null;
  const now = new Date();
  const unpaid = orders.filter((o) => o.paymentStatus !== "PAID");

  await prisma.$transaction(async (tx) => {
    for (const order of unpaid) {
      await tx.physicalQrOrder.update({
        where: { id: order.id },
        data: {
          paymentStatus: "PAID",
          fulfillmentStatus: "PROCESSING",
          stripePaymentIntentId: paymentIntentId,
          paidAt: now,
          processingAt: now,
        },
      });
    }
  });

  const primaryId = input.orderIds[0]!;
  await prisma.physicalQrOrder.updateMany({
    where: { id: { in: unpaid.map((o) => o.id) } },
    data: { stripeCheckoutSessionId: input.session.id },
  }).catch(() => {
    /* legacy rows may violate unique session id when multiple siblings exist */
  });

  const { notifyPhysicalQrPaymentReceived } = await import("./physicalQrNotify.service.js");
  notifyPhysicalQrPaymentReceived({ businessId: input.businessId, orderId: primaryId });
  return { ok: true };
}

export async function handlePhysicalQrCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<PhysicalQrCheckoutOutcome> {
  if (session.metadata?.source !== PHYSICAL_QR_CHECKOUT_METADATA_SOURCE) {
    return { ok: false, reason: "wrong_source" };
  }
  const orderId = session.metadata.orderId?.trim();
  const orderIdsRaw = session.metadata.orderIds?.trim();
  const businessId = session.metadata.businessId?.trim();
  if (!orderId || !businessId) {
    return { ok: false, reason: "missing_metadata" };
  }

  const legacyIds = orderIdsRaw
    ? orderIdsRaw.split(",").map((id) => id.trim()).filter(Boolean)
    : [];

  if (legacyIds.length > 1) {
    if (session.payment_status !== "paid") {
      return { ok: true, awaitingPayment: session.payment_status === "unpaid", reason: "payment_not_collected" };
    }
    const legacy = await markLegacyBatchPaid({ orderIds: legacyIds, businessId, session });
    if (!legacy.ok) {
      await recordPaymentDiscrepancy({
        workflow: "qr_order",
        kind: "legacy_batch_payment_needs_review",
        subjectKey: `qr_session:${session.id}`,
        businessId,
        stripeCheckoutSessionId: session.id,
        details: { reason: legacy.reason ?? null, orderIds: legacyIds },
      });
      return { ok: true, review: true, reason: legacy.reason };
    }
    return legacy;
  }

  return markParentOrderPaid({ orderId, businessId, session });
}

export async function handlePhysicalQrCheckoutExpired(
  session: Stripe.Checkout.Session,
): Promise<{ released: boolean; reason?: string }> {
  if (session.metadata?.source !== PHYSICAL_QR_CHECKOUT_METADATA_SOURCE) {
    return { released: false, reason: "wrong_source" };
  }
  if (session.status && session.status !== "expired") {
    return { released: false, reason: "session_not_expired" };
  }

  const orderId = session.metadata.orderId?.trim();
  const businessId = session.metadata.businessId?.trim();
  if (!orderId || !businessId) {
    return { released: false, reason: "missing_metadata" };
  }

  const order = await prisma.physicalQrOrder.findFirst({
    where: { id: orderId, businessId },
    select: {
      id: true,
      paymentStatus: true,
      stripeCheckoutSessionId: true,
      monthlyFreeQuotaApplied: true,
      pricingSnapshot: true,
    },
  });
  if (!order) {
    return { released: false, reason: "order_not_found" };
  }

  const stored = parseStoredPhysicalQrQuote(order.pricingSnapshot);
  const quotaClaimedAt = stored?.quotaClaimedAt ? new Date(stored.quotaClaimedAt) : null;
  if (!quotaClaimedAt || Number.isNaN(quotaClaimedAt.getTime())) {
    return { released: false, reason: "not_releasable" };
  }

  const quota = await readPhysicalQrQuotaState(businessId);
  const monthStart = berlinCalendarMonthStart(new Date(), quota?.timezone);
  const paidFreeOrderThisMonth = await hasPaidPhysicalQrMonthlyFreeOrderThisMonth(businessId, monthStart);

  if (
    !quotaClaimedAt ||
    !shouldReleasePhysicalQrQuotaOnExpire({
      sessionId: session.id,
      orderSessionId: order.stripeCheckoutSessionId,
      paymentStatus: order.paymentStatus,
      monthlyFreeQuotaApplied: order.monthlyFreeQuotaApplied,
      quotaClaimedAt,
      paidFreeOrderThisMonth,
    })
  ) {
    return { released: false, reason: "not_releasable" };
  }

  await releasePhysicalQrMonthlyFreeOrderClaim({
    businessId,
    claimedAt: quotaClaimedAt,
    previousUsedAt: null,
  });
  await clearPhysicalQrOrderMonthlyFreeQuota(order.id);
  return { released: true };
}

/** checkout.session.async_payment_failed — a delayed payment for the order's session did not arrive. */
export async function handlePhysicalQrAsyncPaymentFailed(
  session: Stripe.Checkout.Session,
): Promise<{ updated: boolean }> {
  if (session.metadata?.source !== PHYSICAL_QR_CHECKOUT_METADATA_SOURCE) return { updated: false };
  const orderId = session.metadata.orderId?.trim();
  const businessId = session.metadata.businessId?.trim();
  if (!orderId || !businessId) return { updated: false };
  const updated = await prisma.physicalQrOrder.updateMany({
    where: { id: orderId, businessId, paymentStatus: "PENDING", stripeCheckoutSessionId: session.id },
    data: { paymentStatus: "FAILED", fulfillmentStatus: "PAYMENT_FAILED" },
  });
  return { updated: updated.count === 1 };
}

export async function handlePhysicalQrPaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const orderId = paymentIntent.metadata?.orderId?.trim();
  const orderIdsRaw = paymentIntent.metadata?.orderIds?.trim();
  if (paymentIntent.metadata?.source !== PHYSICAL_QR_CHECKOUT_METADATA_SOURCE) return;

  const orderIds = orderIdsRaw
    ? orderIdsRaw.split(",").map((id) => id.trim()).filter(Boolean)
    : orderId
      ? [orderId]
      : [];

  if (!orderIds.length) return;

  await prisma.physicalQrOrder.updateMany({
    where: {
      id: { in: orderIds },
      paymentStatus: "PENDING",
    },
    data: {
      paymentStatus: "FAILED",
      fulfillmentStatus: "PAYMENT_FAILED",
    },
  });
}
