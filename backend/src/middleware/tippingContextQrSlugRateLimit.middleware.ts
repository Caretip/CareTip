import rateLimit from "express-rate-limit";

/**
 * Abuse protection for public QR slug endpoint:
 * - mitigates slug enumeration/scraping
 * - throttles both failed lookups and repeated guesses
 *
 * This is IP-based (public endpoint). Keep it conservative enough to avoid
 * breaking real QR scanning, but low enough to slow automated guessing.
 */
export const tippingContextQrSlugLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.SEC_TIPPING_QR_SLUG_IP_MAX_PER_15M ?? 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});

