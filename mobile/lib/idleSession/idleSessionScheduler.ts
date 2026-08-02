/**
 * Wall-clock deadline scheduler for idle warning / logout.
 * Ported from web — AppState wake replaces document.visibilitychange.
 */

import { AppState, type AppStateStatus } from "react-native";
import { TICK_MS } from "./idleSessionConfig";
import {
  evaluateIdleDeadlines,
  forceReleaseIdleSuppressIfStale,
  getIdleDeadlines,
  getIdleSessionSnapshot,
  getSecondsUntilDeadline,
  isIdleSessionArmed,
  isIdleSuppressed,
  type IdleDeadlineEvaluation,
} from "./idleSessionStore";

export type IdleSchedulerCallbacks = {
  onEvaluation: (result: IdleDeadlineEvaluation, now: number) => void;
  onTick?: (secondsRemaining: number, now: number) => void;
};

export type IdleSessionScheduler = {
  reschedule: (now?: number) => void;
  checkNow: (now?: number) => IdleDeadlineEvaluation;
  dispose: () => void;
};

const WATCHDOG_MS = 45_000;

export function createIdleSessionScheduler(callbacks: IdleSchedulerCallbacks): IdleSessionScheduler {
  let warningTimer: ReturnType<typeof setTimeout> | null = null;
  let logoutTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let appState: AppStateStatus = AppState.currentState;

  const clearTimers = () => {
    if (warningTimer != null) {
      clearTimeout(warningTimer);
      warningTimer = null;
    }
    if (logoutTimer != null) {
      clearTimeout(logoutTimer);
      logoutTimer = null;
    }
    if (tickTimer != null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };

  const runEvaluation = (now: number): IdleDeadlineEvaluation => {
    forceReleaseIdleSuppressIfStale(now);
    const result = evaluateIdleDeadlines(now);
    callbacks.onEvaluation(result, now);
    return result;
  };

  const startTickIfNeeded = (now: number) => {
    const snap = getIdleSessionSnapshot();
    if (snap.phase === "none" || snap.activeDeadlineAt == null) {
      if (tickTimer != null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      return;
    }

    if (tickTimer != null) return;

    const fire = () => {
      if (disposed) return;
      const n = Date.now();
      const deadline = getIdleSessionSnapshot().activeDeadlineAt;
      if (deadline == null) return;
      callbacks.onTick?.(getSecondsUntilDeadline(deadline, n), n);
      runEvaluation(n);
    };

    callbacks.onTick?.(getSecondsUntilDeadline(snap.activeDeadlineAt, now), now);
    tickTimer = setInterval(fire, TICK_MS);
  };

  const reschedule = (now: number = Date.now()) => {
    if (disposed) return;
    clearTimers();

    if (!isIdleSessionArmed() || isIdleSuppressed()) {
      return;
    }

    const snap = getIdleSessionSnapshot();
    if (snap.phase === "unsaved-grace" && snap.unsavedGraceEndsAt != null) {
      const delay = Math.max(0, snap.unsavedGraceEndsAt - now);
      logoutTimer = setTimeout(() => {
        runEvaluation(Date.now());
      }, delay);
      startTickIfNeeded(now);
      return;
    }

    if (snap.phase === "idle-warning" && snap.activeDeadlineAt != null) {
      const delay = Math.max(0, snap.activeDeadlineAt - now);
      logoutTimer = setTimeout(() => {
        runEvaluation(Date.now());
      }, delay);
      startTickIfNeeded(now);
      return;
    }

    const { warningAt, logoutAt } = getIdleDeadlines();
    const warnDelay = Math.max(0, warningAt - now);
    const logoutDelay = Math.max(0, logoutAt - now);

    warningTimer = setTimeout(() => {
      runEvaluation(Date.now());
    }, warnDelay);

    logoutTimer = setTimeout(() => {
      runEvaluation(Date.now());
    }, logoutDelay);
  };

  const checkNow = (now: number = Date.now()): IdleDeadlineEvaluation => {
    const result = runEvaluation(now);
    reschedule(now);
    return result;
  };

  const onAppStateChange = (next: AppStateStatus) => {
    const wasBackground = appState !== "active";
    appState = next;
    if (wasBackground && next === "active") {
      checkNow(Date.now());
    }
  };

  const appStateSub = AppState.addEventListener("change", onAppStateChange);

  watchdogTimer = setInterval(() => {
    if (disposed || !isIdleSessionArmed()) return;
    checkNow(Date.now());
  }, WATCHDOG_MS);

  return {
    reschedule,
    checkNow,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimers();
      if (watchdogTimer != null) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
      appStateSub.remove();
    },
  };
}
