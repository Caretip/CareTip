/**
 * Idle session orchestration hook — activity, schedule, warning UI, logout bridge.
 * Checkpoint 4–5: wires existing `logout()` + cross-tab channel sync.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { bindIdleActivityListeners } from "../lib/idleSessionActivity";
import {
  emitIdleLogout,
  emitIdleLogoutManual,
  emitIdleSessionExtended,
  emitIdleWarningShown,
} from "../lib/idleSessionAnalytics";
import { createIdleSessionChannel, type IdleSessionChannel } from "../lib/idleSessionChannel";
import { isIdleDirty, subscribeIdleDirty } from "../lib/idleDirtyRegistry";
import { createIdleSessionScheduler } from "../lib/idleSessionScheduler";
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
} from "../lib/idleSessionStore";
import { applyIdleChannelMessage } from "../lib/idleSessionSync";
import {
  performIdleStaySignedIn,
  syncIdleWarningDocumentTitle,
} from "../lib/idleSessionWarningFlow";
import { endIdleDocumentTitleCountdown } from "../lib/idleDocumentTitle";
import { UNSAVED_GRACE_MS } from "../lib/idleSessionConfig";

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

function newIdleTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `idle-tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export type UseIdleSessionGuardResult = {
  warning: IdleWarningUiState;
  staySignedIn: () => void;
  logOutNow: () => void;
};

/**
 * @param active - §1.6 gate already applied by controller (flag + auth + validated + not logging out)
 * @param logout - existing `useAuth().logout`
 */
export function useIdleSessionGuard(
  active: boolean,
  logout: () => void,
): UseIdleSessionGuardResult {
  const [warning, setWarning] = useState<IdleWarningUiState>(CLOSED_UI);
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const warningShownForDeadline = useRef<number | null>(null);
  const schedulerRef = useRef<ReturnType<typeof createIdleSessionScheduler> | null>(null);
  const channelRef = useRef<IdleSessionChannel | null>(null);
  const tabIdRef = useRef(newIdleTabId());

  const closeWarningUi = useCallback(() => {
    syncIdleWarningDocumentTitle(false, 0);
    setWarning(CLOSED_UI);
  }, []);

  const openWarningUi = useCallback((logoutAt: number, now: number, broadcast: boolean) => {
    openIdleWarning(logoutAt);
    const seconds = getSecondsUntilDeadline(logoutAt, now);
    setWarning({
      open: true,
      phase: "idle-warning",
      secondsRemaining: seconds,
    });
    syncIdleWarningDocumentTitle(true, seconds);
    if (warningShownForDeadline.current !== logoutAt) {
      warningShownForDeadline.current = logoutAt;
      emitIdleWarningShown({
        logout_at: logoutAt,
        remaining_ms: logoutAt - now,
      });
    }
    if (broadcast) {
      channelRef.current?.publish({ type: "warning", logoutAt });
    }
    schedulerRef.current?.reschedule(now);
  }, []);

  const runLogout = useCallback(
    (source: "timeout" | "manual", options: { broadcast?: boolean } = {}) => {
      const broadcast = options.broadcast !== false;
      if (isIdleLogoutInFlight()) return;
      if (!beginIdleLogout()) return;

      closeWarningUi();
      endIdleDocumentTitleCountdown();

      if (broadcast) {
        channelRef.current?.publish({
          type: "logout",
          ts: Date.now(),
          leaderId: tabIdRef.current,
        });
      }

      try {
        logoutRef.current();
        if (source === "timeout") emitIdleLogout();
        else emitIdleLogoutManual();
      } finally {
        // Latch stays until disarm so proactive refresh cannot race mid-transition.
      }
    },
    [closeWarningUi],
  );

  const staySignedIn = useCallback(() => {
    const now = Date.now();
    const { extended } = performIdleStaySignedIn(now);
    closeWarningUi();
    warningShownForDeadline.current = null;
    if (extended) {
      emitIdleSessionExtended({ via: "stay" });
      channelRef.current?.publish({ type: "stay", ts: now });
    }
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
      channelRef.current?.close();
      channelRef.current = null;
      return;
    }

    armIdleSession(Date.now());

    const scheduler = createIdleSessionScheduler({
      onEvaluation: (result, now) => {
        if (result.action === "open-warning") {
          openWarningUi(result.logoutAt, now, true);
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
            syncIdleWarningDocumentTitle(true, seconds);
            scheduler.reschedule(now);
            return;
          }
          runLogout("timeout");
        }
      },
      onTick: (secondsRemaining) => {
        setWarning((prev) => (prev.open ? { ...prev, secondsRemaining } : prev));
        syncIdleWarningDocumentTitle(true, secondsRemaining);
      },
    });

    schedulerRef.current = scheduler;
    scheduler.reschedule(Date.now());

    let lastSuppressCount = getIdleSessionSnapshot().suppressCount;

    const channel = createIdleSessionChannel((message) => {
      const result = applyIdleChannelMessage(message, {
        tabId: tabIdRef.current,
        onRemoteLogout: () => {
          runLogout("timeout", { broadcast: false });
        },
      });

      const now = Date.now();
      if (result === "activity" || result === "stay") {
        warningShownForDeadline.current = null;
        closeWarningUi();
        scheduler.reschedule(now);
        return;
      }
      if (result === "warning" && message.type === "warning") {
        openWarningUi(message.logoutAt, now, false);
      }
    });
    channelRef.current = channel;

    const activity = bindIdleActivityListeners({
      onActivity: () => {
        const now = Date.now();
        const wrote = touchIdleActivity(now);
        if (!wrote) return;
        warningShownForDeadline.current = null;
        closeWarningUi();
        channel.publish({ type: "activity", ts: now });
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
      const { extended } = performIdleStaySignedIn(now);
      warningShownForDeadline.current = null;
      closeWarningUi();
      if (extended) {
        emitIdleSessionExtended({ via: "unsaved_save" });
        channel.publish({ type: "stay", ts: now });
      }
      scheduler.reschedule(now);
    });

    return () => {
      activity.detach();
      unsubStore();
      unsubDirty();
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
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
