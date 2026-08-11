import { normalizeApiError, type NormalizedApiError } from "@/types/api";
import type { OAuthProvider } from "@/types/auth";
import {
  GOOGLE_ACCOUNT_NOT_REGISTERED,
  GOOGLE_TOKEN_VERIFICATION_FAILED,
  OAUTH_ACCOUNT_NOT_REGISTERED,
  OAUTH_LINKING_REQUIRED,
  OAUTH_TOKEN_VERIFICATION_FAILED,
  OAUTH_EMAIL_REQUIRED,
} from "@/constants/authErrors";
import {
  GoogleSignInCancelledError,
  GoogleSignInUnavailableError,
} from "@/services/google/googleSignInErrors";
import {
  AppleSignInCancelledError,
  AppleSignInUnavailableError,
} from "@/services/apple/appleSignInErrors";
import {
  FacebookSignInCancelledError,
  FacebookSignInUnavailableError,
} from "@/services/facebook/facebookSignInErrors";
import { formatUserFacingError } from "@/utils/userFacingError";

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

function fallbackKeyForProvider(provider?: OAuthProvider): string {
  if (provider === "apple") return "auth.appleSignInFailed";
  if (provider === "facebook") return "auth.facebookSignInFailed";
  return "auth.googleSignInFailed";
}

export function resolveOAuthErrorMessage(
  error: NormalizedApiError | Error,
  t: TranslateFn,
  providerOrFallback?: OAuthProvider | string,
): string {
  const provider =
    providerOrFallback === "google" ||
    providerOrFallback === "apple" ||
    providerOrFallback === "facebook"
      ? providerOrFallback
      : undefined;
  const fallbackKey =
    typeof providerOrFallback === "string" && !provider
      ? providerOrFallback
      : fallbackKeyForProvider(provider);

  if (error instanceof GoogleSignInCancelledError) {
    return t("auth.googleSignInCancelled");
  }
  if (error instanceof AppleSignInCancelledError) {
    return t("auth.appleSignInCancelled");
  }
  if (error instanceof FacebookSignInCancelledError) {
    return t("auth.facebookSignInCancelled");
  }
  if (error instanceof GoogleSignInUnavailableError) {
    return t("auth.googleNotConfigured");
  }
  if (error instanceof AppleSignInUnavailableError) {
    return t("auth.appleNotConfigured");
  }
  if (error instanceof FacebookSignInUnavailableError) {
    return t("auth.facebookNotConfigured");
  }

  const normalized: NormalizedApiError =
    typeof error === "object" &&
    error !== null &&
    "isNetworkError" in error &&
    "status" in error
      ? (error as NormalizedApiError)
      : normalizeApiError(error);

  if (normalized.isNetworkError || normalized.isTimeout) {
    return t("errors.offline");
  }
  if (
    normalized.code === GOOGLE_ACCOUNT_NOT_REGISTERED ||
    normalized.code === OAUTH_ACCOUNT_NOT_REGISTERED
  ) {
    return t("auth.oauthAccountNotRegistered");
  }
  if (normalized.code === OAUTH_LINKING_REQUIRED) {
    return t("auth.oauthLinkingRequired");
  }
  if (normalized.code === OAUTH_EMAIL_REQUIRED) {
    return t("auth.oauthEmailRequired");
  }
  if (
    normalized.code === GOOGLE_TOKEN_VERIFICATION_FAILED ||
    normalized.code === OAUTH_TOKEN_VERIFICATION_FAILED
  ) {
    return t("auth.oauthTokenInvalid");
  }

  return formatUserFacingError(error, t(fallbackKey), t);
}

export function isOAuthAccountNotRegistered(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === GOOGLE_ACCOUNT_NOT_REGISTERED ||
      (error as { code?: string }).code === OAUTH_ACCOUNT_NOT_REGISTERED)
  );
}

/** @deprecated Prefer isOAuthAccountNotRegistered */
export function isGoogleAccountNotRegistered(error: unknown): boolean {
  return isOAuthAccountNotRegistered(error);
}
