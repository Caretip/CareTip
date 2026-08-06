import type { AuthRole } from "@/components/ui/sign-in-card-2";
import type { OAuthProviderId } from "@/app/lib/oauthProviderIds";
import { OAuthProviderRow } from "@/app/components/auth/OAuthProviderRow";

type AuthOAuthButtonsProps = {
  isLogin: boolean;
  role: AuthRole;
  formBusy: boolean;
  name: string;
  inviteCode: string;
  onSocialCredential: (provider: OAuthProviderId, idToken: string) => void;
};

/**
 * Desktop auth OAuth controls — circular provider row (shared with mobile web).
 * Credential / gating logic unchanged.
 */
export function AuthOAuthButtons({
  isLogin,
  role,
  formBusy,
  name,
  inviteCode,
  onSocialCredential,
}: AuthOAuthButtonsProps) {
  const canOAuthSignUp =
    isLogin ||
    role === "business" ||
    (role === "employee" && inviteCode.trim().length > 0 && name.trim().length > 0);

  return (
    <OAuthProviderRow
      disabled={formBusy}
      allowInteraction={canOAuthSignUp}
      onSocialCredential={onSocialCredential}
    />
  );
}
