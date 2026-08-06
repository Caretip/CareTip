export const EMAIL_NOT_VERIFIED_CODE = "EMAIL_NOT_VERIFIED" as const;

/** Returned with 400 from POST /api/auth/oauth when Google login finds no CareTip user for that email. */
export const GOOGLE_ACCOUNT_NOT_REGISTERED_CODE = "GOOGLE_ACCOUNT_NOT_REGISTERED" as const;

/** Returned with 400 from POST /api/auth/oauth when a non-Google social login finds no CareTip user. */
export const OAUTH_ACCOUNT_NOT_REGISTERED_CODE = "OAUTH_ACCOUNT_NOT_REGISTERED" as const;

/** Returned with 409 when email exists and provider must be linked from Settings. */
export const OAUTH_LINKING_REQUIRED_CODE = "OAUTH_LINKING_REQUIRED" as const;

/** Returned when Facebook (or similar) did not provide an email. */
export const OAUTH_EMAIL_REQUIRED_CODE = "OAUTH_EMAIL_REQUIRED" as const;

/** Returned when the provider identity token could not be verified. */
export const OAUTH_TOKEN_VERIFICATION_FAILED_CODE = "OAUTH_TOKEN_VERIFICATION_FAILED" as const;

/** Returned with 403 when a Premium capability is required (see subscriptionCapabilities). */
export const SUBSCRIPTION_REQUIRED_CODE = "SUBSCRIPTION_REQUIRED" as const;

/** Legacy — broad platform gate (pre-refactor). Prefer GO_LIVE_REQUIRED_CODE. */
export const PENDING_VERIFICATION_CODE = "PENDING_VERIFICATION" as const;

/** Returned with 403 when a go-live capability (QR, tipping, payments) is not approved yet. */
export const GO_LIVE_REQUIRED_CODE = "GO_LIVE_REQUIRED" as const;

/** Structured API failure from {@link apiRequest} / {@link handleRes} when the server returns JSON with `code`. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly canResend?: boolean
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isApiRequestError(e: unknown): e is ApiRequestError {
  return e instanceof ApiRequestError;
}

export function isApiSubscriptionRequiredError(e: unknown): boolean {
  return isApiRequestError(e) && e.code === SUBSCRIPTION_REQUIRED_CODE;
}

export function isApiGoLiveRequiredError(e: unknown): boolean {
  if (!isApiRequestError(e)) return false;
  if (e.code === GO_LIVE_REQUIRED_CODE) return true;
  return e.status === 403 && /approved to go live|after.*verification/i.test(e.message);
}

/** @deprecated Setup APIs no longer return this; kept for defensive UI handling. */
export function isApiPendingVerificationError(e: unknown): boolean {
  if (isApiGoLiveRequiredError(e)) return false;
  if (!isApiRequestError(e)) return false;
  if (e.code === PENDING_VERIFICATION_CODE) return true;
  return e.status === 403 && /pending verification/i.test(e.message);
}
