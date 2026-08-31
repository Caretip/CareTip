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
  resolveOrderItemRows,
  type CreatePhysicalQrCartInput,
} from "./physicalQrOrder.service.js";
import { notifyPhysicalQrPaymentReceived } from "./physicalQrNotify.service.js";

export type PhysicalQrBatchLineInput = {
  productId: unknown;
  qrContextType: unknown;
  qrSubjectId?: unknown;
  quantity?: unknown;
};

export type CreatePhysicalQrBatchInput = CreatePhysicalQrCartInput;

/** One checkout cart → one parent physical QR order with line items. */
export async function createPhysicalQrBatchOrders(input: CreatePhysicalQrBatchInput) {
  return createPhysicalQrCartOrder(input);
}

/**
 * Checkout a single parent order. Stripe line items are built from order line items.
 * Zero-cost Pro orders skip Stripe and mark the parent PAID immediately.
 */
export async function createPhysicalQrBatchCheckoutSession(input: {
  businessId: string;
  userId: string;
  orderId: string;
}): Promise<{ url: string; sessionId: string | null; zeroCost?: boolean }> {
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

  const base = resolveCheckoutFrontendBaseUrl().replace(/\/+$/, "");

  if (order.totalAmount === 0) {
    const now = new Date();
    await prisma.physicalQrOrder.update({
      where: { id: order.id },
      data: {
        paymentStatus: "PAID",
        fulfillmentStatus: "PROCESSING",
        paidAt: now,
        processingAt: now,
      },
    });
    notifyPhysicalQrPaymentReceived({ businessId: order.businessId, orderId: order.id });
    return {
      url: `${base}/dashboard/qr-studio/orders/${order.id}?checkout=success`,
      sessionId: null,
      zeroCost: true,
    };
  }

  if (!isStripeConfigured()) {
    throw new PhysicalQrOrderError("STRIPE_NOT_CONFIGURED", "Payments are not configured.", 503);
  }

  const stripe = getStripeClient();
  const contact = readPhysicalQrContactSnapshot(order.contactSnapshot);

  if (order.stripeCheckoutSessionId) {
    try {
      await stripe.checkout.sessions.expire(order.stripeCheckoutSessionId);
    } catch {
      /* prior session may be done */
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${base}/dashboard/qr-studio/orders/${order.id}?checkout=success`,
    cancel_url: `${base}/dashboard/qr-studio/print?checkout=canceled`,
    ...(contact?.email ? { customer_email: contact.email } : {}),
    line_items: items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "eur",
        unit_amount: item.unitPrice,
        product_data: {
          name: item.product?.name ?? "CareTip A5 flyer",
          description: `${item.labelSnapshot} (${item.qrContextType})`,
        },
      },
    })),
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
    data: { stripeCheckoutSessionId: session.id },
  });

  return { url: session.url, sessionId: session.id };
}
