import type { NormalizedApiError } from "@/types/api";
import {
  GOOGLE_ACCOUNT_NOT_REGISTERED,
  GOOGLE_TOKEN_VERIFICATION_FAILED,
} from "@/constants/authErrors";
import {
  GoogleSignInCancelledError,
  GoogleSignInUnavailableError,
} from "@/services/google/googleSignInErrors";

type TranslateFn = (key: string) => string;

export function resolveOAuthErrorMessage(
  error: NormalizedApiError | Error,
  t: TranslateFn,
  fallbackKey = "auth.googleSignInFailed",
): string {
  if (error instanceof GoogleSignInCancelledError) {
    return t("auth.googleSignInCancelled");
  }
  if (error instanceof GoogleSignInUnavailableError) {
    return error.message || t("auth.googleNotConfigured");
  }

  const normalized =
    "isNetworkError" in error
      ? error
      : ({
          message: error.message,
          code: undefined,
          isNetworkError: false,
          isTimeout: false,
          isUnauthorized: false,
          status: null,
        } satisfies NormalizedApiError);

  if (normalized.isNetworkError || normalized.isTimeout) {
    return t("errors.offline");
  }
  if (normalized.code === GOOGLE_ACCOUNT_NOT_REGISTERED) {
    return t("auth.googleAccountNotRegistered");
  }
  if (normalized.code === GOOGLE_TOKEN_VERIFICATION_FAILED) {
    return t("auth.googleTokenInvalid");
  }
  if (normalized.message && normalized.message !== "Something went wrong. Please try again.") {
    return normalized.message;
  }
  return t(fallbackKey);
}

export function isGoogleAccountNotRegistered(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === GOOGLE_ACCOUNT_NOT_REGISTERED
  );
}
