import type Stripe from "stripe";
import { prisma } from "../../prisma.js";
import { PaymentOperationBusyError, withPaymentOperationLease } from "../../lib/payments/operationLease.js";
import { getStripeClient, isStripeConfigured } from "../stripe.service.js";
import { resolveCheckoutFrontendBaseUrl } from "../../config/frontendUrl.js";
import {
  PHYSICAL_QR_CHECKOUT_METADATA_SOURCE,
  PHYSICAL_QR_CHECKOUT_PAYMENT_METHOD_TYPES,
  assertPhysicalQrCheckoutReady,
} from "../../config/physicalQrCheckout.js";
import { readPhysicalQrContactSnapshot } from "../../lib/physicalQr/shipping.js";
import {
  logPhysicalQrPerf,
  physicalQrOrderSuffix,
  physicalQrPerfNow,
} from "../../lib/physicalQr/perfLog.js";
import {
  PhysicalQrOrderError,
  createPhysicalQrCartOrder,
  getPhysicalQrOrderForBusiness,
  lockQuoteForPhysicalQrCheckout,
  releasePhysicalQrMonthlyFreeOrderClaim,
  resolveOrderItemRows,
  type CreatePhysicalQrCartInput,
  type PhysicalQrOrderRecord,
} from "./physicalQrOrder.service.js";
import { notifyPhysicalQrPaymentReceived } from "./physicalQrNotify.service.js";
import {
  persistPhysicalQrAlbertinaOrderColumns,
  clearPhysicalQrOrderMonthlyFreeQuota,
  type PhysicalQrQuote,
} from "./physicalQrPricing.service.js";

export type PhysicalQrBatchLineInput = {
  productId: unknown;
  qrContextType: unknown;
  qrSubjectId?: unknown;
  quantity?: unknown;
};

export type CreatePhysicalQrBatchInput = CreatePhysicalQrCartInput;

export function stripeLineItemsForPhysicalQrQuote(
  quote: PhysicalQrQuote,
  currency: string,
  productName: string,
): Array<{
  quantity: number;
  price_data: { currency: string; unit_amount: number; product_data: { name: string; description: string } };
}> {
  if (quote.totalCents <= 0) return [];
  return [
    {
      quantity: 1,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: quote.totalCents,
        product_data: {
          name: productName,
          description: quote.freeOrderApplied
            ? `${quote.printCount} prints (${quote.includedPrints} included, ${quote.extraPrints} extra)`
            : `${quote.printCount} prints (package + ${quote.extraPrints} extra)`,
        },
      },
    },
  ];
}

/** One checkout cart → one parent physical QR order with line items. */
export async function createPhysicalQrBatchOrders(input: CreatePhysicalQrBatchInput) {
  return createPhysicalQrCartOrder(input);
}

/**
 * Create the pending order and immediately checkout it in one request.
 * Zero-cost Pro monthly orders skip Stripe; paid orders create a Checkout session.
 */
export async function createAndCheckoutPhysicalQrBatch(input: CreatePhysicalQrBatchInput) {
  const tAll = physicalQrPerfNow();
  const tCreate = physicalQrPerfNow();
  const order = await createPhysicalQrCartOrder(input);
  logPhysicalQrPerf("create-order", physicalQrPerfNow() - tCreate, {
    orderSuffix: physicalQrOrderSuffix(order.id),
  });

  const tCheckout = physicalQrPerfNow();
  const result = await createPhysicalQrBatchCheckoutSession({
    businessId: input.businessId,
    userId: input.userId,
    orderId: order.id,
    loadedOrder: order as PhysicalQrOrderRecord,
  });
  logPhysicalQrPerf("checkout-request", physicalQrPerfNow() - tCheckout, {
    orderSuffix: physicalQrOrderSuffix(order.id),
    zeroCost: Boolean(result.zeroCost),
  });
  logPhysicalQrPerf("create-and-checkout", physicalQrPerfNow() - tAll, {
    orderSuffix: physicalQrOrderSuffix(order.id),
    zeroCost: Boolean(result.zeroCost),
  });
  return { ...result, order };
}

/** A reused Checkout Session must stay open at least this long after we hand it out. */
const QR_CHECKOUT_REUSE_MIN_REMAINING_MS = 15 * 60_000;
const QR_CHECKOUT_LEASE_TTL_MS = 60_000;
const QR_CHECKOUT_LEASE_WAIT_MS = 8_000;

/**
 * Deterministic Stripe idempotency key for one checkout attempt: the same order, amount and
 * predecessor session always map to the same key, so a retry after a crash (Stripe created the
 * session, we never stored it) returns that same session instead of creating a second one.
 */
export function physicalQrCheckoutIdempotencyKey(
  orderId: string,
  totalCents: number,
  previousSessionId: string | null,
): string {
  return `caretip_qr_checkout:${orderId}:${totalCents}:${previousSessionId ?? "initial"}`;
}

type ExistingSessionDecision =
  | { action: "reuse"; session: Stripe.Checkout.Session }
  | { action: "replace" }
  | { action: "paid" };

/** Decides what to do with the order's stored Checkout Session before creating a new one. */
async function evaluateExistingQrCheckoutSession(
  stripe: Stripe,
  sessionId: string,
  expected: { totalCents: number; currency: string },
): Promise<ExistingSessionDecision> {
  let existing: Stripe.Checkout.Session;
  try {
    existing = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    const code = (err as { code?: string; statusCode?: number })?.code;
    if (code === "resource_missing" || (err as { statusCode?: number }).statusCode === 404) {
      return { action: "replace" };
    }
    throw err;
  }
  if (existing.status === "complete" || existing.payment_status === "paid") {
    return { action: "paid" };
  }
  if (existing.status === "open") {
    const remainingMs = (existing.expires_at ?? 0) * 1000 - Date.now();
    const sameCharge =
      existing.amount_total === expected.totalCents &&
      String(existing.currency ?? "").toLowerCase() === expected.currency.toLowerCase();
    if (sameCharge && remainingMs > QR_CHECKOUT_REUSE_MIN_REMAINING_MS && existing.url) {
      return { action: "reuse", session: existing };
    }
    // Different amount or about to expire: close it first so only one session can ever be paid.
    try {
      const expired = await stripe.checkout.sessions.expire(sessionId);
      if (expired.status === "complete") return { action: "paid" };
    } catch (err) {
      const again = await stripe.checkout.sessions.retrieve(sessionId);
      if (again.status === "complete" || again.payment_status === "paid") return { action: "paid" };
      if (again.status !== "expired") throw err;
    }
  }
  return { action: "replace" };
}

/**
 * Checkout a single parent order.
 * Stripe charges the Albertina package quote (one session, one amount).
 * True €0 quotes skip Stripe after atomically claiming the monthly free order when applicable.
 *
 * Concurrency: the whole attempt runs under a per-order database lease, so concurrent requests on
 * any instance serialize. A still-open session for the same amount is reused; otherwise the old one
 * is expired before a new one is created with a deterministic idempotency key.
 */
export async function createPhysicalQrBatchCheckoutSession(input: {
  businessId: string;
  userId: string;
  orderId: string;
  loadedOrder?: PhysicalQrOrderRecord;
}): Promise<{ url: string; sessionId: string | null; zeroCost?: boolean; quote?: PhysicalQrQuote; reused?: boolean }> {
  const orderId = String(input.orderId ?? "").trim();
  if (!orderId) {
    throw new PhysicalQrOrderError("ORDER_ID_REQUIRED", "No order to checkout.", 400);
  }
  try {
    return await withPaymentOperationLease(
      `qr_checkout:${orderId}`,
      { ttlMs: QR_CHECKOUT_LEASE_TTL_MS, waitMs: QR_CHECKOUT_LEASE_WAIT_MS },
      () => createPhysicalQrBatchCheckoutSessionLocked({ ...input, orderId }),
    );
  } catch (err) {
    if (err instanceof PaymentOperationBusyError) {
      throw new PhysicalQrOrderError(
        "CHECKOUT_IN_PROGRESS",
        "Checkout for this order is already being prepared. Please try again in a moment.",
        409,
      );
    }
    throw err;
  }
}

async function createPhysicalQrBatchCheckoutSessionLocked(input: {
  businessId: string;
  userId: string;
  orderId: string;
  loadedOrder?: PhysicalQrOrderRecord;
}): Promise<{ url: string; sessionId: string | null; zeroCost?: boolean; quote?: PhysicalQrQuote; reused?: boolean }> {
  const orderId = input.orderId;
  const tFetch = physicalQrPerfNow();
  // Always re-read under the lease: another request may have paid or re-sessioned this order.
  let order = await getPhysicalQrOrderForBusiness(input.businessId, orderId);
  logPhysicalQrPerf("order-fetch", physicalQrPerfNow() - tFetch, {
    orderSuffix: physicalQrOrderSuffix(order.id),
    reused: false,
  });
  const items = resolveOrderItemRows(order);

  if (!items.length) {
    throw new PhysicalQrOrderError("ORDER_EMPTY", "This order has no printable items.", 409);
  }

  // A failed payment can be retried (PAYMENT_FAILED → PENDING_PAYMENT is an allowed transition).
  if (order.paymentStatus === "FAILED" && order.fulfillmentStatus === "PAYMENT_FAILED") {
    const reset = await prisma.physicalQrOrder.updateMany({
      where: { id: order.id, paymentStatus: "FAILED", fulfillmentStatus: "PAYMENT_FAILED" },
      data: { paymentStatus: "PENDING", fulfillmentStatus: "PENDING_PAYMENT" },
    });
    if (reset.count === 1) order = await getPhysicalQrOrderForBusiness(input.businessId, orderId);
  }

  if (order.paymentStatus !== "PENDING" || order.fulfillmentStatus !== "PENDING_PAYMENT") {
    throw new PhysicalQrOrderError("ORDER_NOT_CHECKOUTABLE", "This order cannot be paid.", 409);
  }

  for (const item of items) {
    const product = item.product;
    if (!product) {
      throw new PhysicalQrOrderError("PRODUCT_NOT_FOUND", "Order product is missing.", 409);
    }
    assertPhysicalQrCheckoutReady(product);
  }

  const printCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const tLock = physicalQrPerfNow();
  const locked = await lockQuoteForPhysicalQrCheckout({
    businessId: input.businessId,
    orderId: order.id,
    printCount,
  });
  logPhysicalQrPerf("quote-lock", physicalQrPerfNow() - tLock, {
    orderSuffix: physicalQrOrderSuffix(order.id),
  });
  const base = resolveCheckoutFrontendBaseUrl().replace(/\/+$/, "");

  const releaseClaim = async () => {
    if (locked.claimedAt) {
      await releasePhysicalQrMonthlyFreeOrderClaim({
        businessId: input.businessId,
        claimedAt: locked.claimedAt,
        previousUsedAt: locked.previousUsedAt,
      });
      await clearPhysicalQrOrderMonthlyFreeQuota(order.id);
    }
  };

  if (locked.quote.totalCents === 0) {
    const now = new Date();
    const tZero = physicalQrPerfNow();
    // Conditional: only a still-pending order becomes paid (no double transition).
    const paid = await prisma.physicalQrOrder.updateMany({
      where: { id: order.id, paymentStatus: "PENDING", fulfillmentStatus: "PENDING_PAYMENT" },
      data: {
        paymentStatus: "PAID",
        fulfillmentStatus: "PROCESSING",
        paidAt: now,
        processingAt: now,
        totalAmount: 0,
      },
    });
    if (paid.count !== 1) {
      throw new PhysicalQrOrderError("ORDER_NOT_CHECKOUTABLE", "This order cannot be paid.", 409);
    }
    await persistPhysicalQrAlbertinaOrderColumns({
      orderId: order.id,
      quote: locked.quote,
      quotaClaimedAt: locked.quotaClaimedAt,
    });
    notifyPhysicalQrPaymentReceived({ businessId: order.businessId, orderId: order.id });
    logPhysicalQrPerf("stripe-session-create", 0, {
      orderSuffix: physicalQrOrderSuffix(order.id),
      zeroCost: true,
      skipped: true,
    });
    logPhysicalQrPerf("zero-cost-complete", physicalQrPerfNow() - tZero, {
      orderSuffix: physicalQrOrderSuffix(order.id),
      zeroCost: true,
    });
    return {
      url: `${base}/dashboard/qr-studio/orders/${order.id}?checkout=success`,
      sessionId: null,
      zeroCost: true,
      quote: locked.quote,
    };
  }

  if (!isStripeConfigured()) {
    await releaseClaim();
    throw new PhysicalQrOrderError("STRIPE_NOT_CONFIGURED", "Payments are not configured.", 503);
  }

  const stripe = getStripeClient();
  const contact = readPhysicalQrContactSnapshot(order.contactSnapshot);
  const totalCents = locked.quote.totalCents;

  try {
    let previousSessionId = order.stripeCheckoutSessionId;
    if (previousSessionId) {
      const decision = await evaluateExistingQrCheckoutSession(stripe, previousSessionId, {
        totalCents,
        currency: order.currency,
      });
      if (decision.action === "reuse") {
        logPhysicalQrPerf("stripe-session-reuse", 0, { orderSuffix: physicalQrOrderSuffix(order.id) });
        return { url: decision.session.url!, sessionId: decision.session.id, quote: locked.quote, reused: true };
      }
      if (decision.action === "paid") {
        // Payment already went through; the webhook finalises the order.
        throw new PhysicalQrOrderError(
          "ORDER_PAYMENT_PROCESSING",
          "This order has already been paid. It will update in a moment.",
          409,
        );
      }
    }

    const tStripe = physicalQrPerfNow();
    let session: Stripe.Checkout.Session | null = null;
    // A cached session for the same key can already be expired; chain to a fresh key in that case.
    for (let attempt = 0; attempt < 3 && !session; attempt += 1) {
      const created = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          // Immediate-confirmation methods only; never the Dashboard default set (may include SEPA).
          payment_method_types: [...PHYSICAL_QR_CHECKOUT_PAYMENT_METHOD_TYPES],
          success_url: `${base}/dashboard/qr-studio/orders/${order.id}?checkout=success`,
          cancel_url: `${base}/dashboard/qr-studio/print?checkout=canceled`,
          ...(contact?.email ? { customer_email: contact.email } : {}),
          line_items: stripeLineItemsForPhysicalQrQuote(
            locked.quote,
            order.currency,
            items[0]?.product?.name ?? "CareTip A5 flyer",
          ),
          metadata: {
            source: PHYSICAL_QR_CHECKOUT_METADATA_SOURCE,
            orderId: order.id,
            businessId: input.businessId,
          },
          payment_intent_data: {
            metadata: {
              source: PHYSICAL_QR_CHECKOUT_METADATA_SOURCE,
              orderId: order.id,
              businessId: input.businessId,
            },
          },
        },
        { idempotencyKey: physicalQrCheckoutIdempotencyKey(order.id, totalCents, previousSessionId) },
      );
      if (created.status === "open" && created.url) {
        session = created;
      } else if (created.status === "complete" || created.payment_status === "paid") {
        throw new PhysicalQrOrderError(
          "ORDER_PAYMENT_PROCESSING",
          "This order has already been paid. It will update in a moment.",
          409,
        );
      } else {
        previousSessionId = created.id;
      }
    }
    logPhysicalQrPerf("stripe-session-create", physicalQrPerfNow() - tStripe, {
      orderSuffix: physicalQrOrderSuffix(order.id),
      zeroCost: false,
    });

    if (!session?.url) {
      throw new PhysicalQrOrderError("CHECKOUT_SESSION_FAILED", "Checkout could not be created.", 502);
    }

    const tPersist = physicalQrPerfNow();
    await prisma.physicalQrOrder.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: session.id, totalAmount: totalCents },
    });
    logPhysicalQrPerf("stripe-session-persist", physicalQrPerfNow() - tPersist, {
      orderSuffix: physicalQrOrderSuffix(order.id),
    });

    return { url: session.url, sessionId: session.id, quote: locked.quote };
  } catch (err) {
    if (!(err instanceof PhysicalQrOrderError && err.code === "ORDER_PAYMENT_PROCESSING")) {
      await releaseClaim();
    }
    throw err;
  }
}
