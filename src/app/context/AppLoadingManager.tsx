import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import { dismissHtmlMarketingBootBridge } from "../lib/htmlMarketingBootBridge";
import { isPublicMarketingPath, isPublicShellPath } from "../lib/publicRoutes";
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

function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Initial bootstrap overlay for cold loads.
 * PWA, marketing, and protected shells show the branded loader immediately.
 * Auth form shells skip React boot (HTML bridge dismisses on first paint).
 */
function shouldRegisterInitialAppBoot(pathname: string): boolean {
  if (isStandaloneDisplayMode()) return true;
  if (isPublicMarketingPath(pathname)) return true;
  if (isPublicShellPath(pathname)) return false;
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

export function AppLoadingManagerProvider({ children }: { children: React.ReactNode }) {
  const initialColdBootPending = createInitialOverlayPhase() === "visible";
  const [registrations, setRegistrations] = useState<Map<string, Registration>>(createInitialRegistrations);
  const [overlayPhase, setOverlayPhase] = useState<OverlayPhase>(createInitialOverlayPhase);
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
    dismissHtmlMarketingBootBridge();
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

  const winner = useMemo(
    () => pickOverlayWinner(registrations),
    [registrations],
  );

  const overlayMessage = useMemo(
    () => pickOverlayMessage(registrations),
    [registrations],
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
        if (winnerKey === BOOTSTRAP_KEY) {
          initialColdBootPendingRef.current = false;
        }
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
      if (overlayPhase === "hidden") {
        dismissHtmlMarketingBootBridge();
      }
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
    const id = window.setTimeout(() => {
      setOverlayPhase("hidden");
      lastWinnerKeyRef.current = null;
      lastJourneyMessageRef.current = undefined;
    }, OVERLAY_FADE_MS);
    return () => window.clearTimeout(id);
  }, [overlayPhase]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug("[GlobalAppLoading] state", {
      winnerRequested,
      overlayPhase,
      winner: winner?.key ?? null,
      winnerPriority: winner?.priority ?? null,
      activeKeys: [...registrations.keys()],
      showThresholdArmed: showThresholdTimerRef.current !== null,
    });
    if (winnerRequested && winner?.key?.includes("paint")) {
      console.info("[LoaderDiag] overlay winner is paint-ready", {
        key: winner.key,
        activeKeys: [...registrations.keys()],
      });
    }
  }, [winnerRequested, overlayPhase, winner, registrations]);

  useEffect(() => {
    if (!import.meta.env.DEV || !winnerRequested) return;
    const id = window.setTimeout(() => {
      const keys = [...registrations.keys()];
      if (keys.length === 0) return;
      warnLoaderDiagDeadlock(winner?.key ?? null, keys, {
        overlayPhase,
        stuckAfterMs: 10_000,
      });
    }, 10_000);
    return () => window.clearTimeout(id);
  }, [winnerRequested, winner?.key, registrations, overlayPhase]);

  const overlayPresented = overlayPhase === "visible" || overlayPhase === "exiting";

  const value = useMemo(
    () => ({
      register,
      releaseAppBootOverlay,
      overlayVisible: overlayPresented || winnerRequested,
    }),
    [register, releaseAppBootOverlay, winnerRequested, overlayPresented],
  );

  const renderOverlay = overlayPresented;

  /* Handoff: React branded overlay owns the screen — drop the HTML first-paint bridge. */
  useLayoutEffect(() => {
    if (!renderOverlay) return;
    dismissHtmlMarketingBootBridge();
  }, [renderOverlay]);

  useEffect(() => {
    const id = window.setTimeout(() => dismissHtmlMarketingBootBridge(), 8_000);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <AppLoadingManagerContext.Provider value={value}>
      {children}
      {renderOverlay ? (
        <AppBrandedLoadingScreen
          fixed
          message={displayOverlayMessage}
          allowStartupFallback={winner?.key === BOOTSTRAP_KEY && !displayOverlayMessage}
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
