import type Stripe from "stripe";
import { prisma } from "../../prisma.js";
import { getStripeClient, isStripeConfigured } from "../stripe.service.js";
import { resolveCheckoutFrontendBaseUrl } from "../../config/frontendUrl.js";
import {
  PHYSICAL_QR_CHECKOUT_METADATA_SOURCE,
  assertPhysicalQrCheckoutReady,
} from "../../config/physicalQrCheckout.js";
import { PhysicalQrOrderError, getPhysicalQrOrderForBusiness } from "./physicalQrOrder.service.js";

/**
 * Dedicated platform Checkout for physical products.
 * Must never use Connect destination / tip PaymentIntent flows.
 */
export async function createPhysicalQrCheckoutSession(input: {
  businessId: string;
  userId: string;
  orderId: string;
}): Promise<{ url: string; sessionId: string }> {
  const order = await getPhysicalQrOrderForBusiness(input.businessId, input.orderId);
  if (order.paymentStatus === "FAILED" && order.fulfillmentStatus === "PAYMENT_FAILED") {
    await prisma.physicalQrOrder.update({
      where: { id: order.id },
      data: { paymentStatus: "PENDING", fulfillmentStatus: "PENDING_PAYMENT" },
    });
    order.paymentStatus = "PENDING";
    order.fulfillmentStatus = "PENDING_PAYMENT";
  }
  if (order.paymentStatus !== "PENDING" || order.fulfillmentStatus !== "PENDING_PAYMENT") {
    throw new PhysicalQrOrderError("ORDER_NOT_CHECKOUTABLE", "This order cannot be paid.", 409);
  }
  const product = order.product;
  assertPhysicalQrCheckoutReady(product);
  if (!isStripeConfigured()) {
    throw new PhysicalQrOrderError("STRIPE_NOT_CONFIGURED", "Payments are not configured.", 503);
  }

  const base = resolveCheckoutFrontendBaseUrl().replace(/\/+$/, "");
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${base}/dashboard/qr-studio/branding/orders/${order.id}?checkout=success`,
    cancel_url: `${base}/dashboard/qr-studio/branding/orders/${order.id}?checkout=canceled`,
    line_items: [
      {
        quantity: order.quantity,
        price_data: {
          currency: "eur",
          unit_amount: order.unitPrice,
          product_data: {
            name: product.name,
            description: `Physical CareTip QR print (${order.qrContextType})`,
          },
        },
      },
    ],
    metadata: {
      source: PHYSICAL_QR_CHECKOUT_METADATA_SOURCE,
      orderId: order.id,
      businessId: order.businessId,
    },
    payment_intent_data: {
      metadata: {
        source: PHYSICAL_QR_CHECKOUT_METADATA_SOURCE,
        orderId: order.id,
        businessId: order.businessId,
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

export function isPhysicalQrCheckoutSession(session: Stripe.Checkout.Session): boolean {
  return session.metadata?.source === PHYSICAL_QR_CHECKOUT_METADATA_SOURCE;
}
