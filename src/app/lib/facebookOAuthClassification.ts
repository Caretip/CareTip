import type { FacebookLoginFailureKind } from "./facebookLoginError";
import type { FbLoginOutcome } from "./facebookOAuthWeb.types";

export type SdkLoginDiagnostics = {
  status: string;
  hasAuthResponse: boolean;
  hasAccessToken: boolean;
  outcome: FbLoginOutcome;
};

export type ClassifySdkLoginFailureOptions = {
  lifecycle?: {
    popupLifecycleObserved: "unknown" | "focus_shift_after_invoke";
    sawVisibleAfterHidden: boolean;
  };
};

/**
 * Maps SDK callback outcomes to internal failure kinds.
 * Does not use elapsed-time heuristics for popup blocking.
 */
export function classifySdkLoginFailure(
  diagnostics: SdkLoginDiagnostics,
  _opts?: ClassifySdkLoginFailureOptions,
): FacebookLoginFailureKind {
  if (diagnostics.outcome === "not_authorized") {
    return "cancelled";
  }
  if (diagnostics.outcome === "unknown" && !diagnostics.hasAuthResponse) {
    return "session_bridge_unverified";
  }
  if (diagnostics.outcome === "connected_without_token") {
    return "callback_missing_auth";
  }
  if (diagnostics.status === "connected" && !diagnostics.hasAuthResponse) {
    return "callback_missing_auth";
  }
  return "incomplete";
}
