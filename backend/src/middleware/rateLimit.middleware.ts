import { sharedRateLimit } from "./sharedRateLimit.middleware.js";

/**
 * Auth credential rate limits use layered IP + email (+ invite) keys in
 * `authRateLimit.middleware.ts` — not IP-only express-rate-limit.
 */

/** Guest Stripe Checkout session creation (QR / public tipping). */
export const publicTipCheckoutLimiter = sharedRateLimit({
  scope: "tip-checkout",
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.TIP_CHECKOUT_MAX_PER_WINDOW ?? 30),
  message: "Too many payment attempts. Please try again later.",
});

