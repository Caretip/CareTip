import type { OAuthProviderId, VerifiedIdentity } from "./types.js";
import { verifyGoogleIdentity } from "./googleVerifier.js";
import { verifyAppleIdentity } from "./appleVerifier.js";
import { verifyFacebookIdentity } from "./facebookVerifier.js";

export async function verifyOAuthIdentity(
  provider: OAuthProviderId,
  idToken: string,
): Promise<VerifiedIdentity> {
  switch (provider) {
    case "google":
      return verifyGoogleIdentity(idToken);
    case "apple":
      return verifyAppleIdentity(idToken);
    case "facebook":
      return verifyFacebookIdentity(idToken);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported OAuth provider: ${String(_exhaustive)}`);
    }
  }
}

export { isOAuthProviderId } from "./types.js";
export type { OAuthProviderId, VerifiedIdentity } from "./types.js";
export {
  OAuthTokenVerificationError,
  OAUTH_TOKEN_VERIFICATION_FAILED_CODE,
} from "./googleVerifier.js";
