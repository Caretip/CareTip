import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronDown, ShieldCheck } from "lucide-react";
import { CareTipLogo } from "@/app/components/CareTipLogo";
import type { AuthRole } from "@/components/ui/sign-in-card-2";
import { changeAppLanguage, type AppLanguage } from "@/i18n/i18n";
import { AuthButton } from "./AuthButton";
import { AuthCard } from "./AuthCard";
import { AuthHeader } from "./AuthHeader";
import { AuthInput } from "./AuthInput";
import { OTPInput } from "./OTPInput";
import { SocialLoginRow } from "./SocialLoginRow";
import type { OAuthProviderId } from "@/app/lib/oauthProviderIds";
import "@/styles/caretip-mobile-web-auth.css";

function MobileWebAuthBackNav() {
  const { t } = useTranslation();
  const label = t("staticPages.common.backToHome");

  return (
    <div className="mw-auth-topbar">
      <Link to="/" className="mw-auth-back" aria-label={label}>
        <ArrowLeft className="mw-auth-back__icon" strokeWidth={2.25} aria-hidden />
        <span className="mw-auth-back__label">{label}</span>
      </Link>
    </div>
  );
}

export type MobileWebAuthMode = "login" | "register" | "otp";

export type MobileWebAuthShellProps = {
  mode: MobileWebAuthMode;
  role: AuthRole;
  authLane: "business" | "employee";
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  otpCode: string;
  error: string;
  busy: boolean;
  resendBusy?: boolean;
  showResendVerification?: boolean;
  inviteCode?: string;
  employeeVenueName?: string;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onConfirmPasswordChange: (v: string) => void;
  onOtpChange: (v: string) => void;
  onToggleMode: () => void;
  onSubmit: (e: FormEvent) => void;
  onOtpSubmit: (e: FormEvent) => void;
  onResend?: () => void;
  onSocialCredential: (provider: OAuthProviderId, idToken: string) => void;
  sessionBanner?: ReactNode;
};

export function MobileWebAuthShell({
  mode,
  role: _role,
  authLane,
  name,
  email,
  password,
  confirmPassword,
  otpCode,
  error,
  busy,
  resendBusy = false,
  showResendVerification = false,
  inviteCode = "",
  employeeVenueName,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onOtpChange,
  onToggleMode,
  onSubmit,
  onOtpSubmit,
  onResend,
  onSocialCredential,
  sessionBanner,
}: MobileWebAuthShellProps) {
  const { t, i18n } = useTranslation();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const isEmployee = authLane === "employee";
  const isLogin = mode === "login";
  const allowSocialSignUp =
    isLogin ||
    !isEmployee ||
    (inviteCode.trim().length > 0 && name.trim().length > 0);
  const activeLang: AppLanguage = i18n.resolvedLanguage?.toLowerCase().startsWith("de")
    ? "de"
    : "en";

  useEffect(() => {
    if (mode !== "register") setTermsAccepted(false);
  }, [mode]);

  const toggleLocale = () => {
    void changeAppLanguage(activeLang === "de" ? "en" : "de");
  };

  if (sessionBanner) {
    return (
      <div className="mw-auth" data-mw-auth="session">
        <div className="mw-auth__inner">
          <MobileWebAuthBackNav />
          <div className="mw-auth-brand">
            <CareTipLogo size="auth" variant="wordmark" tone="auto" className="mw-auth-brand__logo" />
          </div>
          <AuthCard>{sessionBanner}</AuthCard>
        </div>
      </div>
    );
  }

  if (mode === "otp") {
    return (
      <div className="mw-auth" data-mw-auth="otp">
        <div className="mw-auth__inner">
          <MobileWebAuthBackNav />
          <AuthCard variant="otp">
            <AuthHeader
              title={t("auth.mobileWebAuth.otpTitle")}
              subtitle={t("auth.mobileWebAuth.otpSubtitle")}
              icon={
                <div className="mw-auth-header__icon-badge" aria-hidden>
                  <ShieldCheck className="h-7 w-7" strokeWidth={2.25} />
                </div>
              }
            />
            <form className="mw-auth-form" onSubmit={onOtpSubmit} noValidate>
              <OTPInput
                value={otpCode}
                onChange={onOtpChange}
                disabled={busy}
                ariaLabel={t("auth.mobileWebAuth.otpAria")}
              />
              <p className="mw-auth-resend">
                {t("auth.mobileWebAuth.otpResendPrompt")}{" "}
                <button
                  type="button"
                  className="mw-auth-resend__action"
                  disabled={busy || resendBusy || !onResend}
                  onClick={() => onResend?.()}
                >
                  {t("auth.mobileWebAuth.otpResend")}
                </button>
              </p>
              {error ? <p className="mw-auth-error">{error}</p> : <p className="mw-auth-error" />}
              <AuthButton loading={busy} loadingLabel={t("auth.mobileWebAuth.verifying")}>
                {t("auth.mobileWebAuth.verify")}
              </AuthButton>
            </form>
          </AuthCard>
        </div>
      </div>
    );
  }

  return (
    <div className="mw-auth" data-mw-auth={mode}>
      <div className="mw-auth__inner">
        <MobileWebAuthBackNav />
        <div className="mw-auth-brand">
          <CareTipLogo size="auth" variant="wordmark" tone="auto" className="mw-auth-brand__logo" />
        </div>

        <AuthCard>
          <AuthHeader
            title={
              isLogin
                ? t("auth.mobileWebAuth.loginTitle")
                : isEmployee
                  ? employeeVenueName
                    ? t("auth.employeeAuth.titleWelcomeVenue", { venue: employeeVenueName })
                    : t("auth.employeeAuth.titleJoinTeam")
                  : t("auth.mobileWebAuth.registerTitle")
            }
            subtitle={
              isLogin
                ? t("auth.mobileWebAuth.loginSubtitle")
                : isEmployee
                  ? t("auth.employeeAuth.subtitleInviteVerified")
                  : t("auth.mobileWebAuth.registerSubtitle")
            }
          />

          <form
            className="mw-auth-form"
            onSubmit={(e) => {
              if (!isLogin && !termsAccepted) {
                e.preventDefault();
                return;
              }
              onSubmit(e);
            }}
            noValidate
          >
            <input
              type="text"
              name="bot_trap"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="hidden"
              style={{ display: "none" }}
            />

            {!isLogin ? (
              <AuthInput
                label={t("auth.mobileWebAuth.labelName")}
                name="fullName"
                autoComplete="name"
                placeholder={t("auth.mobileWebAuth.placeholderName")}
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                disabled={busy}
              />
            ) : null}

            {isLogin ? (
              <div className="mw-auth-field">
                <label className="mw-auth-field__label" htmlFor="mw-auth-email">
                  {t("auth.page.labelEmail")}
                </label>
                <div className="mw-auth-phone-row">
                  <button
                    type="button"
                    className="mw-auth-country"
                    onClick={toggleLocale}
                    disabled={busy}
                    aria-label={t("nav.language")}
                  >
                    <span className="mw-auth-country__flag" aria-hidden>
                      {activeLang === "de" ? "🇩🇪" : "🇬🇧"}
                    </span>
                    <span>{activeLang === "de" ? "DE" : "EN"}</span>
                    <ChevronDown className="mw-auth-country__chevron h-4 w-4" aria-hidden />
                  </button>
                  <input
                    id="mw-auth-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder={t("auth.mobileWebAuth.placeholderEmail")}
                    value={email}
                    onChange={(e) => onEmailChange(e.target.value)}
                    disabled={busy}
                    className="mw-auth-input"
                  />
                </div>
              </div>
            ) : (
              <AuthInput
                label={t("auth.page.labelEmail")}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={t("auth.mobileWebAuth.placeholderEmail")}
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                disabled={busy}
              />
            )}

            <AuthInput
              label={t("auth.page.labelPassword")}
              name="password"
              passwordToggle
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder="********"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              disabled={busy}
            />

            {!isLogin ? (
              <AuthInput
                label={t("auth.page.labelConfirmPassword")}
                name="confirmPassword"
                passwordToggle
                autoComplete="new-password"
                placeholder="********"
                value={confirmPassword}
                onChange={(e) => onConfirmPasswordChange(e.target.value)}
                disabled={busy}
              />
            ) : null}

            {isLogin ? (
              <div className="mw-auth-forgot">
                <Link to="/forgot-password" className="mw-auth-forgot__link">
                  {t("auth.page.forgotPassword")}
                </Link>
              </div>
            ) : (
              <label className="mw-auth-checkbox">
                <input
                  type="checkbox"
                  className="mw-auth-checkbox__box"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  disabled={busy}
                />
                <span className="mw-auth-checkbox__text">
                  {t("auth.mobileWebAuth.agreePrefix")}{" "}
                  <Link to="/terms" className="mw-auth-checkbox__link">
                    {t("auth.mobileWebAuth.termsLink")}
                  </Link>
                </span>
              </label>
            )}

            {error ? <p className="mw-auth-error">{error}</p> : <p className="mw-auth-error" />}

            {isLogin && showResendVerification ? (
              <AuthButton
                type="button"
                variant="secondary"
                loading={resendBusy}
                onClick={() => onResend?.()}
              >
                {t("auth.page.resendVerificationEmail")}
              </AuthButton>
            ) : null}

            <AuthButton
              loading={busy}
              loadingLabel={
                isLogin ? t("common.loading.signingIn") : t("auth.page.creatingAccountWait")
              }
              disabled={!isLogin && !termsAccepted}
            >
              {isLogin ? t("auth.mobileWebAuth.logIn") : t("auth.mobileWebAuth.signUp")}
            </AuthButton>

            <div className="mw-auth-divider" role="separator">
              {isLogin
                ? t("auth.mobileWebAuth.orSignInWith")
                : t("auth.mobileWebAuth.orSignUpWith")}
            </div>

            <SocialLoginRow
              disabled={busy}
              isLogin={isLogin}
              allowSocialSignUp={allowSocialSignUp}
              onSocialCredential={onSocialCredential}
            />
          </form>

          <p className="mw-auth-footer">
            {isLogin
              ? t("auth.mobileWebAuth.footerNoAccount")
              : t("auth.mobileWebAuth.footerHasAccount")}{" "}
            <button
              type="button"
              className="mw-auth-footer__action"
              onClick={onToggleMode}
              disabled={busy}
            >
              {isLogin ? t("auth.mobileWebAuth.signUpLink") : t("auth.mobileWebAuth.signInLink")}
            </button>
          </p>
        </AuthCard>
      </div>
    </div>
  );
}
