import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import type { AuthRole } from "@/components/ui/sign-in-card-2";
import type { OAuthProviderId } from "@/app/lib/oauthProviderIds";
import { OAuthProviderRow } from "@/app/components/auth/OAuthProviderRow";

type AuthOAuthButtonsProps = {
  isLogin: boolean;
  role: AuthRole;
  formBusy: boolean;
  name: string;
  inviteCode: string;
  /** Business signup must accept merchant legal docs before OAuth. */
  merchantLegalAccepted?: boolean;
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
  merchantLegalAccepted = false,
  onSocialCredential,
}: AuthOAuthButtonsProps) {
  const { t } = useTranslation();
  const canOAuthSignUp =
    isLogin ||
    (role === "business" && merchantLegalAccepted) ||
    (role === "employee" && inviteCode.trim().length > 0 && name.trim().length > 0);

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
      disabled={formBusy}
      allowInteraction={canOAuthSignUp}
      facebookRedirectContext={facebookRedirectContext}
      blockedTitle={
        !isLogin && role === "business" && !merchantLegalAccepted
          ? t("auth.merchantLegalAcceptance.requiredError")
          : undefined
      }
      onSocialCredential={onSocialCredential}
    />
  );
}
