/**
 * Wall-clock deadline scheduler for idle warning / logout.
 * Checkpoint 2: setTimeout + visibility wake; no React.
 */

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
  /** Optional 1 Hz tick while a warning/grace phase is open. */
  onTick?: (secondsRemaining: number, now: number) => void;
};

export type IdleSessionScheduler = {
  /** Recompute deadlines from store and (re)arm timers. */
  reschedule: (now?: number) => void;
  /** Immediate wall-clock check (wake / visibility). */
  checkNow: (now?: number) => IdleDeadlineEvaluation;
  dispose: () => void;
};

const WATCHDOG_MS = 45_000;

/**
 * Create a scheduler bound to the module idle store.
 * Callers must enforce auth activation before arming the store.
 */
export function createIdleSessionScheduler(callbacks: IdleSchedulerCallbacks): IdleSessionScheduler {
  let warningTimer: ReturnType<typeof setTimeout> | null = null;
  let logoutTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

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
    // After evaluation side effects (open warning etc.) caller typically updates store;
    // still reschedule so timers track latest store state.
    reschedule(now);
    return result;
  };

  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    checkNow(Date.now());
  };

  const onPageShow = () => {
    checkNow(Date.now());
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", onPageShow);
  }

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
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pageshow", onPageShow);
      }
    },
  };
}

/** Compute next timer delays for tests (no side effects). */
export function computeIdleScheduleDelays(
  lastActivityAt: number,
  now: number,
): { warnDelay: number; logoutDelay: number } {
  const { warningAt, logoutAt } = getIdleDeadlines(lastActivityAt);
  return {
    warnDelay: Math.max(0, warningAt - now),
    logoutDelay: Math.max(0, logoutAt - now),
  };
}
