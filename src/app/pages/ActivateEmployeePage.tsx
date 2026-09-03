import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Eye, EyeOff } from "lucide-react";
import {
  AuthErrorSlot,
  AuthFieldErrorSlot,
  AuthStableSubmitButton,
} from "@/app/components/auth/AuthFormStability";
import { AuthRecoveryLayout } from "@/app/components/auth/AuthRecoveryLayout";
import { AuthTrustStrip } from "@/app/components/auth/AuthTrustStrip";
import { BusinessLogoMark } from "@/app/components/business/BusinessLogoMark";
import { activateEmployeeWithToken, getActivateEmployeeBranding } from "@/app/lib/api";
import { isPasswordStrong } from "@/app/lib/passwordValidation";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { logClientError } from "@/app/lib/clientLog";
import { useTranslation } from "react-i18next";
import { caretipBtnPrimaryFull } from "@/lib/caretipButtonSystem";
import { cn } from "@/lib/utils";

const FIELD_PASSWORD = "caretip-auth-field caretip-auth-field--password-toggle";

export function ActivateEmployeePage() {
  const { t } = useTranslation();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const rawToken = sp.get("token")?.trim() ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [branding, setBranding] = useState<{ businessName: string; businessLogo: string | null } | null>(null);

  const match = newPassword.length > 0 && newPassword === confirm;
  const strong = isPasswordStrong(newPassword);
  const canSubmit = match && strong && !submitting && rawToken.length > 0;

  const mismatchHint = useMemo(() => {
    if (confirm.length === 0) return null;
    if (newPassword === confirm) return null;
    return t("auth.page.errorPasswordsMismatch");
  }, [newPassword, confirm, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setSubmitting(true);
    try {
      await activateEmployeeWithToken(rawToken, newPassword);
      setDone(true);
    } catch (err) {
      logClientError("ActivateEmployeePage", err);
      setError(toUserFriendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!rawToken) return;
    let cancelled = false;
    void getActivateEmployeeBranding(rawToken)
      .then((p) => {
        if (cancelled) return;
        setBranding(p);
      })
      .catch(() => {
        if (cancelled) return;
        setBranding(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rawToken]);

  if (!rawToken) {
    return (
      <AuthRecoveryLayout authLane="employee" marketingScene="passwordSetup">
        <p className="text-center text-sm text-red-600">{t("auth.activateEmployee.invalidLink")}</p>
        <Link
          to="/employee/login"
          className="mt-4 block text-center text-sm font-medium text-primary hover:underline"
        >
          {t("auth.reset.backToLogin")}
        </Link>
      </AuthRecoveryLayout>
    );
  }

  if (done) {
    return (
      <AuthRecoveryLayout authLane="employee" marketingScene="activation" showFooterLink={false}>
        <div className="space-y-4 text-center">
          <h1 className="caretip-auth-title !pt-0">{t("auth.activateEmployee.doneTitle")}</h1>
          <p className="caretip-auth-subtitle !mt-2">{t("auth.activateEmployee.doneSubtitle")}</p>
          <button
            type="button"
            onClick={() => navigate("/employee/login", { replace: true })}
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
      authLane="employee"
      marketingScene="passwordSetup"
      title={t("auth.activateEmployee.title")}
      subtitle={t("auth.activateEmployee.subtitle")}
    >
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <BusinessLogoMark
            logoPathOrUrl={branding?.businessLogo ?? null}
            businessName={branding?.businessName ?? t("dashboard.venueDashboardFallback")}
            size="lg"
          />
          <p className="text-sm font-semibold text-foreground">
            {branding?.businessName ?? t("dashboard.venueDashboardFallback")}
          </p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="caretip-auth-form">
          <div>
            <label htmlFor="activate-new" className="caretip-auth-label">
              {t("auth.page.labelPassword")}
            </label>
            <div className="relative">
              <input
                id="activate-new"
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
                aria-label={showNew ? t("auth.page.hidePassword") : t("auth.page.showPassword")}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="activate-confirm" className="caretip-auth-label">
              {t("auth.page.labelConfirmPassword")}
            </label>
            <div className="relative">
              <input
                id="activate-confirm"
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
                aria-label={showConfirm ? t("auth.page.hidePassword") : t("auth.page.showPassword")}
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
            loadingAriaLabel={t("auth.activateEmployee.saving")}
            disabled={!canSubmit}
            className="disabled:cursor-not-allowed"
          >
            {t("auth.activateEmployee.submit")}
          </AuthStableSubmitButton>
          <p className="caretip-auth-form-status-slot text-center">
            {!strong && newPassword.length > 0 ? t("auth.reset.hintWeak") : null}
          </p>
          <AuthTrustStrip />
        </form>
      </div>
    </AuthRecoveryLayout>
  );
}
