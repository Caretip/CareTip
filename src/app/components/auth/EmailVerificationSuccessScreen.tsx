import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { AuthRecoveryLayout } from "@/app/components/auth/AuthRecoveryLayout";
import { resolveVerificationMarketingLane } from "@/app/components/auth/authMarketingContent";
import { LoadingSpinner } from "@/app/components/ui/loading-spinner";
import { useAuth } from "@/app/hooks/useAuth";
import { getLoginPathForSessionRole } from "@/app/lib/authSession";
import {
  buildMobileLoginAfterVerifyUrl,
  isMobileClientQuery,
} from "@/app/lib/mobileAppDeepLink";
import { caretipBtnPrimaryFull, caretipBtnSecondaryFull } from "@/lib/caretipButtonSystem";
import { cn } from "@/lib/utils";

/** Post-verification success — continue to login (web) or return to the CareTip app (mobile). */
export function EmailVerificationSuccessScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { logout, user } = useAuth();

  const verificationLane = resolveVerificationMarketingLane(user?.role);
  const mobileHandoff = useMemo(() => isMobileClientQuery(searchParams), [searchParams]);
  const appLoginUrl = useMemo(
    () => buildMobileLoginAfterVerifyUrl(user?.email ?? null),
    [user?.email],
  );

  useEffect(() => {
    if (!mobileHandoff) return;
    // Attempt automatic return to the native app; button remains as fallback.
    try {
      window.location.href = appLoginUrl;
    } catch {
      /* ignore */
    }
  }, [appLoginUrl, mobileHandoff]);

  const handleContinueWeb = () => {
    const loginPath = getLoginPathForSessionRole(user?.role ?? "user");
    void logout();
    navigate(loginPath, { replace: true });
  };

  const handleOpenApp = () => {
    window.location.href = appLoginUrl;
  };

  return (
    <AuthRecoveryLayout
      authLane={verificationLane}
      marketingScene="verification"
      showFooterLink={false}
      compactMarketing
    >
      <div
        className="flex flex-col items-center gap-5 py-2 text-center"
        role="status"
        aria-live="polite"
      >
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
          aria-hidden
        >
          <CheckCircle2 className="h-8 w-8" strokeWidth={2.25} />
        </div>
        <div className="space-y-2">
          <h1 className="caretip-auth-title !pt-0">{t("auth.checkEmail.successTitle")}</h1>
          <p className="caretip-auth-subtitle !mt-0">
            {mobileHandoff
              ? t("auth.checkEmail.successSubtitleMobile", {
                  defaultValue:
                    "Your email is verified. Continue in the CareTip app to finish setup.",
                })
              : t("auth.checkEmail.successSubtitle")}
          </p>
          {!mobileHandoff ? (
            <p className="text-sm text-muted-foreground">{t("auth.checkEmail.successContinueBody")}</p>
          ) : null}
        </div>
        {mobileHandoff ? (
          <>
            <a
              href={appLoginUrl}
              onClick={handleOpenApp}
              className={cn(caretipBtnPrimaryFull, "caretip-auth-submit w-full")}
            >
              {t("auth.checkEmail.openApp", { defaultValue: "Open CareTip app" })}
            </a>
            <button
              type="button"
              onClick={handleContinueWeb}
              className={cn(caretipBtnSecondaryFull, "w-full")}
            >
              {t("auth.checkEmail.continueOnWeb", { defaultValue: "Continue on web instead" })}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleContinueWeb}
            className={cn(caretipBtnPrimaryFull, "caretip-auth-submit w-full")}
          >
            {t("auth.checkEmail.continue")}
          </button>
        )}
      </div>
    </AuthRecoveryLayout>
  );
}

export function EmailVerificationVerifyingScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const verificationLane = resolveVerificationMarketingLane(user?.role);

  return (
    <AuthRecoveryLayout
      authLane={verificationLane}
      marketingScene="verification"
      showFooterLink={false}
      compactMarketing
    >
      <div
        className="flex flex-col items-center gap-5 py-2 text-center"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <LoadingSpinner size="md" className="text-primary/80" />
        <div className="space-y-2">
          <h1 className="caretip-auth-title !pt-0">{t("auth.checkEmail.verifyingTitle")}</h1>
          <p className="caretip-auth-subtitle !mt-0">{t("auth.checkEmail.verifyingBody")}</p>
        </div>
      </div>
    </AuthRecoveryLayout>
  );
}
