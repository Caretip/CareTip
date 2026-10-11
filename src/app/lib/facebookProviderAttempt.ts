/**
 * Per-provider Facebook OAuth attempt phases (single authoritative row state).
 */

export type FacebookOAuthAttemptPhase =
  | "idle"
  | "loading"
  | "redirecting"
  | "awaiting_callback"
  | "success"
  | "cancelled"
  | "timeout"
  | "error";

export type FacebookOAuthFailureKind = "timeout" | "start_failed" | "provider_error" | "blocked";

export type FacebookOAuthAttemptState = {
  attemptId: number;
  phase: FacebookOAuthAttemptPhase;
  failureKind?: FacebookOAuthFailureKind;
};

export const FACEBOOK_OAUTH_IDLE: FacebookOAuthAttemptState = { attemptId: 0, phase: "idle" };

export function nextFacebookAttemptId(current: number): number {
  return current + 1;
}

export function beginFacebookAttempt(prev: FacebookOAuthAttemptState): FacebookOAuthAttemptState {
  const attemptId = nextFacebookAttemptId(prev.attemptId);
  return { attemptId, phase: "loading" };
}

export function applyFacebookPhaseIfCurrent(
  state: FacebookOAuthAttemptState,
  attemptId: number,
  phase: FacebookOAuthAttemptPhase,
  failureKind?: FacebookOAuthFailureKind,
): FacebookOAuthAttemptState {
  if (attemptId !== state.attemptId) return state;
  if (phase === "idle") return FACEBOOK_OAUTH_IDLE;
  return { attemptId, phase, failureKind };
}

/** True when the Facebook circle should show a spinner (this provider only). */
export function facebookProviderShowsLoading(state: FacebookOAuthAttemptState): boolean {
  return state.phase === "loading" || state.phase === "redirecting";
}

/** Inline status under social buttons (not on initial page load). */
export function facebookShowsConnectingStatus(state: FacebookOAuthAttemptState): boolean {
  return state.phase === "loading" || state.phase === "redirecting";
}

export function facebookShowsFailureStatus(state: FacebookOAuthAttemptState): boolean {
  return state.phase === "timeout" || state.phase === "error";
}

export function isFacebookAttemptTerminal(state: FacebookOAuthAttemptState): boolean {
  return (
    state.phase === "success" ||
    state.phase === "cancelled" ||
    state.phase === "timeout" ||
    state.phase === "error" ||
    state.phase === "idle"
  );
}
