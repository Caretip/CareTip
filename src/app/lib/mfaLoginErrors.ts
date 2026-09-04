import { isApiRequestError } from "./apiError";
import { isApiConnectivityError } from "./errorMessages";

export const MFA_INVALID_CODE = "MFA_INVALID_CODE" as const;
export const MFA_CHALLENGE_EXPIRED = "MFA_CHALLENGE_EXPIRED" as const;
export const MFA_CHALLENGE_INVALID = "MFA_CHALLENGE_INVALID" as const;

export type MfaUiFailureKind =
  | "invalid_code"
  | "challenge_ended"
  | "rate_limited"
  | "unavailable";

/** Maps MFA verify HTTP failures to UI recovery — does not surface internals. */
export function classifyMfaVerifyFailure(err: unknown): MfaUiFailureKind {
  if (isApiRequestError(err) && err.status === 429) return "rate_limited";
  if (isApiConnectivityError(err)) return "unavailable";
  if (isApiRequestError(err) && (err.status === 503 || err.status === 500 || err.status === 502)) {
    return "unavailable";
  }
  if (
    isApiRequestError(err) &&
    (err.code === MFA_CHALLENGE_EXPIRED || err.code === MFA_CHALLENGE_INVALID)
  ) {
    return "challenge_ended";
  }
  if (isApiRequestError(err) && err.code === MFA_INVALID_CODE) return "invalid_code";
  if (isApiRequestError(err) && (err.status === 400 || err.status === 401)) {
    const m = err.message.toLowerCase();
    if (m.includes("expired") || m.includes("no longer valid")) return "challenge_ended";
    if (m.includes("authentication code") || m.includes("verification code")) return "invalid_code";
  }
  return "unavailable";
}
