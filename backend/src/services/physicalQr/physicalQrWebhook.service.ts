import type Stripe from "stripe";
import { prisma } from "../../prisma.js";
import { PHYSICAL_QR_CHECKOUT_METADATA_SOURCE } from "../../config/physicalQrCheckout.js";

export async function handlePhysicalQrCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<{ ok: boolean; reason?: string; duplicate?: boolean }> {
  if (session.metadata?.source !== PHYSICAL_QR_CHECKOUT_METADATA_SOURCE) {
    return { ok: false, reason: "wrong_source" };
  }
  const orderId = session.metadata.orderId?.trim();
  const businessId = session.metadata.businessId?.trim();
  if (!orderId || !businessId) {
    return { ok: false, reason: "missing_metadata" };
  }

  const order = await prisma.physicalQrOrder.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.businessId !== businessId) return { ok: false, reason: "business_mismatch" };

  if (session.id && order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== session.id) {
    return { ok: false, reason: "session_mismatch" };
  }

  if (typeof session.amount_total === "number" && session.amount_total !== order.totalAmount) {
    return { ok: false, reason: "amount_mismatch" };
  }

  if (order.paymentStatus === "PAID") {
    return { ok: true, duplicate: true };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  await prisma.physicalQrOrder.update({
    where: { id: order.id },
    data: {
      paymentStatus: "PAID",
      fulfillmentStatus: "PROCESSING",
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      paidAt: new Date(),
      processingAt: new Date(),
    },
  });
  const { notifyPhysicalQrPaymentReceived } = await import("./physicalQrNotify.service.js");
  notifyPhysicalQrPaymentReceived({ businessId: order.businessId, orderId: order.id });
  return { ok: true };
}

export async function handlePhysicalQrCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  if (session.metadata?.source !== PHYSICAL_QR_CHECKOUT_METADATA_SOURCE) return;
  // Expired Checkout remains payable. Pay now creates a new Session on the same order.
}

export async function handlePhysicalQrPaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const orderId = paymentIntent.metadata?.orderId?.trim();
  if (!orderId || paymentIntent.metadata?.source !== PHYSICAL_QR_CHECKOUT_METADATA_SOURCE) return;
  await prisma.physicalQrOrder.updateMany({
    where: {
      id: orderId,
      paymentStatus: "PENDING",
    },
    data: {
      paymentStatus: "FAILED",
      fulfillmentStatus: "PAYMENT_FAILED",
    },
  });
}
