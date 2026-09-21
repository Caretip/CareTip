import type Stripe from "stripe";
import { BILLING_CHECKOUT_METADATA_KEYS } from "./subscriptionAuditTypes.js";
import { checkoutSessionBoundToBusiness } from "./checkoutSessionOwnership.js";

export type VerifiedPaidCheckoutSession =
  | { ok: true; session: Stripe.Checkout.Session; subscription: Stripe.Subscription }
  | { ok: false; reason: string };

function subscriptionFromSession(
  session: Stripe.Checkout.Session,
): Stripe.Subscription | null {
  const sub = session.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? null : sub;
}

function subscriptionIdFromSession(session: Stripe.Checkout.Session): string | null {
  const sub = session.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}

/**
 * Server-side verification for checkout-return sync.
 * Fail closed — never trust client success flags or URL parameters alone.
 */
export function verifyPaidCheckoutSessionForBusiness(params: {
  session: Stripe.Checkout.Session;
  businessId: string;
  subscription: Stripe.Subscription;
}): VerifiedPaidCheckoutSession {
  const { session, businessId, subscription } = params;

  if (session.mode !== "subscription") {
    return { ok: false, reason: "checkout_mode_not_subscription" };
  }
  if (session.payment_status !== "paid") {
    return { ok: false, reason: "checkout_payment_not_paid" };
  }
  if (!checkoutSessionBoundToBusiness(session, businessId)) {
    const got = session.metadata?.[BILLING_CHECKOUT_METADATA_KEYS.businessId]?.trim() ?? "";
    return {
      ok: false,
      reason: got ? "checkout_business_metadata_mismatch" : "checkout_business_metadata_missing",
    };
  }

  const sessionSubId = subscriptionIdFromSession(session);
  if (!sessionSubId) {
    return { ok: false, reason: "checkout_missing_subscription" };
  }
  if (subscription.id !== sessionSubId) {
    return { ok: false, reason: "checkout_subscription_mismatch" };
  }

  const subOwner = subscription.metadata?.[BILLING_CHECKOUT_METADATA_KEYS.businessId]?.trim() ?? "";
  if (subOwner && subOwner !== businessId) {
    return { ok: false, reason: "subscription_business_metadata_mismatch" };
  }

  if (
    subscription.status !== "active" &&
    subscription.status !== "trialing" &&
    subscription.status !== "past_due"
  ) {
    return { ok: false, reason: "subscription_not_entitled" };
  }

  return { ok: true, session, subscription };
}

export { subscriptionIdFromSession, subscriptionFromSession };
