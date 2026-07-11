/**
 * Routes that must not block on session bootstrap for anonymous visitors.
 * Authenticated restore (stored credentials) may still show the global loader briefly
 * on protected routes — never on public marketing or auth shell paths.
 */

import { isPublicAuthenticationPath } from "./authSession";

const PUBLIC_MARKETING_EXACT = new Set([
  "/",
  "/pricing",
  "/features",
  "/faq",
  "/contact",
  "/privacy",
  "/terms",
  "/cookies",
  "/imprint",
  "/help",
  "/blog",
  "/careers",
  "/how-it-works",
  "/mobile-app",
  "/join",
  "/join/signup",
  "/get-started",
  "/tip-amount",
  "/payment",
  "/success",
  "/rating",
  "/tip-complete",
  "/select-employee",
]);

const PUBLIC_MARKETING_PREFIXES = [
  "/join/",
  "/qr-landing/",
  "/qr/business/",
  "/qr/employee/",
  "/qr/location/",
  "/qr/table/",
  "/table/",
  "/staff/",
  "/forgot-password",
  "/reset-password/",
  "/activate",
  "/verify",
  "/verify-email",
  "/check-email",
];

/**
 * Static first-segment paths registered in routes.tsx — must not match `/{businessSlug}`.
 */
const RESERVED_TOP_LEVEL_SEGMENTS = new Set([
  "admin",
  "auth",
  "activate",
  "blog",
  "business",
  "business-dashboard",
  "careers",
  "check-email",
  "contact",
  "cookies",
  "create-rule",
  "create-skill",
  "dashboard",
  "employee",
  "employee-dashboard",
  "faq",
  "features",
  "forgot-password",
  "get-started",
  "help",
  "hero-animation-demo",
  "hero-demo",
  "how-it-works",
  "imprint",
  "join",
  "login",
  "mobile-app",
  "onboarding",
  "payment",
  "platform-admin",
  "pricing",
  "privacy",
  "qr",
  "qr-landing",
  "rating",
  "reset-password",
  "saas-3d-hero",
  "select-employee",
  "signup",
  "staff",
  "success",
  "table",
  "terms",
  "tip-amount",
  "tip-complete",
  "unauthorized",
  "verification-pending",
  "verify",
  "verify-email",
]);

/** `/{businessSlug}` and `/{businessSlug}/{employeeSlug}` public team QR paths. */
function isPublicBusinessSlugPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 1 && segments.length !== 2) return false;
  const head = segments[0]?.toLowerCase() ?? "";
  if (!head || RESERVED_TOP_LEVEL_SEGMENTS.has(head)) return false;
  return segments.every((seg) => seg.length > 0 && !seg.includes("."));
}

/** Guest tipping / marketing surfaces — no dashboard or onboarding init required. */
export function isPublicMarketingPath(pathname: string): boolean {
  const p = pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (PUBLIC_MARKETING_EXACT.has(p)) return true;
  if (PUBLIC_MARKETING_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix))) {
    return true;
  }
  return isPublicBusinessSlugPath(p);
}

/**
 * Public pages that must render immediately — marketing, auth forms, guest tip flows.
 * Used to skip the global bootstrap overlay and auth-init blocking.
 */
export function isPublicShellPath(pathname: string): boolean {
  const p = pathname.split("?")[0]?.split("#")[0] ?? "/";
  return isPublicMarketingPath(p) || isPublicAuthenticationPath(p);
}
