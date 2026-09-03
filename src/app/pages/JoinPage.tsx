import { useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { AuthErrorSlot, AuthStableSubmitButton } from "@/app/components/auth/AuthFormStability";
import { AuthFieldGroup } from "@/app/components/auth/AuthFieldGroup";
import { AuthSplitLayout } from "@/app/components/auth/AuthSplitLayout";
import { AuthCardBrandMark } from "@/app/components/auth/AuthCardBrandMark";
import { AuthTrustStrip } from "@/app/components/auth/AuthTrustStrip";
import { validateInviteCode } from "../lib/api";
import { toUserFriendlyMessage } from "../lib/errorMessages";
import { logClientError } from "../lib/clientLog";
import { saveValidatedInviteContext } from "../lib/inviteContextStore";

export function JoinPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const prefilledCode = useMemo(() => (params.code ? String(params.code) : ""), [params.code]);
  const [code, setCode] = useState(prefilledCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = code.trim();
    if (!cleaned) return;
    setError("");
    setBusy(true);
    try {
      const validated = await validateInviteCode(cleaned);
      saveValidatedInviteContext({
        inviteCode: cleaned,
        businessName: validated.businessName,
        businessId: validated.businessId,
        businessSlug: validated.businessSlug,
        businessLocation: validated.businessLocation,
      });
      navigate("/join/signup", { replace: true });
    } catch (err) {
      logClientError("JoinPage.validateInvite", err);
      setError(toUserFriendlyMessage(err) || t("join.invalidCodeFallback"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="caretip-auth-page font-sans">
      <AuthSplitLayout authLane="employee" marketingScene="invite">
        <div className="caretip-auth-card-wrap">
          <div className="caretip-auth-card caretip-auth-card--stable caretip-auth-card--recovery">
            <AuthCardBrandMark />
            <div className="caretip-auth-header">
              <p className="text-sm font-semibold text-muted-foreground">{t("join.eyebrow")}</p>
              <h1 className="caretip-auth-title !pt-2">{t("join.title")}</h1>
              <p className="caretip-auth-subtitle">{t("join.subtitle")}</p>
            </div>
            <div className="caretip-auth-card-body caretip-auth-card-body--recovery">
              <form onSubmit={handleContinue} className="caretip-auth-form">
                <AuthFieldGroup label={t("join.inviteLabel")} htmlFor="join-invite-code">
                  <div className="relative">
                    <KeyRound className="caretip-auth-field-icon" aria-hidden />
                    <input
                      id="join-invite-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      inputMode="numeric"
                      placeholder={t("join.placeholder")}
                      className="caretip-auth-field caretip-auth-field--has-icon"
                      autoComplete="one-time-code"
                    />
                  </div>
                </AuthFieldGroup>

                <AuthErrorSlot>{error || null}</AuthErrorSlot>

                <AuthStableSubmitButton
                  type="submit"
                  loading={busy}
                  loadingAriaLabel={t("join.checking")}
                  disabled={!code.trim()}
                  className="disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("join.continue")}
                </AuthStableSubmitButton>

                <AuthTrustStrip />
              </form>

              <p className="caretip-auth-form-footer mt-4">
                {t("join.footerPrompt")}{" "}
                <Link to="/employee/login" className="font-semibold text-primary hover:underline">
                  {t("join.signIn")}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </AuthSplitLayout>
    </div>
  );
}
