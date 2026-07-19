import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingOverlayActive,
  useAppLoadingRegistration,
} from "../context/AppLoadingManager";
import {
  isAuthPostLoginTransitionActive,
  signalPostLoginDashboardShellReady,
  subscribeAuthPostLoginTransition,
} from "./authPostLoginTransition";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "./authLogoutTransition";
import {
  isAuthSignInHandoffActive,
  subscribeAuthSignInHandoff,
} from "./authSignInHandoff";
import { traceLoaderFlag } from "./loaderDiagFlags";
import { globalAppLoadingHoldClassName } from "./globalAppLoadingHoldClassName";
import { markPostLoginTrace } from "./postLoginRuntimeTrace";

export { APP_LOADING_PRIORITY, useAppLoadingOverlayActive, useAppLoadingRegistration };
export { globalAppLoadingHoldClassName };

/** Single source of truth: is the global fullscreen loader visible? */
export function useGlobalAppLoadingActive(): boolean {
  return useAppLoadingOverlayActive();
}

/**
 * Register page-critical initialization with the global overlay.
 * Never pair with a page-level fullscreen spinner — use {@link GlobalAppLoadingHold} under the overlay.
 */
export function useRegisterGlobalAppInit(
  key: string,
  active: boolean,
  message?: string,
): void {
  useAppLoadingRegistration(key, APP_LOADING_PRIORITY.APP_INIT, active, message);
}

function useUserJourneyOverlayOwnsScreen(): boolean {
  const postLoginActive = useSyncExternalStore(
    subscribeAuthPostLoginTransition,
    isAuthPostLoginTransitionActive,
    () => false,
  );
  const logoutActive = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );
  return postLoginActive || logoutActive;
}

type PagePaintReadyOptions = {
  /** Fires after the one-frame paint latch releases (shell commit). */
  onPaintReleased?: () => void;
};

/**
 * One-frame overlay extension while auth/guards are active — never re-opens after dismiss.
 * Technical paint keys are excluded from overlay winner selection; they must not replace user journeys.
 */
export function useRegisterPagePaintReady(
  registrationKey: string,
  enabled = true,
  options?: PagePaintReadyOptions,
): void {
  const userJourneyOwnsScreen = useUserJourneyOverlayOwnsScreen();
  const overlayVisible = useAppLoadingOverlayActive();
  const latchedOnMountRef = useRef(false);
  const [paintReleased, setPaintReleased] = useState(false);
  const onPaintReleased = options?.onPaintReleased;

  if (enabled && overlayVisible && !latchedOnMountRef.current && !paintReleased) {
    latchedOnMountRef.current = true;
    if (import.meta.env.DEV) {
      void import("./postLoginRuntimeTrace").then(({ markPostLoginTrace }) => {
        markPostLoginTrace("paint_latch_armed", {
          registrationKey,
          enabled,
          overlayVisible,
          userJourneyOwnsScreen,
        });
      });
    }
  }

  useLayoutEffect(() => {
    if (!enabled || !latchedOnMountRef.current) {
      if (import.meta.env.DEV && enabled) {
        void import("./postLoginRuntimeTrace").then(({ markPostLoginTrace }) => {
          markPostLoginTrace("paint_latch_effect_skip", {
            registrationKey,
            enabled,
            latched: latchedOnMountRef.current,
            overlayVisible,
          });
        });
      }
      return;
    }
    setPaintReleased(true);
    traceLoaderFlag("pageReady", false, registrationKey);
    if (import.meta.env.DEV) {
      void import("./postLoginRuntimeTrace").then(({ markPostLoginTrace }) => {
        markPostLoginTrace("paint_latch_released", {
          registrationKey,
          willCallOnPaintReleased: Boolean(onPaintReleased),
        });
      });
    }
    onPaintReleased?.();
  }, [enabled, registrationKey, onPaintReleased]);

  const holdForPaint =
    enabled &&
    latchedOnMountRef.current &&
    !paintReleased &&
    !userJourneyOwnsScreen;

  if (holdForPaint) {
    traceLoaderFlag("pageReady", true, registrationKey);
  }

  useRegisterGlobalAppInit(registrationKey, holdForPaint);
}

/**
 * Dashboard shell paint + post–Sign In handoff signal.
 *
 * Cold boot still uses the overlay paint latch via {@link useRegisterPagePaintReady}.
 * Sign In soft-nav intentionally clears that overlay, so shell-ready must signal from
 * layout commit itself — not from overlayVisible.
 */
export function useDashboardLayoutPaintReady(registrationKey: string, enabled = true): void {
  useRegisterPagePaintReady(registrationKey, enabled, {
    onPaintReleased: signalPostLoginDashboardShellReady,
  });

  const postLoginActive = useSyncExternalStore(
    subscribeAuthPostLoginTransition,
    isAuthPostLoginTransitionActive,
    () => false,
  );
  const signInHandoffActive = useSyncExternalStore(
    subscribeAuthSignInHandoff,
    isAuthSignInHandoffActive,
    () => false,
  );
  const signaledRef = useRef(false);

  useLayoutEffect(() => {
    if (!enabled) {
      signaledRef.current = false;
      return;
    }
    // Soft-nav Sign In / post-login: dashboard shell paint is the proof — do not wait on overlay.
    if (!postLoginActive && !signInHandoffActive) return;
    if (signaledRef.current) return;
    signaledRef.current = true;
    if (import.meta.env.DEV) {
      markPostLoginTrace("dashboard_shell_ready_signaled", {
        registrationKey,
        postLoginActive,
        signInHandoffActive,
        via: "layout_commit_without_overlay",
      });
    }
    signalPostLoginDashboardShellReady();
  }, [enabled, postLoginActive, signInHandoffActive, registrationKey]);
}
