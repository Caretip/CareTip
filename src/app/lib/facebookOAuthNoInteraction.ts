import type { FacebookAttemptLifecycleSnapshot } from "./facebookOAuthAttemptLifecycle";

/**
 * Additional wait after {@link FB_LOGIN_POPUP_PROBE_MS} before terminating a
 * no-callback attempt with no observable popup/focus shift (10s total from invoke).
 */
export const FB_NO_CALLBACK_NO_POPUP_GRACE_AFTER_PROBE_MS = 5_000;

/** Test-only override; production always uses the constant above. */
let graceAfterProbeMsOverride: number | null = null;

export function setNoCallbackNoPopupGraceAfterProbeMsForTesting(ms: number | null): void {
  graceAfterProbeMsOverride = ms;
}

export function noCallbackNoPopupGraceAfterProbeMs(): number {
  return graceAfterProbeMsOverride ?? FB_NO_CALLBACK_NO_POPUP_GRACE_AFTER_PROBE_MS;
}

/**
 * True when browser forensics show no focus/visibility shift that would indicate
 * an active Facebook dialog/popup — not proof of popup blocking.
 */
export function noObservablePopupInteraction(
  lifecycle: FacebookAttemptLifecycleSnapshot | null | undefined,
): boolean {
  if (!lifecycle) {
    return true;
  }
  if (lifecycle.popupLifecycleObserved === "focus_shift_after_invoke") {
    return false;
  }
  if (lifecycle.sawBlurAfterFbLoginInvoke) {
    return false;
  }
  if (lifecycle.sawHiddenWhileAttemptActive) {
    return false;
  }
  if (lifecycle.sawBlurWhileAttemptActive) {
    return false;
  }
  return true;
}

export function shouldEarlyTerminateNoCallbackAttempt(input: {
  callbackReceived: boolean;
  deliveryPending: boolean;
  lifecycle: FacebookAttemptLifecycleSnapshot | null | undefined;
}): boolean {
  if (!input.deliveryPending || input.callbackReceived) {
    return false;
  }
  return noObservablePopupInteraction(input.lifecycle);
}
