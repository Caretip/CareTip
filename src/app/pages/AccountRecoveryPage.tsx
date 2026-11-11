import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { AuthRecoveryLayout } from "@/app/components/auth/AuthRecoveryLayout";
import { AuthErrorSlot, AuthStableSubmitButton } from "@/app/components/auth/AuthFormStability";
import { cancelAccountRecovery, confirmAccountRecovery, requestAccountRecovery } from "@/app/lib/api";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { logClientError } from "@/app/lib/clientLog";

/** The token sits in the URL fragment, so it never reaches server logs or a Referer header. */
function tokenFromHash(): string {
  const match = /(?:^#|&)token=([^&]+)/.exec(window.location.hash);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * Three steps of employee account recovery. `confirm` and `cancel` wait for a button press,
 * because mail scanners open links.
 */
export function AccountRecoveryPage() {
  const { t } = useTranslation();
  const { step } = useParams<{ step?: string }>();
  const mode = step === "confirm" || step === "cancel" ? step : "request";
  const [token] = useState(tokenFromHash);
  const [loginEmail, setLoginEmail] = useState("");
  const [replacementEmail, setReplacementEmail] = useState("");
  const [statement, setStatement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const ready = mode === "request" ? Boolean(loginEmail.trim() && replacementEmail.trim() && statement.trim()) : Boolean(token);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      if (mode === "request") await requestAccountRecovery({ loginEmail, replacementEmail, statement });
      else if (mode === "confirm") await confirmAccountRecovery(token);
      else await cancelAccountRecovery(token);
      if (mode !== "request") window.history.replaceState(null, "", window.location.pathname);
      setDone(true);
    } catch (err) {
      logClientError("AccountRecoveryPage", err);
      setError(toUserFriendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthRecoveryLayout
      compactMarketing
      title={t(`auth.accountRecovery.${mode}Title`)}
      subtitle={done ? t(`auth.accountRecovery.${mode}Done`) : t(`auth.accountRecovery.${mode}Body`)}
    >
      {done ? (
        <Link to="/login" className="caretip-auth-inline-link">
          {t("auth.accountRecovery.toSignIn")}
        </Link>
      ) : (
        <form onSubmit={handleSubmit}>
          {mode === "request" ? (
            <>
              <div className="caretip-auth-field-group">
                <label htmlFor="recovery-login" className="caretip-auth-label">{t("auth.accountRecovery.loginEmail")}</label>
                <input id="recovery-login" type="email" autoComplete="off" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} className="caretip-auth-field" />
              </div>
              <div className="caretip-auth-field-group">
                <label htmlFor="recovery-new" className="caretip-auth-label">{t("auth.accountRecovery.replacementEmail")}</label>
                <input id="recovery-new" type="email" autoComplete="email" value={replacementEmail} onChange={(e) => setReplacementEmail(e.target.value)} className="caretip-auth-field" />
              </div>
              <div className="caretip-auth-field-group">
                <label htmlFor="recovery-statement" className="caretip-auth-label">{t("auth.accountRecovery.statement")}</label>
                <textarea id="recovery-statement" rows={4} maxLength={2000} value={statement} onChange={(e) => setStatement(e.target.value)} className="caretip-auth-field" />
              </div>
            </>
          ) : null}
          <AuthErrorSlot>{error || (mode !== "request" && !token ? t("auth.accountRecovery.invalidLink") : null)}</AuthErrorSlot>
          <AuthStableSubmitButton type="submit" loading={submitting} loadingAriaLabel={t("auth.accountRecovery.working")} disabled={!ready}>
            {t(`auth.accountRecovery.${mode}Action`)}
          </AuthStableSubmitButton>
        </form>
      )}
    </AuthRecoveryLayout>
  );
}
