/**
 * Pure splash handoff policy — used by NativeSplashGate + regression tests.
 * Native Expo splash only; no React splash visuals.
 */

/** Boot stubs must never unlock the splash reveal. */
export const SPLASH_BLOCKED_FIRST_SCREEN_SOURCES = new Set([
  "index",
  "boot",
  "index-boot",
]);

export function canMarkFirstScreenReady(source: string): boolean {
  const normalized = source.trim().toLowerCase();
  if (!normalized) return false;
  return !SPLASH_BLOCKED_FIRST_SCREEN_SOURCES.has(normalized);
}

/** Normal reveal: bootstrap + router + real destination paint. */
export function shouldRevealAfterDestination(input: {
  bootstrapReady: boolean;
  navigationReady: boolean;
  firstScreenReady: boolean;
}): boolean {
  return input.bootstrapReady && input.navigationReady && input.firstScreenReady;
}

/**
 * Fallback after destination should have painted — still requires bootstrap + nav
 * so the dashboard cannot appear before session routing is resolved.
 */
export function shouldRevealAfterFallback(input: {
  bootstrapReady: boolean;
  navigationReady: boolean;
}): boolean {
  return input.bootstrapReady && input.navigationReady;
}

/** Hard deadline must always release the native splash. */
export function shouldForceRevealOnWatchdog(watchdogFired: boolean): boolean {
  return watchdogFired;
}
