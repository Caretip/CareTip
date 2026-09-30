import { physicalQrPublicOrigin } from "./physicalQr/publicUrl.js";
import { isLocalCheckoutHostname } from "../config/frontendUrl.js";
import { BrandedQrInvalidTargetUrlError } from "../services/qr/brandedQr.errors.js";

const BLOCKED_SCHEMES = /^(javascript|data|file|vbscript|blob):/i;

/** Guest tipping paths allowed in manager branded QR `targetUrl` (CareTip-controlled only). */
const CARETIP_GUEST_PATH =
  /^\/(?:qr-landing\/[^/]+|qr\/(?:business|employee|location|table)\/[^/]+|table\/[a-zA-Z0-9_-]{3,128}|staff\/[^/]+|tip-amount|tip-complete|payment|success|rating)(?:\/|$)/;

const CARETIP_SLUG_GUEST_PATH = /^\/[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]*)?\/?$/;

function collectAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const candidates = [
    process.env.PUBLIC_APP_ORIGIN,
    process.env.APP_PUBLIC_URL,
    process.env.FRONTEND_URL,
    physicalQrPublicOrigin(),
  ];
  for (const raw of candidates) {
    const t = raw?.trim();
    if (!t) continue;
    try {
      const u = new URL(t.includes("://") ? t : `https://${t}`);
      origins.add(u.origin.toLowerCase());
    } catch {
      /* skip */
    }
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  return origins;
}

function isAllowedGuestPath(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (!path || path === "/") return false;
  if (CARETIP_GUEST_PATH.test(path)) return true;
  if (CARETIP_SLUG_GUEST_PATH.test(path)) {
    const blocked = new Set([
      "login",
      "join",
      "dashboard",
      "employee",
      "platform-admin",
      "onboarding",
      "pricing",
      "features",
      "contact",
      "api",
    ]);
    const first = path.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
    return first.length > 0 && !blocked.has(first);
  }
  return false;
}

/**
 * Manager branded QR must encode CareTip guest journey URLs only (matches server-resolved physical QR URLs).
 * Employee branded QR uses server-resolved URLs and does not call this helper.
 */
export function assertCareTipBrandedQrTargetUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new BrandedQrInvalidTargetUrlError("targetUrl is required");
  }
  if (BLOCKED_SCHEMES.test(trimmed) || trimmed.includes("\\")) {
    throw new BrandedQrInvalidTargetUrlError("Invalid target URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BrandedQrInvalidTargetUrlError("Invalid target URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BrandedQrInvalidTargetUrlError("Target URL must use HTTP or HTTPS");
  }

  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new BrandedQrInvalidTargetUrlError("Target URL must use HTTPS");
  }

  const host = parsed.hostname.toLowerCase();
  if (process.env.NODE_ENV === "production" && isLocalCheckoutHostname(host)) {
    throw new BrandedQrInvalidTargetUrlError("Invalid target URL host");
  }

  const allowed = collectAllowedOrigins();
  if (!allowed.has(parsed.origin.toLowerCase())) {
    throw new BrandedQrInvalidTargetUrlError("Target URL must point to your CareTip guest site");
  }

  if (!isAllowedGuestPath(parsed.pathname)) {
    throw new BrandedQrInvalidTargetUrlError("Target URL must be a CareTip guest tipping link");
  }

  if (parsed.username || parsed.password) {
    throw new BrandedQrInvalidTargetUrlError("Invalid target URL");
  }

  return parsed.toString();
}
