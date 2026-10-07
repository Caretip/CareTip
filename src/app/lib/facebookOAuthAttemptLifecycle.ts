/**
 * Per-attempt browser lifecycle forensics for Facebook OAuth (privacy-safe).
 * Listeners are scoped to a single attempt and torn down on terminal outcomes.
 */

import { logFacebookOAuthDiagnostic } from "./facebookOAuthDiagnostic";

export type FacebookAttemptLifecycleSnapshot = {
  visibilityChangeCount: number;
  focusEventCount: number;
  blurEventCount: number;
  pagehideCount: number;
  pageshowCount: number;
  sawHiddenWhileAttemptActive: boolean;
  sawVisibleAfterHidden: boolean;
  sawBlurWhileAttemptActive: boolean;
  sawFocusAfterBlur: boolean;
  lastVisibilityState: string;
  lastDocumentHasFocus: boolean | null;
  /** Opener lost focus after FB.login invoke (dialog/popup may have taken focus). */
  sawBlurAfterFbLoginInvoke: boolean;
  popupLifecycleObserved: "unknown" | "focus_shift_after_invoke";
};

export type FacebookAttemptLifecycle = {
  correlationId: string;
  clickPerfNow: number;
  fbLoginInvokePerfNow: number | null;
  snapshot: () => FacebookAttemptLifecycleSnapshot;
  markFbLoginInvoked: () => void;
  dispose: () => void;
};

function readHasFocus(): boolean | null {
  if (typeof document === "undefined") return null;
  try {
    return document.hasFocus();
  } catch {
    return null;
  }
}

function readVisibility(): string {
  if (typeof document === "undefined") return "unknown";
  return document.visibilityState;
}

export function attachFacebookAttemptLifecycle(
  correlationId: string,
  clickPerfNow: number,
): FacebookAttemptLifecycle {
  let disposed = false;
  let fbLoginInvokePerfNow: number | null = null;

  let visibilityChangeCount = 0;
  let focusEventCount = 0;
  let blurEventCount = 0;
  let pagehideCount = 0;
  let pageshowCount = 0;
  let sawHiddenWhileAttemptActive = false;
  let sawVisibleAfterHidden = false;
  let sawBlurWhileAttemptActive = false;
  let sawFocusAfterBlur = false;
  let sawBlurAfterFbLoginInvoke = false;
  let lastVisibilityState = readVisibility();
  let lastDocumentHasFocus = readHasFocus();

  const msSinceUserClick = () =>
    typeof performance !== "undefined" ? performance.now() - clickPerfNow : null;

  const logLifecycle = (stage: string, extra: Record<string, unknown> = {}) => {
    logFacebookOAuthDiagnostic(stage, {
      correlationId,
      msSinceUserClick: msSinceUserClick(),
      visibilityState: readVisibility(),
      documentHasFocus: readHasFocus(),
      ...extra,
    });
  };

  const onVisibilityChange = () => {
    if (disposed) return;
    visibilityChangeCount += 1;
    const next = readVisibility();
    if (next === "hidden") sawHiddenWhileAttemptActive = true;
    if (next === "visible" && sawHiddenWhileAttemptActive) sawVisibleAfterHidden = true;
    lastVisibilityState = next;
    logLifecycle("facebook_attempt_visibility_change", {
      visibilityChangeCount,
      sawHiddenWhileAttemptActive,
      sawVisibleAfterHidden,
    });
  };

  const onFocus = () => {
    if (disposed) return;
    focusEventCount += 1;
    if (sawBlurWhileAttemptActive) sawFocusAfterBlur = true;
    lastDocumentHasFocus = true;
    logLifecycle("facebook_attempt_focus", { focusEventCount, sawFocusAfterBlur });
  };

  const onBlur = () => {
    if (disposed) return;
    blurEventCount += 1;
    sawBlurWhileAttemptActive = true;
    lastDocumentHasFocus = false;
    if (fbLoginInvokePerfNow != null) {
      sawBlurAfterFbLoginInvoke = true;
    }
    logLifecycle("facebook_attempt_blur", {
      blurEventCount,
      sawBlurAfterFbLoginInvoke,
    });
  };

  const onPageHide = () => {
    if (disposed) return;
    pagehideCount += 1;
    logLifecycle("facebook_attempt_pagehide", { pagehideCount });
  };

  const onPageShow = () => {
    if (disposed) return;
    pageshowCount += 1;
    logLifecycle("facebook_attempt_pageshow", { pageshowCount });
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
  }

  return {
    correlationId,
    clickPerfNow,
    get fbLoginInvokePerfNow() {
      return fbLoginInvokePerfNow;
    },
    markFbLoginInvoked: () => {
      fbLoginInvokePerfNow =
        typeof performance !== "undefined" ? performance.now() : clickPerfNow;
    },
    snapshot: () => {
      const popupLifecycleObserved: FacebookAttemptLifecycleSnapshot["popupLifecycleObserved"] =
        sawBlurAfterFbLoginInvoke || sawHiddenWhileAttemptActive
          ? "focus_shift_after_invoke"
          : "unknown";
      return {
        visibilityChangeCount,
        focusEventCount,
        blurEventCount,
        pagehideCount,
        pageshowCount,
        sawHiddenWhileAttemptActive,
        sawVisibleAfterHidden,
        sawBlurWhileAttemptActive,
        sawFocusAfterBlur,
        lastVisibilityState,
        lastDocumentHasFocus,
        sawBlurAfterFbLoginInvoke,
        popupLifecycleObserved,
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
      }
    },
  };
}

export function msSinceClick(clickPerfNow: number): number | null {
  if (typeof performance === "undefined") return null;
  return performance.now() - clickPerfNow;
}

export function msSinceFbInvoke(
  clickPerfNow: number,
  fbLoginInvokePerfNow: number | null,
): number | null {
  if (fbLoginInvokePerfNow == null || typeof performance === "undefined") return null;
  return performance.now() - fbLoginInvokePerfNow;
}
