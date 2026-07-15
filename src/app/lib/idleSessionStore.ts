/**
 * Module-singleton idle session state (no React).
 * Checkpoint 1: timestamps, suppress freeze/resume, single-flight logout gate.
 * Activity listeners and React mount come in later checkpoints.
 */

import {
  ACTIVITY_THROTTLE_MS,
  IDLE_SUPPRESS_MAX_MS,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_BEFORE_MS,
  UNSAVED_GRACE_MS,
  computeIdleDeadlines,
  type IdleDeadlines,
} from "./idleSessionConfig";

export type IdleUiPhase = "none" | "idle-warning" | "unsaved-grace";

export type IdleSessionSnapshot = {
  armed: boolean;
  lastActivityAt: number;
  lastLocalWriteAt: number;
  phase: IdleUiPhase;
  /** Absolute logout deadline shared with synced warnings (idle hard stop or grace end). */
  activeDeadlineAt: number | null;
  unsavedGraceEndsAt: number | null;
  suppressCount: number;
  frozenRemainingMs: number | null;
  suppressStartedAt: number | null;
  idleLogoutInFlight: boolean;
};

type Listener = () => void;

const listeners = new Set<Listener>();

let state: IdleSessionSnapshot = createInitialState();

function createInitialState(): IdleSessionSnapshot {
  return {
    armed: false,
    lastActivityAt: 0,
    lastLocalWriteAt: 0,
    phase: "none",
    activeDeadlineAt: null,
    unsavedGraceEndsAt: null,
    suppressCount: 0,
    frozenRemainingMs: null,
    suppressStartedAt: null,
    idleLogoutInFlight: false,
  };
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Never let a subscriber break idle math.
    }
  }
}

function setState(patch: Partial<IdleSessionSnapshot>): void {
  state = { ...state, ...patch };
  emit();
}

export function subscribeIdleSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getIdleSessionSnapshot(): IdleSessionSnapshot {
  return state;
}

export function isIdleSessionArmed(): boolean {
  return state.armed;
}

export function isIdleSuppressed(): boolean {
  return state.suppressCount > 0;
}

export function isIdleLogoutInFlight(): boolean {
  return state.idleLogoutInFlight;
}

export function getIdleDeadlines(lastActivityAt = state.lastActivityAt): IdleDeadlines {
  return computeIdleDeadlines(lastActivityAt);
}

/** Remaining ms until hard logout from activity clock (ignores unsaved grace). */
export function getIdleRemainingMs(now: number, lastActivityAt = state.lastActivityAt): number {
  return Math.max(0, lastActivityAt + IDLE_TIMEOUT_MS - now);
}

export function getSecondsUntilDeadline(deadlineAt: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

/**
 * Arm only when auth gate allows (caller enforces §1.6). Sets activity to `now`.
 */
export function armIdleSession(now: number = Date.now()): void {
  setState({
    armed: true,
    lastActivityAt: now,
    lastLocalWriteAt: now,
    phase: "none",
    activeDeadlineAt: null,
    unsavedGraceEndsAt: null,
    idleLogoutInFlight: false,
    // Preserve suppress if an op spanned remount; normally count is 0.
  });
}

/** Disarm: clear warning/grace UI state; does not clear mid-flight logout latch (caller clears). */
export function disarmIdleSession(): void {
  setState({
    armed: false,
    phase: "none",
    activeDeadlineAt: null,
    unsavedGraceEndsAt: null,
    lastActivityAt: 0,
    lastLocalWriteAt: 0,
  });
}

export type TouchActivityOptions = {
  /** Bypass throttle (Stay, cross-tab stay, warning-open input). */
  force?: boolean;
  /** When warning is open, throttle is skipped even without force. */
  warningOpen?: boolean;
};

/**
 * Record trusted activity. Returns true if `lastActivityAt` was updated.
 */
export function touchIdleActivity(
  now: number = Date.now(),
  options: TouchActivityOptions = {},
): boolean {
  if (!state.armed) return false;

  const warningOpen = options.warningOpen ?? state.phase !== "none";
  const force = options.force === true || warningOpen;

  if (!force && now - state.lastLocalWriteAt < ACTIVITY_THROTTLE_MS) {
    return false;
  }

  setState({
    lastActivityAt: now,
    lastLocalWriteAt: now,
    phase: "none",
    activeDeadlineAt: null,
    unsavedGraceEndsAt: null,
  });
  return true;
}

/** Apply remote activity without rewriting lastLocalWrite throttle clock unless newer. */
export function applyRemoteIdleActivity(ts: number): boolean {
  if (!state.armed) return false;
  if (ts <= state.lastActivityAt) return false;
  setState({
    lastActivityAt: ts,
    phase: "none",
    activeDeadlineAt: null,
    unsavedGraceEndsAt: null,
  });
  return true;
}

export function openIdleWarning(logoutAt: number): void {
  if (!state.armed) return;
  setState({
    phase: "idle-warning",
    activeDeadlineAt: logoutAt,
    unsavedGraceEndsAt: null,
  });
}

export function openUnsavedGrace(now: number = Date.now()): void {
  if (!state.armed) return;
  const endsAt = now + UNSAVED_GRACE_MS;
  setState({
    phase: "unsaved-grace",
    unsavedGraceEndsAt: endsAt,
    activeDeadlineAt: endsAt,
  });
}

export function dismissIdleWarning(): void {
  if (state.phase === "none") return;
  setState({
    phase: "none",
    activeDeadlineAt: null,
    unsavedGraceEndsAt: null,
  });
}

/**
 * Begin suppress (ref-counted). First enter freezes remaining logout budget.
 */
export function beginIdleSuppress(now: number = Date.now()): void {
  if (state.suppressCount === 0) {
    const remaining = getIdleRemainingMs(now);
    setState({
      suppressCount: 1,
      frozenRemainingMs: remaining,
      suppressStartedAt: now,
    });
    return;
  }
  setState({ suppressCount: state.suppressCount + 1 });
}

/**
 * End one suppress reason. When count hits 0, resume remaining budget
 * (does not restart a fresh 15 minutes).
 */
export function endIdleSuppress(now: number = Date.now()): {
  resumed: boolean;
  remainingMs: number;
} {
  if (state.suppressCount <= 0) {
    return { resumed: false, remainingMs: getIdleRemainingMs(now) };
  }

  const nextCount = state.suppressCount - 1;
  if (nextCount > 0) {
    setState({ suppressCount: nextCount });
    return { resumed: false, remainingMs: state.frozenRemainingMs ?? getIdleRemainingMs(now) };
  }

  const remainingMs = Math.max(0, state.frozenRemainingMs ?? 0);
  const logoutAt = now + remainingMs;
  const lastActivityAt = logoutAt - IDLE_TIMEOUT_MS;

  setState({
    suppressCount: 0,
    frozenRemainingMs: null,
    suppressStartedAt: null,
    lastActivityAt,
  });

  return { resumed: true, remainingMs };
}

/** Failsafe: if suppress exceeds max wall time, force release. */
export function forceReleaseIdleSuppressIfStale(now: number = Date.now()): boolean {
  if (state.suppressCount <= 0 || state.suppressStartedAt == null) return false;
  if (now - state.suppressStartedAt < IDLE_SUPPRESS_MAX_MS) return false;

  const remainingMs = Math.max(0, state.frozenRemainingMs ?? 0);
  const logoutAt = now + remainingMs;
  setState({
    suppressCount: 0,
    frozenRemainingMs: null,
    suppressStartedAt: null,
    lastActivityAt: logoutAt - IDLE_TIMEOUT_MS,
  });
  return true;
}

/** Single-flight logout gate. Returns false if already in flight. */
export function beginIdleLogout(): boolean {
  if (state.idleLogoutInFlight) return false;
  setState({ idleLogoutInFlight: true });
  return true;
}

export function endIdleLogout(): void {
  if (!state.idleLogoutInFlight) return;
  setState({ idleLogoutInFlight: false });
}

/** Evaluate wall-clock against deadlines (caller schedules/wakes). */
export type IdleDeadlineEvaluation =
  | { action: "none" }
  | { action: "open-warning"; logoutAt: number; warningAt: number }
  | { action: "hard-logout"; logoutAt: number }
  | { action: "unsaved-grace-expired" }
  | { action: "suppressed" };

export function evaluateIdleDeadlines(
  now: number = Date.now(),
  options: { dirty?: boolean } = {},
): IdleDeadlineEvaluation {
  if (!state.armed) return { action: "none" };
  if (state.idleLogoutInFlight) return { action: "none" };
  if (state.suppressCount > 0) return { action: "suppressed" };

  if (state.phase === "unsaved-grace") {
    const ends = state.unsavedGraceEndsAt ?? now;
    if (now >= ends) return { action: "unsaved-grace-expired" };
    return { action: "none" };
  }

  const { warningAt, logoutAt } = getIdleDeadlines();

  if (now >= logoutAt) {
    // Dirty → unsaved grace is decided by the controller (CP6); store reports hard deadline.
    return { action: "hard-logout", logoutAt };
  }

  if (now >= warningAt && state.phase !== "idle-warning") {
    return { action: "open-warning", logoutAt, warningAt };
  }

  return { action: "none" };
}

/** Exported for deadline math assertions in tests. */
export const IDLE_STORE_TIMINGS = {
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_BEFORE_MS,
  UNSAVED_GRACE_MS,
  ACTIVITY_THROTTLE_MS,
} as const;

/** Test-only reset. */
export function resetIdleSessionStoreForTests(): void {
  state = createInitialState();
  listeners.clear();
}
