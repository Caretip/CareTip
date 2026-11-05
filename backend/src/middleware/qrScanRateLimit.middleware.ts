import { sharedRateLimit } from "./sharedRateLimit.middleware.js";

/**
 * Abuse protection for POST /api/qr/scan (guest analytics only).
 * Conservative vs slug lookup: a venue may see many distinct devices, but not hundreds per IP.
 *
 * Default: 90 requests / 15 minutes / IP (env SEC_QR_SCAN_IP_MAX_PER_15M).
 * Does not apply to tipping-context or checkout routes.
 */
export const qrScanRateLimit = sharedRateLimit({
  scope: "qr-scan",
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.SEC_QR_SCAN_IP_MAX_PER_15M ?? 90),
  message: "Too many requests. Please try again later.",
});
