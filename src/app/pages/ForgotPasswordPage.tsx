import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { AuthRecoveryLayout } from "@/app/components/auth/AuthRecoveryLayout";
import { AuthTrustStrip } from "@/app/components/auth/AuthTrustStrip";
import { AuthErrorSlot, AuthStableSubmitButton } from "@/app/components/auth/AuthFormStability";
import { requestPasswordReset } from "@/app/lib/api";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { logClientError } from "@/app/lib/clientLog";

import { caretipBtnPrimaryFull } from "@/lib/caretipButtonSystem";
import { cn } from "@/lib/utils";

export function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("auth.forgot.errorInvalidEmail"));
      return;
    }
    setSubmitting(true);
    try {
      const loc = i18n.resolvedLanguage?.toLowerCase().startsWith("de") ? "de" : "en";
      await requestPasswordReset(trimmed, loc);
      setSent(true);
    } catch (err) {
      logClientError("ForgotPasswordPage", err);
      setError(toUserFriendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthRecoveryLayout authLane="business" marketingScene="recovery" showFooterLink={false}>
        <div className="space-y-4 text-center">
          <h1 className="caretip-auth-title !pt-0">{t("auth.forgot.sentTitle")}</h1>
          <p className="caretip-auth-subtitle !mt-2">
            {t("auth.forgot.sentBody", { email: email.trim() })}
          </p>
          <Link
            to="/login"
            className={cn(caretipBtnPrimaryFull, "caretip-auth-submit no-underline")}
          >
            {t("auth.forgot.backToLogin")}
          </Link>
        </div>
      </AuthRecoveryLayout>
    );
  }

  return (
    <AuthRecoveryLayout
      authLane="business"
      marketingScene="recovery"
      title={t("auth.forgot.title")}
      subtitle={t("auth.forgot.subtitle")}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="caretip-auth-form" noValidate>
        <div className="caretip-auth-field-group">
          <label htmlFor="forgot-email" className="caretip-auth-label">
            {t("auth.forgot.emailLabel")}
          </label>
          <input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="caretip-auth-field"
            placeholder={t("auth.forgot.emailPlaceholder")}
          />
        </div>
        <AuthErrorSlot>{error || null}</AuthErrorSlot>
        <AuthStableSubmitButton
          type="submit"
          loading={submitting}
          loadingAriaLabel={t("auth.forgot.sending")}
          className="disabled:cursor-not-allowed"
        >
          {t("auth.forgot.sendResetLink")}
        </AuthStableSubmitButton>
        <p className="caretip-auth-form-status-slot text-center">
          <Link to="/account/recovery" className="caretip-auth-inline-link">
            {t("auth.accountRecovery.forgotLink")}
          </Link>
        </p>
        <AuthTrustStrip />
      </form>
    </AuthRecoveryLayout>
  );
}
