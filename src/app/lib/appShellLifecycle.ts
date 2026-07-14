/**
 * App shell lifecycle — once the cold-boot CareTip overlay has dismissed,
 * SPA soft navigations must never reopen the branded global loader.
 */

let appShellInteractive = false;

/** True after the first cold-boot (or auth) overlay has fully left the screen. */
export function isAppShellInteractive(): boolean {
  return appShellInteractive;
}

/** Call when the global overlay reaches a stable hidden state after cold start. */
export function markAppShellInteractive(): void {
  appShellInteractive = true;
}

/** Test / rare recovery only — do not call from product code. */
export function resetAppShellInteractiveForTests(): void {
  appShellInteractive = false;
}

/**
 * Intentional overlays that may still cover the UI after the shell is interactive
 * (login/logout, checkout). Routine route/landing/chunk keys must never reopen it.
 */
const SOFT_NAV_ALLOWED_KEYS = new Set([
  "app-auth-bootstrap",
  "auth-login-submit",
  "auth-signup-submit",
  "auth-logout-transition",
  "auth-post-login-transition",
  "auth-invite-gate",
  "billing-plan-checkout",
  "billing-trial-checkout",
  "onboarding-submit",
  "activate-caretip",
  "payment-stripe-redirect",
  "payment-page-checkout",
  "upgrade-cta-checkout",
]);

const SOFT_NAV_ALLOWED_PREFIXES = [
  "auth-",
  "billing-",
  "payment-",
] as const;

export function isIntentionalPostShellOverlayKey(key: string): boolean {
  if (SOFT_NAV_ALLOWED_KEYS.has(key)) return true;
  if (SOFT_NAV_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (key.includes("checkout") && !key.includes("chunk")) return true;
  return false;
}

/**
 * When true, AppLoadingManager must ignore this registration — soft SPA nav.
 */
export function shouldSuppressSoftNavGlobalOverlay(key: string): boolean {
  if (!appShellInteractive) return false;
  return !isIntentionalPostShellOverlayKey(key);
}
