import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppBrandedLoadingScreen } from "../components/AppBrandedLoadingScreen";
import {
  APP_LOADING_PRIORITY,
  GLOBAL_OVERLAY_PRIORITIES,
  type AppLoadingPriority,
} from "../lib/appLoadingPriority";
import {
  traceGlobalLoaderBlocking,
  traceGlobalLoaderReady,
  traceGlobalOverlayDismissed,
} from "../lib/globalAppLoadingTrace";
import {
  beginHtmlBootBridgeExit,
  dismissHtmlMarketingBootBridge,
  isHtmlBootBridgeActive,
  setHtmlBootBridgeMessage,
  setHtmlBootBridgeSub,
} from "../lib/htmlMarketingBootBridge";
import { resolveInitialBootLoadingMessage } from "../lib/appLoadingContexts";
import i18n from "@/i18n/i18n";
import { traceLoaderRegistration, warnLoaderDiagDeadlock } from "../lib/loaderDiagFlags";
import {
  OVERLAY_EXIT_DEBOUNCE_MS,
  OVERLAY_FADE_MS,
  OVERLAY_SHOW_THRESHOLD_MS,
  resolveMinOverlayVisibleMs,
  shouldBypassOverlayShowThreshold,
} from "../lib/appLoadingTiming";
import {
  pickOverlayMessage,
  pickOverlayWinner,
  isTechnicalOverlayRegistration,
} from "../lib/appLoadingJourney";
import {
  isIntentionalPostShellOverlayKey,
  markAppShellInteractive,
  shouldSuppressSoftNavGlobalOverlay,
} from "../lib/appShellLifecycle";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "../lib/authLogoutTransition";
import {
  isAuthPostLoginTransitionActive,
  subscribeAuthPostLoginTransition,
} from "../lib/authPostLoginTransition";
/** Block APP_INIT from re-opening the overlay shortly after a full dismiss (paint-ready race). */
const OVERLAY_REENTRY_LOCK_MS = 600;

type Registration = {
  key: string;
  priority: AppLoadingPriority;
  message?: string;
};

type AppLoadingManagerContextValue = {
  register: (
    key: string,
    priority: AppLoadingPriority,
    active: boolean,
    message?: string,
  ) => void;
  releaseAppBootOverlay: () => void;
  overlayVisible: boolean;
};

const AppLoadingManagerContext = createContext<AppLoadingManagerContextValue | null>(null);

export function useAppLoadingRegistration(
  key: string,
  priority: AppLoadingPriority,
  active: boolean,
  message?: string,
): void {
  const ctx = useContext(AppLoadingManagerContext);
  const register = ctx?.register;

  useLayoutEffect(() => {
    if (!register) return;
    register(key, priority, active, message);
    return () => {
      register(key, priority, false);
    };
  }, [register, key, priority, active, message]);
}

/** Drop the initial app-boot registration (public routes render without the bootstrap overlay). */
export function useReleaseAppBootOverlay(): () => void {
  const ctx = useContext(AppLoadingManagerContext);
  return ctx?.releaseAppBootOverlay ?? (() => undefined);
}

type OverlayPhase = "hidden" | "visible" | "exiting";

const BOOTSTRAP_KEY = "app-boot";
/** Safety net — never leave the initial bootstrap key as the only active overlay. */
const BOOTSTRAP_OVERLAY_MAX_MS = 15_000;

function readInitialPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname.split("?")[0]?.split("#")[0] ?? "/";
}

/**
 * Initial bootstrap overlay for every cold load (URL entry, refresh, deep link).
 * Always registers so React matches the HTML CareTip boot — no path-based gap.
 */
function shouldRegisterInitialAppBoot(_pathname: string): boolean {
  return true;
}

function createInitialRegistrations(): Map<string, Registration> {
  const initial = new Map<string, Registration>();
  if (!shouldRegisterInitialAppBoot(readInitialPathname())) {
    return initial;
  }
  initial.set(BOOTSTRAP_KEY, {
    key: BOOTSTRAP_KEY,
    priority: APP_LOADING_PRIORITY.AUTH,
    message: resolveInitialBootLoadingMessage(readInitialPathname(), i18n.t.bind(i18n)),
  });
  return initial;
}

function createInitialOverlayPhase(): OverlayPhase {
  if (!shouldRegisterInitialAppBoot(readInitialPathname())) return "hidden";
  return "visible";
}

function subscribeAuthIntentOverlay(onStoreChange: () => void): () => void {
  const unsubLogout = subscribeAuthLogoutTransition(onStoreChange);
  const unsubPostLogin = subscribeAuthPostLoginTransition(onStoreChange);
  return () => {
    unsubLogout();
    unsubPostLogin();
  };
}

/** Intentional auth handoffs — no branded overlay; destination renders naturally. */
function getAuthIntentOverlayKey(): null {
  return null;
}

function resolveAuthIntentOverlayMessage(
  _key: "auth-logout-transition" | "auth-post-login-transition",
): string {
  return "";
}

export function AppLoadingManagerProvider({ children }: { children: React.ReactNode }) {
  const initialColdBootPending = createInitialOverlayPhase() === "visible";
  const [registrations, setRegistrations] = useState<Map<string, Registration>>(createInitialRegistrations);
  const [overlayPhase, setOverlayPhase] = useState<OverlayPhase>(createInitialOverlayPhase);
  /**
   * Cold URL entry: HTML `#caretip-html-boot` is the only visual loader until fade-out.
   * React tracks readiness but must not mount a second CareTip screen on top.
   */
  const [htmlBootOwnsVisual, setHtmlBootOwnsVisual] = useState(() => isHtmlBootBridgeActive());
  const htmlBootOwnsVisualRef = useRef(htmlBootOwnsVisual);
  htmlBootOwnsVisualRef.current = htmlBootOwnsVisual;
  const lastWinnerKeyRef = useRef<string | null>(initialColdBootPending ? BOOTSTRAP_KEY : null);
  const lastShownWinnerKeyRef = useRef<string | null>(initialColdBootPending ? BOOTSTRAP_KEY : null);
  const winnerRequestedRef = useRef(false);
  const exitDebounceRef = useRef<number | null>(null);
  const overlayDismissedAtRef = useRef(0);
  const overlayShownAtRef = useRef(initialColdBootPending ? Date.now() : 0);
  const minVisibleTimerRef = useRef<number | null>(null);
  const showThresholdTimerRef = useRef<number | null>(null);
  const initialColdBootPendingRef = useRef(initialColdBootPending);
  const initialBootMessage = createInitialRegistrations().get(BOOTSTRAP_KEY)?.message;
  const lastJourneyMessageRef = useRef<string | undefined>(initialBootMessage);

  /**
   * Soft-nav SPA work made MinimalRouteFallback transparent once the shell is interactive.
   * Logout/post-login must cover the previous route during RR transitions before layout-effect
   * registrars run — subscribe to the intent stores directly.
   */
  const authIntentOverlayKey = useSyncExternalStore(
    subscribeAuthIntentOverlay,
    getAuthIntentOverlayKey,
    () => null,
  );

  const register = useCallback(
    (key: string, priority: AppLoadingPriority, active: boolean, message?: string) => {
      if (!GLOBAL_OVERLAY_PRIORITIES.has(priority) && active) {
        if (import.meta.env.DEV) {
          console.warn(
            `[GlobalAppLoading] "${key}" uses priority ${priority} — not a global overlay priority`,
          );
        }
      }

      if (active) {
        if (shouldSuppressSoftNavGlobalOverlay(key)) {
          if (import.meta.env.DEV) {
            console.info(
              `[GlobalAppLoading] Suppressed soft-nav overlay registration "${key}"`,
            );
          }
          return;
        }
        setRegistrations((prev) => {
          if (
            priority === APP_LOADING_PRIORITY.APP_INIT &&
            !prev.has(BOOTSTRAP_KEY) &&
            ![...prev.values()].some(
              (r) =>
                r.priority === APP_LOADING_PRIORITY.AUTH ||
                r.priority === APP_LOADING_PRIORITY.ROUTE_GUARD,
            ) &&
            overlayDismissedAtRef.current > 0 &&
            Date.now() - overlayDismissedAtRef.current < OVERLAY_REENTRY_LOCK_MS
          ) {
            if (import.meta.env.DEV) {
              console.info(
                `[GlobalAppLoading] Suppressed APP_INIT re-entry for "${key}" (post-dismiss lock)`,
              );
            }
            return prev;
          }
          if (prev.has(key)) {
            const existing = prev.get(key)!;
            if (existing.priority === priority && existing.message === message) {
              return prev;
            }
          }
          if (import.meta.env.DEV && GLOBAL_OVERLAY_PRIORITIES.has(priority)) {
            traceGlobalLoaderBlocking(key, priority);
            traceLoaderRegistration(key, true, priority);
          }
          const next = new Map(prev);
          next.set(key, { key, priority, message });
          if (key !== BOOTSTRAP_KEY && next.has(BOOTSTRAP_KEY)) {
            next.delete(BOOTSTRAP_KEY);
          }
          return next;
        });
        return;
      }

      setRegistrations((prev) => {
        if (!prev.has(key)) return prev;
        if (import.meta.env.DEV && GLOBAL_OVERLAY_PRIORITIES.has(priority)) {
          traceGlobalLoaderReady(key);
          traceLoaderRegistration(key, false, priority);
        }
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    },
    [],
  );

  const releaseAppBootOverlay = useCallback(() => {
    /* Clears app-boot registration only. HTML dismiss is owned by the overlay exit effect. */
    setRegistrations((prev) => {
      if (!prev.has(BOOTSTRAP_KEY)) return prev;
      const next = new Map(prev);
      next.delete(BOOTSTRAP_KEY);
      return next;
    });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setRegistrations((prev) => {
        if (prev.size === 1 && prev.has(BOOTSTRAP_KEY)) {
          if (import.meta.env.DEV) {
            console.warn(
              "[GlobalAppLoading] app-boot timed out — no loader registered; forcing dismiss",
            );
          }
          return new Map();
        }
        return prev;
      });
    }, BOOTSTRAP_OVERLAY_MAX_MS);
    return () => window.clearTimeout(id);
  }, []);

  const mergedRegistrations = useMemo(() => {
    if (!authIntentOverlayKey) return registrations;
    if (registrations.has(authIntentOverlayKey)) return registrations;
    const next = new Map(registrations);
    next.set(authIntentOverlayKey, {
      key: authIntentOverlayKey,
      priority: APP_LOADING_PRIORITY.AUTH,
      message: resolveAuthIntentOverlayMessage(authIntentOverlayKey),
    });
    if (next.has(BOOTSTRAP_KEY)) {
      next.delete(BOOTSTRAP_KEY);
    }
    return next;
  }, [registrations, authIntentOverlayKey]);

  const winner = useMemo(
    () => pickOverlayWinner(mergedRegistrations),
    [mergedRegistrations],
  );

  const overlayMessage = useMemo(
    () => pickOverlayMessage(mergedRegistrations),
    [mergedRegistrations],
  );

  const displayOverlayMessage = useMemo(() => {
    if (overlayMessage && winner?.key && !isTechnicalOverlayRegistration(winner.key)) {
      return overlayMessage;
    }
    return lastJourneyMessageRef.current;
  }, [overlayMessage, winner?.key]);

  useEffect(() => {
    if (overlayMessage && winner?.key && !isTechnicalOverlayRegistration(winner.key)) {
      lastJourneyMessageRef.current = overlayMessage;
    }
  }, [overlayMessage, winner?.key]);

  const winnerRequested = Boolean(winner);
  winnerRequestedRef.current = winnerRequested;

  useEffect(() => {
    if (winner?.key) {
      lastWinnerKeyRef.current = winner.key;
    }
  }, [winner?.key]);

  /**
   * Auth intent overlays must paint in the same frame as begin*Transition().
   * useEffect show-threshold was one paint late after soft-nav made Suspense keep dashboard UI.
   */
  useLayoutEffect(() => {
    if (!authIntentOverlayKey) return;
    if (overlayPhase === "visible") return;
    if (showThresholdTimerRef.current !== null) {
      window.clearTimeout(showThresholdTimerRef.current);
      showThresholdTimerRef.current = null;
    }
    if (exitDebounceRef.current !== null) {
      window.clearTimeout(exitDebounceRef.current);
      exitDebounceRef.current = null;
    }
    initialColdBootPendingRef.current = false;
    overlayShownAtRef.current = Date.now();
    lastShownWinnerKeyRef.current = authIntentOverlayKey;
    lastWinnerKeyRef.current = authIntentOverlayKey;
    setOverlayPhase("visible");
    if (import.meta.env.DEV) {
      console.info(
        `[GlobalAppLoading] Overlay active — ${authIntentOverlayKey} (auth-intent layout)`,
      );
    }
  }, [authIntentOverlayKey, overlayPhase]);

  useEffect(() => {
    if (winnerRequested) {
      if (exitDebounceRef.current !== null) {
        window.clearTimeout(exitDebounceRef.current);
        exitDebounceRef.current = null;
      }
      if (minVisibleTimerRef.current !== null) {
        window.clearTimeout(minVisibleTimerRef.current);
        minVisibleTimerRef.current = null;
      }

      if (overlayPhase === "visible") {
        return;
      }

      if (overlayPhase === "exiting") {
        overlayShownAtRef.current = Date.now();
        lastShownWinnerKeyRef.current = winner?.key ?? lastWinnerKeyRef.current;
        setOverlayPhase("visible");
        return;
      }

      if (showThresholdTimerRef.current !== null) {
        return;
      }

      const winnerKey = winner?.key ?? lastWinnerKeyRef.current;
      if (
        shouldBypassOverlayShowThreshold(winnerKey, initialColdBootPendingRef.current)
      ) {
        initialColdBootPendingRef.current = false;
        const resolvedKey = winnerKey ?? BOOTSTRAP_KEY;
        overlayShownAtRef.current = Date.now();
        lastShownWinnerKeyRef.current = resolvedKey;
        lastWinnerKeyRef.current = resolvedKey;
        setOverlayPhase("visible");
        if (import.meta.env.DEV) {
          console.info(`[GlobalAppLoading] Overlay active — ${resolvedKey} (immediate handoff)`);
        }
        return;
      }

      showThresholdTimerRef.current = window.setTimeout(() => {
        showThresholdTimerRef.current = null;
        if (!winnerRequestedRef.current) return;
        overlayShownAtRef.current = Date.now();
        lastShownWinnerKeyRef.current = lastWinnerKeyRef.current;
        setOverlayPhase("visible");
        if (import.meta.env.DEV && lastWinnerKeyRef.current) {
          console.info(`[GlobalAppLoading] Overlay active — ${lastWinnerKeyRef.current}`);
        }
      }, OVERLAY_SHOW_THRESHOLD_MS);

      return () => {
        if (showThresholdTimerRef.current !== null) {
          window.clearTimeout(showThresholdTimerRef.current);
          showThresholdTimerRef.current = null;
        }
      };
    }

    if (showThresholdTimerRef.current !== null) {
      window.clearTimeout(showThresholdTimerRef.current);
      showThresholdTimerRef.current = null;
      /* Never tear down an active HTML cold boot when a soft show timer cancels. */
    }

    if (overlayPhase === "hidden") return;

    const scheduleExit = (): void => {
      const elapsed = Date.now() - overlayShownAtRef.current;
      const minVisibleMs = resolveMinOverlayVisibleMs(lastShownWinnerKeyRef.current);
      const delayExit = Math.max(0, minVisibleMs - elapsed);

      const startExit = (): void => {
        if (winnerRequestedRef.current) return;
        overlayDismissedAtRef.current = Date.now();
        setOverlayPhase("exiting");
        traceGlobalOverlayDismissed();
      };

      if (delayExit === 0) {
        startExit();
        return;
      }
      minVisibleTimerRef.current = window.setTimeout(() => {
        minVisibleTimerRef.current = null;
        startExit();
      }, delayExit);
    };

    if (exitDebounceRef.current !== null) {
      window.clearTimeout(exitDebounceRef.current);
    }
    exitDebounceRef.current = window.setTimeout(() => {
      exitDebounceRef.current = null;
      if (winnerRequestedRef.current) return;
      scheduleExit();
    }, OVERLAY_EXIT_DEBOUNCE_MS);

    return () => {
      if (exitDebounceRef.current !== null) {
        window.clearTimeout(exitDebounceRef.current);
        exitDebounceRef.current = null;
      }
      if (minVisibleTimerRef.current !== null) {
        window.clearTimeout(minVisibleTimerRef.current);
        minVisibleTimerRef.current = null;
      }
    };
  }, [winnerRequested, winner?.key, overlayPhase]);

  useEffect(() => {
    if (overlayPhase !== "exiting") return;

    if (htmlBootOwnsVisualRef.current) {
      beginHtmlBootBridgeExit();
    }

    const id = window.setTimeout(() => {
      if (htmlBootOwnsVisualRef.current) {
        dismissHtmlMarketingBootBridge();
        setHtmlBootOwnsVisual(false);
      }
      setOverlayPhase("hidden");
      lastWinnerKeyRef.current = null;
      lastJourneyMessageRef.current = undefined;
      /* Cold boot complete — SPA navigations must not reopen the branded loader. */
      markAppShellInteractive();
    }, OVERLAY_FADE_MS);
    return () => window.clearTimeout(id);
  }, [overlayPhase]);

  useEffect(() => {
    if (!htmlBootOwnsVisual) return;
    setHtmlBootBridgeMessage(displayOverlayMessage);
    setHtmlBootBridgeSub(i18n.t("common.onlyAMoment"));
  }, [htmlBootOwnsVisual, displayOverlayMessage]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug("[GlobalAppLoading] state", {
      winnerRequested,
      overlayPhase,
      htmlBootOwnsVisual,
      authIntentOverlayKey,
      winner: winner?.key ?? null,
      winnerPriority: winner?.priority ?? null,
      activeKeys: [...mergedRegistrations.keys()],
      showThresholdArmed: showThresholdTimerRef.current !== null,
    });
    if (winnerRequested && winner?.key?.includes("paint")) {
      console.info("[LoaderDiag] overlay winner is paint-ready", {
        key: winner.key,
        activeKeys: [...mergedRegistrations.keys()],
      });
    }
  }, [
    winnerRequested,
    overlayPhase,
    winner,
    mergedRegistrations,
    htmlBootOwnsVisual,
    authIntentOverlayKey,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV || !winnerRequested) return;
    const id = window.setTimeout(() => {
      const keys = [...mergedRegistrations.keys()];
      if (keys.length === 0) return;
      warnLoaderDiagDeadlock(winner?.key ?? null, keys, {
        overlayPhase,
        stuckAfterMs: 10_000,
      });
    }, 10_000);
    return () => window.clearTimeout(id);
  }, [winnerRequested, winner?.key, mergedRegistrations, overlayPhase]);

  const overlayPresented = overlayPhase === "visible" || overlayPhase === "exiting";

  const value = useMemo(
    () => ({
      register,
      releaseAppBootOverlay,
      overlayVisible: overlayPresented || winnerRequested || Boolean(authIntentOverlayKey),
    }),
    [
      register,
      releaseAppBootOverlay,
      winnerRequested,
      overlayPresented,
      authIntentOverlayKey,
    ],
  );

  /* React CareTip screen only after HTML cold boot is gone (soft nav / auth transitions). */
  const renderReactOverlay = overlayPresented && !htmlBootOwnsVisual;

  useEffect(() => {
    /* Safety: if HTML somehow stays after we already moved on, force-clear after long stall. */
    if (!htmlBootOwnsVisual) return;
    const id = window.setTimeout(() => {
      if (!htmlBootOwnsVisualRef.current) return;
      if (import.meta.env.DEV) {
        console.warn("[GlobalAppLoading] HTML boot safety dismiss after 20s");
      }
      dismissHtmlMarketingBootBridge();
      setHtmlBootOwnsVisual(false);
    }, 20_000);
    return () => window.clearTimeout(id);
  }, [htmlBootOwnsVisual]);

  return (
    <AppLoadingManagerContext.Provider value={value}>
      {children}
      {renderReactOverlay ? (
        <AppBrandedLoadingScreen
          fixed
          message={displayOverlayMessage}
          suppressStatusMessage={
            winner?.key === BOOTSTRAP_KEY ||
            !winner?.key ||
            !isIntentionalPostShellOverlayKey(winner.key)
          }
          allowStartupFallback={false}
          exiting={overlayPhase === "exiting"}
        />
      ) : null}
    </AppLoadingManagerContext.Provider>
  );
}

export function useAppLoadingOverlayActive(): boolean {
  const ctx = useContext(AppLoadingManagerContext);
  return ctx?.overlayVisible ?? false;
}

export { APP_LOADING_PRIORITY };
