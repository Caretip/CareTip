/**
 * Idle session orchestration hook — activity, schedule, warning UI, logout bridge.
 * Ported from web `useIdleSessionGuard.ts` (cross-tab sync omitted — single mobile instance).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { bindIdleActivityListeners } from "@/lib/idleSession/idleSessionActivity";
import { createIdleSessionScheduler } from "@/lib/idleSession/idleSessionScheduler";
import { UNSAVED_GRACE_MS } from "@/lib/idleSession/idleSessionConfig";
import { isIdleDirty, subscribeIdleDirty } from "@/lib/idleSession/idleDirtyRegistry";
import { performIdleStaySignedIn } from "@/lib/idleSession/idleSessionWarningFlow";
import {
  armIdleSession,
  beginIdleLogout,
  disarmIdleSession,
  endIdleLogout,
  getIdleSessionSnapshot,
  getSecondsUntilDeadline,
  isIdleLogoutInFlight,
  openIdleWarning,
  openUnsavedGrace,
  subscribeIdleSession,
  touchIdleActivity,
  type IdleUiPhase,
} from "@/lib/idleSession/idleSessionStore";

export type IdleWarningUiState = {
  open: boolean;
  phase: Exclude<IdleUiPhase, "none">;
  secondsRemaining: number;
};

const CLOSED_UI: IdleWarningUiState = {
  open: false,
  phase: "idle-warning",
  secondsRemaining: 0,
};

export type UseIdleSessionGuardResult = {
  warning: IdleWarningUiState;
  staySignedIn: () => void;
  logOutNow: () => void;
};

export function useIdleSessionGuard(
  active: boolean,
  logout: () => void | Promise<void>,
): UseIdleSessionGuardResult {
  const [warning, setWarning] = useState<IdleWarningUiState>(CLOSED_UI);
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const warningShownForDeadline = useRef<number | null>(null);
  const schedulerRef = useRef<ReturnType<typeof createIdleSessionScheduler> | null>(null);

  const closeWarningUi = useCallback(() => {
    setWarning(CLOSED_UI);
  }, []);

  const openWarningUi = useCallback((logoutAt: number, now: number) => {
    openIdleWarning(logoutAt);
    const seconds = getSecondsUntilDeadline(logoutAt, now);
    setWarning({
      open: true,
      phase: "idle-warning",
      secondsRemaining: seconds,
    });
    if (warningShownForDeadline.current !== logoutAt) {
      warningShownForDeadline.current = logoutAt;
    }
    schedulerRef.current?.reschedule(now);
  }, []);

  const runLogout = useCallback(
    (source: "timeout" | "manual") => {
      if (isIdleLogoutInFlight()) return;
      if (!beginIdleLogout()) return;

      closeWarningUi();

      void Promise.resolve(logoutRef.current()).finally(() => {
        if (source === "timeout") {
          /* latch stays until disarm so proactive refresh cannot race mid-transition */
        }
      });
    },
    [closeWarningUi],
  );

  const staySignedIn = useCallback(() => {
    const now = Date.now();
    performIdleStaySignedIn(now);
    closeWarningUi();
    warningShownForDeadline.current = null;
    schedulerRef.current?.reschedule(now);
  }, [closeWarningUi]);

  const logOutNow = useCallback(() => {
    runLogout("manual");
  }, [runLogout]);

  useEffect(() => {
    if (!active) {
      disarmIdleSession();
      endIdleLogout();
      closeWarningUi();
      warningShownForDeadline.current = null;
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
      return;
    }

    armIdleSession(Date.now());

    const scheduler = createIdleSessionScheduler({
      onEvaluation: (result, now) => {
        if (result.action === "open-warning") {
          openWarningUi(result.logoutAt, now);
          return;
        }

        if (result.action === "unsaved-grace-expired") {
          runLogout("timeout");
          return;
        }

        if (result.action === "hard-logout") {
          if (isIdleDirty()) {
            openUnsavedGrace(now);
            const seconds = getSecondsUntilDeadline(now + UNSAVED_GRACE_MS, now);
            setWarning({
              open: true,
              phase: "unsaved-grace",
              secondsRemaining: seconds,
            });
            scheduler.reschedule(now);
            return;
          }
          runLogout("timeout");
        }
      },
      onTick: (secondsRemaining) => {
        setWarning((prev) => (prev.open ? { ...prev, secondsRemaining } : prev));
      },
    });

    schedulerRef.current = scheduler;
    scheduler.reschedule(Date.now());

    let lastSuppressCount = getIdleSessionSnapshot().suppressCount;

    const activity = bindIdleActivityListeners({
      onActivity: () => {
        const now = Date.now();
        const wrote = touchIdleActivity(now);
        if (!wrote) return;
        warningShownForDeadline.current = null;
        closeWarningUi();
        scheduler.reschedule(now);
      },
    });

    const unsubStore = subscribeIdleSession(() => {
      const snap = getIdleSessionSnapshot();
      if (!snap.armed) return;
      if (snap.phase === "none" && warningShownForDeadline.current != null) {
        warningShownForDeadline.current = null;
        closeWarningUi();
        scheduler.reschedule(Date.now());
      }
      if (lastSuppressCount > 0 && snap.suppressCount === 0) {
        scheduler.checkNow(Date.now());
      }
      lastSuppressCount = snap.suppressCount;
    });

    const unsubDirty = subscribeIdleDirty(() => {
      const snap = getIdleSessionSnapshot();
      if (snap.phase !== "unsaved-grace") return;
      if (isIdleDirty()) return;
      const now = Date.now();
      performIdleStaySignedIn(now);
      warningShownForDeadline.current = null;
      closeWarningUi();
      scheduler.reschedule(now);
    });

    return () => {
      activity.detach();
      unsubStore();
      unsubDirty();
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
      disarmIdleSession();
      closeWarningUi();
      warningShownForDeadline.current = null;
    };
  }, [active, closeWarningUi, openWarningUi, runLogout]);

  return {
    warning,
    staySignedIn,
    logOutNow,
  };
}
