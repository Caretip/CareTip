import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { Eye, EyeOff } from "lucide-react";
import { AuthRecoveryLayout } from "@/app/components/auth/AuthRecoveryLayout";
import { AuthTrustStrip } from "@/app/components/auth/AuthTrustStrip";
import {
  AuthErrorSlot,
  AuthFieldErrorSlot,
  AuthStableSubmitButton,
} from "@/app/components/auth/AuthFormStability";
import { resetPasswordWithToken } from "@/app/lib/api";
import { isPasswordStrong } from "@/app/lib/passwordValidation";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { logClientError } from "@/app/lib/clientLog";
import { caretipBtnPrimaryFull } from "@/lib/caretipButtonSystem";
import { cn } from "@/lib/utils";

const FIELD_PASSWORD = "caretip-auth-field caretip-auth-field--password-toggle";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { token: tokenParam } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const rawToken = tokenParam ? decodeURIComponent(tokenParam) : "";

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const match = newPassword.length > 0 && newPassword === confirm;
  const strong = isPasswordStrong(newPassword);
  const canSubmit = match && strong && !submitting && rawToken.length > 0;

  const mismatchHint = useMemo(() => {
    if (confirm.length === 0) return null;
    if (newPassword === confirm) return null;
    return t("auth.reset.mismatch");
  }, [newPassword, confirm, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setSubmitting(true);
    try {
      await resetPasswordWithToken(rawToken, newPassword);
      setDone(true);
    } catch (err) {
      logClientError("ResetPasswordPage", err);
      setError(toUserFriendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!rawToken) {
    return (
      <AuthRecoveryLayout authLane="business" marketingScene="passwordReset">
        <p className="text-center text-sm text-red-600">{t("auth.reset.invalidToken")}</p>
        <Link to="/forgot-password" className="mt-4 block text-center text-sm font-medium text-primary hover:underline">
          {t("auth.reset.requestNewLink")}
        </Link>
      </AuthRecoveryLayout>
    );
  }

  if (done) {
    return (
      <AuthRecoveryLayout authLane="business" marketingScene="passwordReset" showFooterLink={false}>
        <div className="space-y-4 text-center">
          <h1 className="caretip-auth-title !pt-0">{t("auth.reset.doneTitle")}</h1>
          <p className="caretip-auth-subtitle !mt-2">{t("auth.reset.doneSubtitle")}</p>
          <button
            type="button"
            onClick={() => navigate("/login", { replace: true })}
            className={cn(caretipBtnPrimaryFull, "caretip-auth-submit")}
          >
            {t("auth.reset.backToLogin")}
          </button>
        </div>
      </AuthRecoveryLayout>
    );
  }

  return (
    <AuthRecoveryLayout
      authLane="business"
      marketingScene="passwordReset"
      title={t("auth.reset.title")}
      subtitle={t("auth.reset.subtitle")}
    >
        <form onSubmit={(e) => void handleSubmit(e)} className="caretip-auth-form">
          <div className="caretip-auth-field-group">
            <label htmlFor="reset-new" className="caretip-auth-label">
              {t("auth.reset.labelNew")}
            </label>
            <div className="relative">
              <input
                id="reset-new"
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={FIELD_PASSWORD}
              />
              <button
                type="button"
                className="caretip-auth-field-toggle"
                onClick={() => setShowNew(!showNew)}
                aria-label={showNew ? t("auth.reset.hidePassword") : t("auth.reset.showPassword")}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="caretip-auth-field-group">
            <label htmlFor="reset-confirm" className="caretip-auth-label">
              {t("auth.reset.labelConfirm")}
            </label>
            <div className="relative">
              <input
                id="reset-confirm"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={FIELD_PASSWORD}
              />
              <button
                type="button"
                className="caretip-auth-field-toggle"
                onClick={() => setShowConfirm(!showConfirm)}
                aria-label={showConfirm ? t("auth.reset.hidePassword") : t("auth.reset.showPassword")}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <AuthFieldErrorSlot>{mismatchHint}</AuthFieldErrorSlot>
          </div>
          <AuthErrorSlot>{error || null}</AuthErrorSlot>
          <AuthStableSubmitButton
            type="submit"
            loading={submitting}
            loadingAriaLabel={t("auth.reset.saving")}
            disabled={!canSubmit}
            className="disabled:cursor-not-allowed"
          >
            {t("auth.reset.updatePassword")}
          </AuthStableSubmitButton>
          <p className="caretip-auth-form-status-slot text-center">
            {!strong && newPassword.length > 0 ? t("auth.reset.hintWeak") : null}
          </p>
          <AuthTrustStrip />
        </form>
    </AuthRecoveryLayout>
  );
}
