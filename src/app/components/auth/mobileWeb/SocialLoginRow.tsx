import { useMemo } from "react";
import type { AuthRole } from "@/components/ui/sign-in-card-2";
import type { OAuthProviderId } from "@/app/lib/oauthProviderIds";
import { OAuthProviderRow } from "@/app/components/auth/OAuthProviderRow";

type SocialLoginRowProps = {
  disabled?: boolean;
  isLogin?: boolean;
  role?: AuthRole;
  name?: string;
  inviteCode?: string;
  merchantLegalAccepted?: boolean;
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
  role = "business",
  name = "",
  inviteCode = "",
  merchantLegalAccepted = false,
  allowSocialSignUp = true,
  blockedTitle,
  onSocialCredential,
}: SocialLoginRowProps) {
  const allowInteraction = isLogin || allowSocialSignUp;

  const facebookRedirectContext = useMemo(
    () => ({
      isLogin,
      returnPath:
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : isLogin
            ? "/login"
            : "/signup",
      intendedRole: role === "employee" ? ("EMPLOYEE" as const) : ("MANAGER" as const),
      name: name.trim() || undefined,
      inviteCode: inviteCode.trim() || undefined,
      merchantLegalAccepted: role === "business" ? merchantLegalAccepted : undefined,
    }),
    [isLogin, role, name, inviteCode, merchantLegalAccepted],
  );

  return (
    <OAuthProviderRow
      disabled={disabled}
      allowInteraction={allowInteraction}
      blockedTitle={blockedTitle}
      onSocialCredential={onSocialCredential}
      facebookRedirectContext={facebookRedirectContext}
    />
  );
}
