import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AuthSplitLayout } from "./AuthSplitLayout";
import { AuthCardBrandMark } from "./AuthCardBrandMark";
import type { AuthLane, AuthMarketingScene } from "./authMarketingContent";

type AuthRecoveryLayoutProps = {
  children: React.ReactNode;
  showFooterLink?: boolean;
  title?: string;
  subtitle?: string;
  authLane?: AuthLane;
  marketingScene?: AuthMarketingScene;
  /** Smaller left marketing panel — verification & recovery flows. */
  compactMarketing?: boolean;
};

/**
 * Password recovery / verification — same split-screen shell as sign-in.
 */
export function AuthRecoveryLayout({
  children,
  showFooterLink = true,
  title,
  subtitle,
  authLane = "business",
  marketingScene,
  compactMarketing = false,
}: AuthRecoveryLayoutProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "caretip-auth-page caretip-auth-recovery-stage relative font-sans",
        compactMarketing && "caretip-auth-recovery-stage--compact-marketing",
      )}
    >
      <AuthSplitLayout
        authLane={authLane}
        marketingScene={marketingScene}
        compactMarketing={compactMarketing}
      >
        <div className="caretip-auth-recovery-inner">
          <div className="caretip-auth-card caretip-auth-card--stable caretip-auth-card--recovery caretip-auth-card--verify-email">
            <AuthCardBrandMark />
            {title ? (
              <div className="caretip-auth-header caretip-auth-header--verify !mb-3">
                <h1 className="caretip-auth-title !pt-0">{title}</h1>
                {subtitle ? <p className="caretip-auth-subtitle caretip-auth-subtitle--verify">{subtitle}</p> : null}
              </div>
            ) : null}
            <div className="caretip-auth-card-body caretip-auth-card-body--recovery">{children}</div>
          </div>
          {showFooterLink ? (
            <p className="caretip-auth-footer-link">
              <Link to="/login">{t("auth.recovery.backToSignIn")}</Link>
            </p>
          ) : null}
        </div>
      </AuthSplitLayout>
    </div>
  );
}
