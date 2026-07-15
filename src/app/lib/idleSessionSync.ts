/**
 * Apply cross-tab idle messages to the module store (no React).
 * Checkpoint 5.
 */

import type { IdleChannelMessage } from "./idleSessionChannel";
import {
  applyRemoteIdleActivity,
  dismissIdleWarning,
  openIdleWarning,
  touchIdleActivity,
} from "./idleSessionStore";

export type IdleChannelApplyResult =
  | "ignored"
  | "activity"
  | "stay"
  | "warning"
  | "logout";

export type ApplyIdleChannelMessageContext = {
  /** This tab's id — ignore own logout echoes if they ever loop back. */
  tabId: string;
  onRemoteLogout: () => void;
};

/**
 * Mutate idle store from a peer tab message.
 * Caller updates React UI / schedules / titles after the result.
 */
export function applyIdleChannelMessage(
  message: IdleChannelMessage,
  ctx: ApplyIdleChannelMessageContext,
): IdleChannelApplyResult {
  switch (message.type) {
    case "activity": {
      return applyRemoteIdleActivity(message.ts) ? "activity" : "ignored";
    }
    case "stay": {
      // Force activity + clear warning phase (same session extension as local Stay).
      touchIdleActivity(message.ts, { force: true });
      dismissIdleWarning();
      return "stay";
    }
    case "warning": {
      openIdleWarning(message.logoutAt);
      return "warning";
    }
    case "logout": {
      if (message.leaderId === ctx.tabId) return "ignored";
      ctx.onRemoteLogout();
      return "logout";
    }
    default:
      return "ignored";
  }
}
