/**
 * Idle warning chrome: document title + Stay signed-in store transition.
 * Checkpoint 3 — no auth logout here (logout wired in CP4).
 */

import {
  beginIdleDocumentTitleCountdown,
  endIdleDocumentTitleCountdown,
  isIdleDocumentTitleCountdownActive,
  updateIdleDocumentTitle,
} from "./idleDocumentTitle";
import { dismissIdleWarning, touchIdleActivity } from "./idleSessionStore";

/**
 * Keep tab title aligned with wall-clock seconds remaining while warning/grace is open.
 */
export function syncIdleWarningDocumentTitle(
  open: boolean,
  secondsRemaining: number,
): void {
  if (!open) {
    endIdleDocumentTitleCountdown();
    return;
  }
  if (!isIdleDocumentTitleCountdownActive()) {
    beginIdleDocumentTitleCountdown(secondsRemaining);
  } else {
    updateIdleDocumentTitle(secondsRemaining);
  }
}

export type IdleStayResult = {
  /** True when activity touch succeeded (session extended in store). */
  extended: boolean;
};

/**
 * Stay signed in: force activity, clear warning phase, restore title.
 * Does not emit analytics — caller emits `idle_session_extended` only after this returns extended.
 */
export function performIdleStaySignedIn(now: number = Date.now()): IdleStayResult {
  const extended = touchIdleActivity(now, { force: true });
  dismissIdleWarning();
  endIdleDocumentTitleCountdown();
  return { extended };
}
