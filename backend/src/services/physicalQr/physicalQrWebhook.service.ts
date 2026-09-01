import type Stripe from "stripe";
import { prisma } from "../../prisma.js";
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

async function markParentOrderPaid(input: {
  orderId: string;
  businessId: string;
  session: Stripe.Checkout.Session;
}): Promise<{ ok: boolean; reason?: string; duplicate?: boolean }> {
  const order = await prisma.physicalQrOrder.findFirst({
    where: { id: input.orderId, businessId: input.businessId },
  });
  if (!order) {
    return { ok: false, reason: "order_not_found" };
  }

  if (typeof input.session.amount_total === "number" && input.session.amount_total !== order.totalAmount) {
    return { ok: false, reason: "amount_mismatch" };
  }

  if (
    input.session.id &&
    order.stripeCheckoutSessionId &&
    order.stripeCheckoutSessionId !== input.session.id
  ) {
    return { ok: false, reason: "session_mismatch" };
  }

  if (order.paymentStatus === "PAID") {
    return { ok: true, duplicate: true };
  }

  const paymentIntentId =
    typeof input.session.payment_intent === "string"
      ? input.session.payment_intent
      : input.session.payment_intent?.id ?? null;

  const now = new Date();
  await prisma.physicalQrOrder.update({
    where: { id: order.id },
    data: {
      paymentStatus: "PAID",
      fulfillmentStatus: "PROCESSING",
      stripeCheckoutSessionId: input.session.id,
      stripePaymentIntentId: paymentIntentId,
      paidAt: now,
      processingAt: now,
    },
  });

  const { notifyPhysicalQrPaymentReceived } = await import("./physicalQrNotify.service.js");
  notifyPhysicalQrPaymentReceived({ businessId: order.businessId, orderId: order.id });
  return { ok: true };
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
): Promise<{ ok: boolean; reason?: string; duplicate?: boolean }> {
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
    return markLegacyBatchPaid({ orderIds: legacyIds, businessId, session });
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
