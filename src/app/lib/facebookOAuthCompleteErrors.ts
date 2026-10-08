import { FACEBOOK_OAUTH_START_FAILED_ERROR } from "@/app/lib/facebookOAuthRedirectWeb";

export type FacebookOAuthCompletionErrorKind = "query" | "session" | "start";

export function facebookOAuthCompleteErrorMessageKey(code: string | null): string {
  switch (code) {
    case "cancelled":
      return "auth.oauth.facebookRedirectCancelled";
    case "denied":
      return "auth.oauth.facebookRedirectDenied";
    case "email_required":
      return "auth.oauth.facebookEmailRequired";
    case "email_not_verified":
      return "auth.oauth.facebookEmailNotVerified";
    case "account_exists":
      return "auth.oauth.facebookRedirectAccountExists";
    case "already_processed":
      return "auth.oauth.facebookRedirectAlreadyProcessed";
    case "state_invalid":
    case "invalid_callback":
      return "auth.oauth.facebookRedirectStateInvalid";
    case "session_failed":
      return "auth.oauth.facebookRedirectSessionFailed";
    case FACEBOOK_OAUTH_START_FAILED_ERROR:
      return "auth.oauth.facebookRedirectStartFailed";
    default:
      return "auth.oauth.facebookRedirectFailed";
  }
}

export function facebookOAuthCompleteErrorTitleKey(
  kind: FacebookOAuthCompletionErrorKind,
  queryCode: string | null,
): string {
  if (kind === "session") return "auth.oauth.facebookRedirectSessionErrorTitle";
  if (queryCode === FACEBOOK_OAUTH_START_FAILED_ERROR) {
    return "auth.oauth.facebookRedirectStartErrorTitle";
  }
  if (queryCode === "account_exists") {
    return "auth.oauth.facebookRedirectAccountExistsTitle";
  }
  return "auth.oauth.facebookRedirectErrorTitle";
}
