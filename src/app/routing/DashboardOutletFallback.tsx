import { isAppShellInteractive } from "../lib/appShellLifecycle";

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
 */
export function MinimalRouteFallback() {
  if (isAppShellInteractive()) {
    return null;
  }
  return <div className="min-h-[100dvh] w-full bg-background" aria-hidden />;
}
