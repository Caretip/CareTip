/** Presentation-only timing — never delays API calls or navigation. */

export const OVERLAY_SHOW_THRESHOLD_MS = 200;
export const OVERLAY_EXIT_DEBOUNCE_MS = 120;
export const OVERLAY_FADE_MS = 180;

/** Default once the branded overlay is shown — long enough to read, short for routine guards. */
export const DEFAULT_MIN_OVERLAY_VISIBLE_MS = 320;

/**
 * Premium flows deserve a longer branded moment (startup, QR, checkout, logout).
 * Still presentation-only — work underneath is not artificially delayed.
 */
export const PREMIUM_MIN_OVERLAY_VISIBLE_MS = 720;

const PREMIUM_OVERLAY_KEYS = new Set([
  "app-boot",
  "billing-plan-checkout",
  "billing-trial-checkout",
  "onboarding-submit",
  "activate-caretip",
  "payment-stripe-redirect",
  "payment-page-checkout",
]);

const PREMIUM_OVERLAY_PREFIXES = [
  "caretip-page-loader:",
  "staff-landing",
  "staff-public-path-entry",
  "employee-qr-entry",
  "table-qr-loading",
  "location-qr-loading",
  "qr-landing",
  "tip-amount-journey",
  "platform-admin-route-guard",
  "business-staff-directory",
  "select-employee",
  "success-page-verification",
  "tip-completion-loading",
  "rating-page-verification",
] as const;

const PREMIUM_OVERLAY_SUBSTRINGS = ["payment", "checkout"] as const;

/**
 * Minimum time AppBrandedLoadingScreen stays mounted after becoming visible.
 */
export function resolveMinOverlayVisibleMs(winnerKey: string | null | undefined): number {
  if (!winnerKey) return DEFAULT_MIN_OVERLAY_VISIBLE_MS;
  if (PREMIUM_OVERLAY_KEYS.has(winnerKey)) return PREMIUM_MIN_OVERLAY_VISIBLE_MS;
  if (PREMIUM_OVERLAY_PREFIXES.some((prefix) => winnerKey.startsWith(prefix))) {
    return PREMIUM_MIN_OVERLAY_VISIBLE_MS;
  }
  if (PREMIUM_OVERLAY_SUBSTRINGS.some((part) => winnerKey.includes(part))) {
    return PREMIUM_MIN_OVERLAY_VISIBLE_MS;
  }
  return DEFAULT_MIN_OVERLAY_VISIBLE_MS;
}

/**
 * Handoffs that must cover the next paint immediately — no 200ms uncovered window.
 * Cold boot + intentional auth journeys keep one continuous CareTip surface.
 * Soft SPA remounts (landing-shell-ready, etc.) never bypass — they must not show.
 */
export function shouldBypassOverlayShowThreshold(
  winnerKey: string | null | undefined,
  initialColdBootPending: boolean,
): boolean {
  if (initialColdBootPending) return true;
  return (
    winnerKey === "app-boot" ||
    winnerKey === "payment-stripe-redirect" ||
    winnerKey === "payment-page-checkout" ||
    (typeof winnerKey === "string" && winnerKey.includes("checkout"))
  );
}
