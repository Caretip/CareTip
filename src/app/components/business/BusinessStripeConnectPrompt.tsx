import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FixPrompt, type FixPromptDensity } from "../FixPrompt";
import { STRIPE_CONNECT_HREF } from "./businessDashboardNav";
import { connectNeedsSetup, useConnectStatus } from "../../hooks/useConnectStatus";
import { useAuth } from "../../hooks/useAuth";
import {
  getEmployeeTipPayoutMode,
  hasClientAccessToken,
  type EmployeeTipPayoutMode,
} from "../../lib/api";
import { logClientError } from "../../lib/clientLog";
import { isApiAuthSessionError } from "../../lib/apiError";
import { isAuthenticatedWithAccessToken } from "../../lib/authRestore";

type BusinessStripeConnectPromptProps = {
  density?: FixPromptDensity;
  className?: string;
};

export function BusinessStripeConnectPrompt({ density, className }: BusinessStripeConnectPromptProps) {
  const { t } = useTranslation();
  const { user, authStatus } = useAuth();
  const apiReady = isAuthenticatedWithAccessToken(user, authStatus);
  const { data, loading, error } = useConnectStatus(apiReady);
  const [payoutMode, setPayoutMode] = useState<EmployeeTipPayoutMode | null>(null);
  const issueActive = connectNeedsSetup(data, loading, error);
  const conditionVersion = `${data?.status ?? "not_ready"}:${payoutMode ?? "unknown"}`;

  /**
   * Evaluating is a write: reporting "not active" before status has loaded resolves the prompt, and
   * the real report then counts as a new occurrence, which clears the user's dismissal. Only
   * evaluate on known inputs. Payout mode is part of the fingerprint, so it must be known too.
   */
  const evaluationReady =
    !loading && !error && data != null && (!issueActive || payoutMode != null);

  useEffect(() => {
    // Only the setup prompt's copy and fingerprint use the mode.
    if (!issueActive || !apiReady || !hasClientAccessToken()) return undefined;
    let cancelled = false;
    void getEmployeeTipPayoutMode()
      .then((res) => {
        if (!cancelled) setPayoutMode(res.mode);
      })
      .catch((err) => {
        if (!isApiAuthSessionError(err)) {
          logClientError("BusinessStripeConnectPrompt.mode", err);
        }
        if (!cancelled) setPayoutMode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiReady, issueActive]);

  const descriptionKey =
    payoutMode === "direct_to_employee"
      ? "business.fixConnect.descriptionDirect"
      : payoutMode === "business_distribution"
        ? "business.fixConnect.descriptionBusiness"
        : "business.fixConnect.description";

  return (
    <FixPrompt
      id="stripeConnect"
      enabled={evaluationReady}
      issueActive={issueActive}
      conditionVersion={conditionVersion}
      tone="info"
      density={density}
      title={t("business.fixConnect.title")}
      description={t(descriptionKey)}
      actionLabel={
        data?.status && data.status !== "not_connected"
          ? t("business.fixConnect.actionComplete")
          : t("business.fixConnect.action")
      }
      actionTo={STRIPE_CONNECT_HREF}
      className={className}
    />
  );
}
