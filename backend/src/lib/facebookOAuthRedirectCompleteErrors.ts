import { EmailNotVerifiedLoginError } from "../utils/httpErrors.js";
import {
  OAuthAccountExistsError,
  OAuthEmailRequiredError,
  OAuthSignInFailedError,
} from "../services/oauthAuth.service.js";

/** Maps callback auth failures to SPA `/auth/facebook/complete` query params. */
export function resolveFacebookOAuthAuthCompleteError(err: unknown): string {
  if (err instanceof OAuthEmailRequiredError) {
    return "email_required";
  }
  if (err instanceof OAuthAccountExistsError) {
    return "account_exists";
  }
  if (err instanceof OAuthSignInFailedError) {
    return "sign_in_failed";
  }
  if (err instanceof EmailNotVerifiedLoginError) {
    return "email_not_verified";
  }
  return "sign_in_failed";
}
