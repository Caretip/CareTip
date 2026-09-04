/** Safe client-facing MFA errors — no internals, no account enumeration. */
export const MFA_INVALID_CODE = "MFA_INVALID_CODE" as const;
export const MFA_CHALLENGE_EXPIRED = "MFA_CHALLENGE_EXPIRED" as const;
export const MFA_CHALLENGE_INVALID = "MFA_CHALLENGE_INVALID" as const;

export const MFA_INVALID_CODE_MESSAGE =
  "Invalid authentication code. Please check your authenticator app and try again.";
export const MFA_CHALLENGE_EXPIRED_MESSAGE =
  "Your verification session has expired. Please sign in again.";
export const MFA_CHALLENGE_INVALID_MESSAGE =
  "Your verification session is no longer valid. Please sign in again.";
export const MFA_VERIFY_UNAVAILABLE_MESSAGE =
  "We couldn't verify your code right now. Please try again.";
