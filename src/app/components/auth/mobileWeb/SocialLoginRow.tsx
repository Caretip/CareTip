import type { OAuthProviderId } from "@/app/lib/oauthProviderIds";
import { OAuthProviderRow } from "@/app/components/auth/OAuthProviderRow";

type SocialLoginRowProps = {
  disabled?: boolean;
  isLogin?: boolean;
  /** When false, social signup is blocked (e.g. employee without invite + name). */
  allowSocialSignUp?: boolean;
  blockedTitle?: string;
  onSocialCredential: (provider: OAuthProviderId, idToken: string) => void;
};

/**
 * Mobile-web OAuth controls — same circular row as desktop AuthOAuthButtons.
 */
export function SocialLoginRow({
  disabled = false,
  isLogin = true,
  allowSocialSignUp = true,
  blockedTitle,
  onSocialCredential,
}: SocialLoginRowProps) {
  const allowInteraction = isLogin || allowSocialSignUp;

  return (
    <OAuthProviderRow
      disabled={disabled}
      allowInteraction={allowInteraction}
      blockedTitle={blockedTitle}
      onSocialCredential={onSocialCredential}
    />
  );
}
