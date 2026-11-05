import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { AuthRecoveryLayout } from "@/app/components/auth/AuthRecoveryLayout";
import { AuthErrorSlot, AuthStableSubmitButton } from "@/app/components/auth/AuthFormStability";
import { approveEmailChange, confirmEmailChange } from "@/app/lib/api";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { logClientError } from "@/app/lib/clientLog";

/** The token sits in the URL fragment, so it never reaches server logs or a Referer header. */
function tokenFromHash(): string {
  const match = /(?:^#|&)token=([^&]+)/.exec(window.location.hash);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * Handles the links in email change messages. Nothing happens on page load: mail scanners open
 * links, so a person has to press the button.
 */
export function EmailChangePage() {
  const { t } = useTranslation();
  const { step } = useParams<{ step: string }>();
  const approving = step === "approve";
  const [token] = useState(tokenFromHash);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      await (approving ? approveEmailChange(token) : confirmEmailChange(token));
      window.history.replaceState(null, "", window.location.pathname);
      setDone(true);
    } catch (err) {
      logClientError("EmailChangePage", err);
      setError(toUserFriendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const copy = approving ? "approve" : "confirm";
  return (
    <AuthRecoveryLayout
      compactMarketing
      title={t(`auth.emailChange.${copy}Title`)}
      subtitle={done ? t(`auth.emailChange.${copy}Done`) : t(`auth.emailChange.${copy}Body`)}
    >
      {done ? (
        <Link to="/login" className="caretip-auth-inline-link">
          {t("auth.emailChange.toSignIn")}
        </Link>
      ) : (
        <form onSubmit={handleSubmit}>
          <AuthErrorSlot>{error || (token ? null : t("auth.emailChange.invalidLink"))}</AuthErrorSlot>
          <AuthStableSubmitButton
            type="submit"
            loading={submitting}
            loadingAriaLabel={t("auth.emailChange.working")}
            disabled={!token}
          >
            {t(`auth.emailChange.${copy}Action`)}
          </AuthStableSubmitButton>
        </form>
      )}
    </AuthRecoveryLayout>
  );
}
