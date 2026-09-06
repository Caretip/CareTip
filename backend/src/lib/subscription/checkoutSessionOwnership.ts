import { BILLING_CHECKOUT_METADATA_KEYS } from "./subscriptionAuditTypes.js";

/**
 * Checkout-return sync must not apply a Stripe Checkout Session to a CareTip
 * business unless session metadata names that business.
 *
 * Fail closed when `caretipBusinessId` is missing (same rule as billing webhooks).
 */
export function checkoutSessionBoundToBusiness(
  session: { metadata?: Record<string, string> | null },
  businessId: string,
): boolean {
  const expected = businessId.trim();
  if (!expected) return false;
  const got = session.metadata?.[BILLING_CHECKOUT_METADATA_KEYS.businessId]?.trim() ?? "";
  return Boolean(got) && got === expected;
}
