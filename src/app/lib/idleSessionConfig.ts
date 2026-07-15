/**
 * Idle session timeout — timing constants + permanent feature flag.
 * Phase 3 / Checkpoint 1. Do not arm controllers from this module.
 *
 * Flag `VITE_IDLE_SESSION_TIMEOUT_ENABLED` is a permanent kill switch (never remove).
 */

/** Hard logout after last trusted activity (15 minutes). */
export const IDLE_TIMEOUT_MS = 900_000;

/** Open warning when remaining time ≤ this (120s → warning at 13 minutes idle). */
export const IDLE_WARNING_BEFORE_MS = 120_000;

/** Extra grace when forms are dirty at hard expiry. */
export const UNSAVED_GRACE_MS = 60_000;

/** Max store/broadcast write rate while warning is closed. */
export const ACTIVITY_THROTTLE_MS = 30_000;

/** Modal + document-title tick while a warning phase is open. */
export const TICK_MS = 1_000;

/** Force-release suppress after this wall time (failsafe). */
export const IDLE_SUPPRESS_MAX_MS = 2 * 60 * 60 * 1000;

/** Stable brand string for tab-title countdown. */
export const IDLE_BRAND_TITLE = "CareTip";

/** BroadcastChannel name. */
export const IDLE_CHANNEL_NAME = "caretip-idle-session";

/** localStorage bus key (fallback sync). */
export const IDLE_STORAGE_BUS_KEY = "caretip-idle-session-bus";

/** Offset from lastActivityAt until warning (13 minutes). */
export function getIdleWarningOffsetMs(): number {
  return IDLE_TIMEOUT_MS - IDLE_WARNING_BEFORE_MS;
}

export type IdleDeadlines = {
  warningAt: number;
  logoutAt: number;
};

export function computeIdleDeadlines(lastActivityAt: number): IdleDeadlines {
  const logoutAt = lastActivityAt + IDLE_TIMEOUT_MS;
  return {
    warningAt: logoutAt - IDLE_WARNING_BEFORE_MS,
    logoutAt,
  };
}

/** Parse boolean env flags (`true` / `1` / `yes` / `on`). Empty or unset → false. */
export function parseIdleEnvFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw === "") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * Permanent feature flag. Default off until staged rollout enables it per environment.
 * Remains in the codebase forever as emergency rollback.
 */
export function isIdleSessionTimeoutEnabled(): boolean {
  const raw = import.meta.env?.VITE_IDLE_SESSION_TIMEOUT_ENABLED as string | undefined;
  return parseIdleEnvFlag(raw);
}
