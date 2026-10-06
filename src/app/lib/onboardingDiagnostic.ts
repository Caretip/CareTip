import { isApiRequestError } from "./apiError";

const LOG_PREFIX = "[CareTip:onboarding]";

export type OnboardingDiagnosticContext = {
  operation: string;
  step: number;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  authenticationRelated?: boolean;
};

function messageLooksAuthenticationRelated(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("authentication required") ||
    m.includes("invalid or expired token") ||
    m.includes("session") ||
    m.includes("token expired") ||
    m.includes("sign in again")
  );
}

/** Safe console diagnostics for onboarding failures — no tokens or secrets. */
export function logOnboardingDiagnostic(
  context: OnboardingDiagnosticContext,
  err?: unknown,
): void {
  const fromApi = err != null && isApiRequestError(err);
  const errorMessage =
    context.errorMessage ??
    (fromApi ? err.message : err instanceof Error ? err.message : err != null ? String(err) : undefined);

  const authenticationRelated =
    context.authenticationRelated ??
    (fromApi
      ? err.status === 401 ||
        err.status === 403 ||
        err.code === "SESSION_STALE" ||
        err.code === "TOKEN_EXPIRED" ||
        err.code === "TOKEN_INVALID"
      : typeof errorMessage === "string" && messageLooksAuthenticationRelated(errorMessage));

  const payload: Record<string, unknown> = {
    operation: context.operation,
    step: context.step,
    ...(context.httpStatus != null ? { httpStatus: context.httpStatus } : {}),
    ...(fromApi && err.code ? { errorCode: err.code } : context.errorCode ? { errorCode: context.errorCode } : {}),
    ...(errorMessage ? { errorMessage: errorMessage.slice(0, 500) } : {}),
    authenticationRelated,
  };

  if (import.meta.env.DEV) {
    console.warn(LOG_PREFIX, payload);
  } else {
    console.warn(LOG_PREFIX, JSON.stringify(payload));
  }
}
