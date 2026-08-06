/**
 * Approved OAuth provider logos.
 * Google: Light theme white disc + official multicolor G (clear on white).
 */
import googleLogo from "@/assets/oauth/google.png";
import facebookLogo from "@/assets/oauth/facebook.png";
import appleLogo from "@/assets/oauth/apple.png";
import type { OAuthProviderId } from "@/app/lib/oauthProviderIds";

export const OAUTH_LOGO_SRC: Record<OAuthProviderId, string> = {
  google: googleLogo,
  facebook: facebookLogo,
  apple: appleLogo,
};
