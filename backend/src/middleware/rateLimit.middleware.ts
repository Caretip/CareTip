import { sharedRateLimit } from "./sharedRateLimit.middleware.js";
import { isPlausibleCheckoutSessionId } from "../lib/stripeCheckoutSessionId.js";

/**
 * Auth credential rate limits use layered IP + email (+ invite) keys in
 * `authRateLimit.middleware.ts` — not IP-only express-rate-limit.
 */

/** Guest Stripe Checkout session creation (QR / public tipping). */
/**
 * GET /api/payments/tip-session/:sessionId: the rating page polls once a second for up to 60 s
 * while the webhook lands, so a per-IP cap would break guests sharing venue Wi-Fi. The cap is per
 * session instead (a minute of polling, plus reloads), on top of the global public limit per IP.
 */
export const tipSessionLookupLimiter = sharedRateLimit({
  scope: "tip-session-lookup",
  windowMs: 15 * 60 * 1000,
  max: 150,
  message: "Too many requests for this payment. Please wait a moment and refresh.",
  // Malformed ids share one bucket: they are refused before Stripe anyway, and must not each
  // create a counter in the shared store.
  key: (req) => {
    const id = String(req.params.sessionId ?? "").trim();
    return isPlausibleCheckoutSessionId(id) ? `session:${id}` : "session:malformed";
  },
});

export const publicTipCheckoutLimiter = sharedRateLimit({
  scope: "tip-checkout",
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.TIP_CHECKOUT_MAX_PER_WINDOW ?? 30),
  message: "Too many payment attempts. Please try again later.",
});

