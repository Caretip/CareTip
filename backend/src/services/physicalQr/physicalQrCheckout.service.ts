import type Stripe from "stripe";
import {
  PHYSICAL_QR_CHECKOUT_METADATA_SOURCE,
} from "../../config/physicalQrCheckout.js";
import { PhysicalQrOrderError } from "./physicalQrOrder.service.js";
import { createPhysicalQrBatchCheckoutSession } from "./physicalQrBatch.service.js";

/**
 * Dedicated platform Checkout for physical products.
 * Must never use Connect destination / tip PaymentIntent flows.
 * Amount is the Albertina package quote (same path as batch checkout).
 */
export async function createPhysicalQrCheckoutSession(input: {
  businessId: string;
  userId: string;
  orderId: string;
}): Promise<{ url: string; sessionId: string }> {
  const result = await createPhysicalQrBatchCheckoutSession(input);
  if (result.zeroCost || !result.sessionId || !result.url) {
    if (result.zeroCost && result.url) {
      return { url: result.url, sessionId: result.sessionId ?? "" };
    }
    throw new PhysicalQrOrderError("CHECKOUT_SESSION_FAILED", "Checkout could not be created.", 502);
  }
  return { url: result.url, sessionId: result.sessionId };
}

export function isPhysicalQrCheckoutSession(session: Stripe.Checkout.Session): boolean {
  return session.metadata?.source === PHYSICAL_QR_CHECKOUT_METADATA_SOURCE;
}
