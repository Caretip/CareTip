import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FixPrompt, type FixPromptDensity } from "../FixPrompt";
import { STRIPE_CONNECT_HREF } from "./businessDashboardNav";
import { connectNeedsSetup, useConnectStatus } from "../../hooks/useConnectStatus";
import {
  getEmployeeTipPayoutMode,
  type EmployeeTipPayoutMode,
} from "../../lib/api";
import { logClientError } from "../../lib/clientLog";

type BusinessStripeConnectPromptProps = {
  density?: FixPromptDensity;
  className?: string;
};

export function BusinessStripeConnectPrompt({ density, className }: BusinessStripeConnectPromptProps) {
  const { t } = useTranslation();
  const { data, loading, error } = useConnectStatus();
  const [payoutMode, setPayoutMode] = useState<EmployeeTipPayoutMode | null>(null);
  const issueActive = connectNeedsSetup(data, loading, error);
  const conditionVersion = `${data?.status ?? "not_ready"}:${payoutMode ?? "unknown"}`;

  useEffect(() => {
    let cancelled = false;
    void getEmployeeTipPayoutMode()
      .then((res) => {
        if (!cancelled) setPayoutMode(res.mode);
      })
      .catch((err) => {
        logClientError("BusinessStripeConnectPrompt.mode", err);
        if (!cancelled) setPayoutMode(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const descriptionKey =
    payoutMode === "direct_to_employee"
      ? "business.fixConnect.descriptionDirect"
      : payoutMode === "business_distribution"
        ? "business.fixConnect.descriptionBusiness"
        : "business.fixConnect.description";

  return (
    <FixPrompt
      id="stripeConnect"
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
