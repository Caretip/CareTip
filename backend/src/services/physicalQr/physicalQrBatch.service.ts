import { prisma } from "../../prisma.js";
import { getStripeClient, isStripeConfigured } from "../stripe.service.js";
import { resolveCheckoutFrontendBaseUrl } from "../../config/frontendUrl.js";
import {
  PHYSICAL_QR_CHECKOUT_METADATA_SOURCE,
  assertPhysicalQrCheckoutReady,
} from "../../config/physicalQrCheckout.js";
import { readPhysicalQrContactSnapshot } from "../../lib/physicalQr/shipping.js";
import {
  PhysicalQrOrderError,
  createPhysicalQrCartOrder,
  getPhysicalQrOrderForBusiness,
  lockQuoteForPhysicalQrCheckout,
  releasePhysicalQrMonthlyFreeOrderClaim,
  resolveOrderItemRows,
  type CreatePhysicalQrCartInput,
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
 * Checkout a single parent order.
 * Stripe charges the Albertina package quote (one session, one amount).
 * True €0 quotes skip Stripe after atomically claiming the monthly free order when applicable.
 */
export async function createPhysicalQrBatchCheckoutSession(input: {
  businessId: string;
  userId: string;
  orderId: string;
}): Promise<{ url: string; sessionId: string | null; zeroCost?: boolean; quote?: PhysicalQrQuote }> {
  const orderId = String(input.orderId ?? "").trim();
  if (!orderId) {
    throw new PhysicalQrOrderError("ORDER_ID_REQUIRED", "No order to checkout.", 400);
  }

  const order = await getPhysicalQrOrderForBusiness(input.businessId, orderId);
  const items = resolveOrderItemRows(order);

  if (!items.length) {
    throw new PhysicalQrOrderError("ORDER_EMPTY", "This order has no printable items.", 409);
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
  const locked = await lockQuoteForPhysicalQrCheckout({
    businessId: input.businessId,
    orderId: order.id,
    printCount,
  });
  const base = resolveCheckoutFrontendBaseUrl().replace(/\/+$/, "");

  if (locked.quote.totalCents === 0) {
    const now = new Date();
    await prisma.physicalQrOrder.update({
      where: { id: order.id },
      data: {
        paymentStatus: "PAID",
        fulfillmentStatus: "PROCESSING",
        paidAt: now,
        processingAt: now,
        totalAmount: 0,
      },
    });
    await persistPhysicalQrAlbertinaOrderColumns({
      orderId: order.id,
      quote: locked.quote,
      quotaClaimedAt: locked.quotaClaimedAt,
    });
    notifyPhysicalQrPaymentReceived({ businessId: order.businessId, orderId: order.id });
    return {
      url: `${base}/dashboard/qr-studio/orders/${order.id}?checkout=success`,
      sessionId: null,
      zeroCost: true,
      quote: locked.quote,
    };
  }

  if (!isStripeConfigured()) {
    if (locked.claimedAt) {
      await releasePhysicalQrMonthlyFreeOrderClaim({
        businessId: input.businessId,
        claimedAt: locked.claimedAt,
        previousUsedAt: locked.previousUsedAt,
      });
      await clearPhysicalQrOrderMonthlyFreeQuota(order.id);
    }
    throw new PhysicalQrOrderError("STRIPE_NOT_CONFIGURED", "Payments are not configured.", 503);
  }

  const stripe = getStripeClient();
  const contact = readPhysicalQrContactSnapshot(order.contactSnapshot);
  const previousSessionId = order.stripeCheckoutSessionId;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
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
    });

    if (!session.url) {
      throw new PhysicalQrOrderError("CHECKOUT_SESSION_FAILED", "Checkout could not be created.", 502);
    }

    await prisma.physicalQrOrder.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: session.id, totalAmount: locked.quote.totalCents },
    });

    if (previousSessionId && previousSessionId !== session.id) {
      try {
        await stripe.checkout.sessions.expire(previousSessionId);
      } catch {
        /* prior session may already be expired */
      }
    }

    return { url: session.url, sessionId: session.id, quote: locked.quote };
  } catch (err) {
    if (locked.claimedAt) {
      await releasePhysicalQrMonthlyFreeOrderClaim({
        businessId: input.businessId,
        claimedAt: locked.claimedAt,
        previousUsedAt: locked.previousUsedAt,
      });
      await clearPhysicalQrOrderMonthlyFreeQuota(order.id);
    }
    throw err;
  }
}
