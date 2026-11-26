/**
 * Stripe Checkout Session ids look like cs_test_… / cs_live_… followed by letters and digits.
 * Public endpoints check the shape before calling Stripe, so a made-up id costs neither a Stripe
 * API request (CareTip's Stripe rate limit is shared with real payments) nor a Sentry event.
 */
const CHECKOUT_SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,250}$/;

export function isPlausibleCheckoutSessionId(value: string): boolean {
  return CHECKOUT_SESSION_ID.test(value);
}
