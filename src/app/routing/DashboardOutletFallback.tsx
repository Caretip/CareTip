import { isAppShellInteractive } from "../lib/appShellLifecycle";
import { isAuthLogoutTransitionActive } from "../lib/authLogoutTransition";
import { isAuthPostLoginTransitionActive } from "../lib/authPostLoginTransition";

/**
 * In-layout lazy-route hold — background only; login/refresh use the global overlay spinner.
 */
export function DashboardOutletShellHold() {
  return <div className="min-h-[min(50vh,420px)] w-full bg-background" aria-hidden />;
}

/** Full-page lazy hold outside dashboard shell. */
export function DashboardOutletFallback() {
  return <div className="min-h-[min(50vh,420px)] w-full bg-background" aria-hidden />;
}

/**
 * Top-level public route chunk hold.
 * Cold entry: full-viewport surface under the branded loader.
 * Soft SPA nav: invisible — never flash a blank full page over the live shell.
 * Sign In handoff: null — Login cover owns the viewport (never blank white under it).
 * Logout: opaque hold while the login route mounts (no branded CareTip overlay).
 */
export function MinimalRouteFallback() {
  if (typeof document !== "undefined" && document.documentElement.dataset.authSignInHandoff === "1") {
    return null;
  }
  if (isAuthLogoutTransitionActive()) {
    return <div className="min-h-[100dvh] w-full bg-background" aria-hidden />;
  }
  if (isAuthPostLoginTransitionActive() || isAppShellInteractive()) {
    return null;
  }
  return <div className="min-h-[100dvh] w-full bg-background" aria-hidden />;
}
