import { InteractionManager } from "react-native";
import * as SplashScreen from "expo-splash-screen";

const splashStartMs = Date.now();
let preventCalled = false;
let hideStarted = false;
let hideCompleted = false;

export function logSplash(phase: string, detail?: Record<string, unknown>): void {
  if (!__DEV__) return;
  const elapsed = Date.now() - splashStartMs;
  if (detail) {
    console.log(`[Splash] ${phase} (+${elapsed}ms)`, detail);
  } else {
    console.log(`[Splash] ${phase} (+${elapsed}ms)`);
  }
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

ensureSplashPrevented();

/**
 * Hides the native splash exactly once, after interactions settle.
 * Safe to call from multiple readiness hooks — only the first invocation runs.
 */
export function hideSplashOnce(reason: string): void {
  if (hideStarted || hideCompleted) {
    logSplash("hideAsync.skipped", { reason, hideStarted, hideCompleted });
    return;
  }
  hideStarted = true;
  logSplash("hideAsync.scheduled", { reason });

  SplashScreen.setOptions?.({
    duration: 320,
    fade: true,
  });

  InteractionManager.runAfterInteractions(() => {
    requestAnimationFrame(() => {
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
    });
  });
}

export function splashTimingOriginMs(): number {
  return splashStartMs;
}
