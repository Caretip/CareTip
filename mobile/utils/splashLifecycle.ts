import { InteractionManager } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { SPLASH_HIDE_FALLBACK_MS, STARTUP_SPLASH_MAX_MS } from "@/constants/startup";

const splashStartMs = Date.now();
let preventCalled = false;
let hideStarted = false;
let hideCompleted = false;
let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
let watchdogRevealHandler: (() => void) | null = null;

export function logSplash(phase: string, detail?: Record<string, unknown>): void {
  if (!__DEV__) return;
  const elapsed = Date.now() - splashStartMs;
  if (detail) {
    console.log(`[Splash] ${phase} (+${elapsed}ms)`, detail);
  } else {
    console.log(`[Splash] ${phase} (+${elapsed}ms)`);
  }
}

/** Reset in-memory splash flags — safe on every cold/warm JS boot. */
export function resetSplashLifecycle(): void {
  hideStarted = false;
  hideCompleted = false;
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = undefined;
  }
  logSplash("lifecycle.reset");
}

/** Call once at app entry — keeps the native splash visible until we hide explicitly. */
export function ensureSplashPrevented(): void {
  if (preventCalled) return;
  preventCalled = true;
  logSplash("preventAutoHideAsync.call");
  void SplashScreen.preventAutoHideAsync()
    .then(() => logSplash("preventAutoHideAsync.ok"))
    .catch((error) => {
      logSplash("preventAutoHideAsync.skip", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
}

resetSplashLifecycle();
ensureSplashPrevented();

function performHide(reason: string): void {
  if (hideCompleted) return;
  void SplashScreen.hideAsync()
    .then(() => {
      hideCompleted = true;
      logSplash("hideAsync.done", { reason });
    })
    .catch((error) => {
      hideStarted = false;
      logSplash("hideAsync.error", {
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
    });
}

export type HideSplashOptions = {
  duration?: number;
  fade?: boolean;
};

/**
 * Hides the native splash exactly once — only after destination reveal.
 * Does not rely solely on InteractionManager (can stall after force-close).
 */
export function hideSplashOnce(reason: string, opts?: HideSplashOptions): void {
  if (hideStarted || hideCompleted) {
    logSplash("hideAsync.skipped", { reason, hideStarted, hideCompleted });
    return;
  }
  hideStarted = true;
  logSplash("hideAsync.scheduled", { reason, duration: opts?.duration, fade: opts?.fade });

  const duration = opts?.duration ?? 0;
  const fade = opts?.fade ?? false;

  SplashScreen.setOptions?.({
    duration,
    fade,
  });

  let hideDispatched = false;
  const dispatchHide = (via: string) => {
    if (hideDispatched || hideCompleted) return;
    hideDispatched = true;
    logSplash("hideAsync.dispatch", { reason, via });
    performHide(reason);
  };

  InteractionManager.runAfterInteractions(() => dispatchHide("afterInteractions"));
  setTimeout(() => dispatchHide("fallback"), SPLASH_HIDE_FALLBACK_MS);
}

/**
 * Register the gate reveal callback for the startup watchdog.
 * Watchdog must force hide even if destination never marks ready.
 */
export function setSplashWatchdogReveal(handler: (() => void) | null): void {
  watchdogRevealHandler = handler;
  logSplash("watchdog.revealHandler", { registered: Boolean(handler) });
}

/** Absolute deadline — force native splash hide so startup cannot stick forever. */
export function scheduleSplashWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setTimeout(() => {
    logSplash("watchdog.fire", { maxMs: STARTUP_SPLASH_MAX_MS });
    hideSplashOnce("watchdog", { duration: 0, fade: false });
    try {
      watchdogRevealHandler?.();
    } catch (error) {
      logSplash("watchdog.reveal.error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, STARTUP_SPLASH_MAX_MS);
  logSplash("watchdog.scheduled", { maxMs: STARTUP_SPLASH_MAX_MS });
}

export function splashTimingOriginMs(): number {
  return splashStartMs;
}

/** Test / diagnostics helpers */
export function isNativeSplashHideCompleted(): boolean {
  return hideCompleted;
}
