import { SubscriptionStatus } from "@prisma/client";

/**
 * Stripe `paused` means collection is paused on an existing subscription.
 * It is not `canceled`, not `past_due`, and must not grant CareTip product entitlements.
 * Paused Stripe subscriptions must not grant premium entitlements (product policy).
 */
export function isStripeSubscriptionStatusPaused(stripeStatus: string): boolean {
  return stripeStatus.trim().toLowerCase() === "paused";
}

/** Normalize Stripe subscription.status → contract SubscriptionStatus. */
export function mapStripeSubscriptionStatus(
  stripeStatus: string,
): { status: SubscriptionStatus; rawStripeStatus: string } {
  const raw = stripeStatus.trim();
  switch (raw) {
    case "trialing":
      return { status: SubscriptionStatus.trialing, rawStripeStatus: raw };
    case "active":
      return { status: SubscriptionStatus.active, rawStripeStatus: raw };
    case "past_due":
      return { status: SubscriptionStatus.past_due, rawStripeStatus: raw };
    case "unpaid":
      return { status: SubscriptionStatus.unpaid, rawStripeStatus: raw };
    case "canceled":
      return { status: SubscriptionStatus.canceled, rawStripeStatus: raw };
    case "incomplete":
      return { status: SubscriptionStatus.incomplete, rawStripeStatus: raw };
    case "incomplete_expired":
      return { status: SubscriptionStatus.canceled, rawStripeStatus: raw };
    case "paused":
      return { status: SubscriptionStatus.paused, rawStripeStatus: raw };
    default:
      return { status: SubscriptionStatus.incomplete, rawStripeStatus: raw };
  }
}
