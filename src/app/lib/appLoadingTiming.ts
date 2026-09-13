/** Presentation-only timing — never delays API calls or navigation. */

export const OVERLAY_SHOW_THRESHOLD_MS = 200;
export const OVERLAY_EXIT_DEBOUNCE_MS = 120;
export const OVERLAY_FADE_MS = 180;

/**
 * Do not keep the branded overlay on screen after work is done.
 * A non-zero floor caused HTML boot → React overlay remounts to feel like a second loader.
 */
export const DEFAULT_MIN_OVERLAY_VISIBLE_MS = 0;
export const PREMIUM_MIN_OVERLAY_VISIBLE_MS = 0;

/**
 * Minimum time AppBrandedLoadingScreen stays mounted after becoming visible.
 * Always 0 — show-threshold already skips flashes for sub-200ms work.
 */
export function resolveMinOverlayVisibleMs(_winnerKey: string | null | undefined): number {
  return 0;
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
    winnerKey === "onboarding-init" ||
    winnerKey === "onboarding-submit" ||
    winnerKey === "payment-stripe-redirect" ||
    winnerKey === "payment-page-checkout" ||
    (typeof winnerKey === "string" && winnerKey.includes("checkout"))
  );
}
