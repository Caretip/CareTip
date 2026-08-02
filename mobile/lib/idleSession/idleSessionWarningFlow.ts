/**
 * Stay signed-in store transition — port of web idleSessionWarningFlow (title sync omitted on mobile).
 */

import { dismissIdleWarning, touchIdleActivity } from "./idleSessionStore";

export type IdleStayResult = {
  extended: boolean;
};

export function performIdleStaySignedIn(now: number = Date.now()): IdleStayResult {
  const extended = touchIdleActivity(now, { force: true });
  dismissIdleWarning();
  return { extended };
}
