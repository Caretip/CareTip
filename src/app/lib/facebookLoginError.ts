export type FacebookLoginFailureKind =
  | "cancelled"
  | "callback_missing_auth"
  /** Legacy — no longer assigned by timing heuristics; kept for presenters. */
  | "popup_blocked"
  /** SDK returned unknown without auth; no observable popup-block evidence. */
  | "session_bridge_unverified"
  /** Reserved when popup lifecycle cannot be verified (not user-facing in Phase Two). */
  | "popup_unverified"
  | "incomplete"
  | "sdk_not_ready"
  | "concurrent"
  | "sdk_load_failed"
  | "not_configured"
  | "generic";

/** Structured Facebook JS SDK login failure (not CareTip API / OAuth backend). */
export class FacebookLoginError extends Error {
  readonly kind: FacebookLoginFailureKind;
  readonly fbStatus?: string;
  readonly fbOutcome?: string;

  constructor(
    kind: FacebookLoginFailureKind,
    message: string,
    options?: { fbStatus?: string; fbOutcome?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "FacebookLoginError";
    this.kind = kind;
    this.fbStatus = options?.fbStatus;
    this.fbOutcome = options?.fbOutcome;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isFacebookLoginError(e: unknown): e is FacebookLoginError {
  return e instanceof FacebookLoginError;
}
