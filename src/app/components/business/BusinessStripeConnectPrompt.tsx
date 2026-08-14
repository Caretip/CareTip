import { useTranslation } from "react-i18next";
import { FixPrompt, type FixPromptDensity } from "../FixPrompt";
import { STRIPE_CONNECT_HREF } from "./businessDashboardNav";
import { connectNeedsSetup, useConnectStatus } from "../../hooks/useConnectStatus";

type BusinessStripeConnectPromptProps = {
  density?: FixPromptDensity;
  className?: string;
};

export function BusinessStripeConnectPrompt({ density, className }: BusinessStripeConnectPromptProps) {
  const { t } = useTranslation();
  const { data, loading, error } = useConnectStatus();
  const issueActive = connectNeedsSetup(data, loading, error);

  return (
    <FixPrompt
      id="stripeConnect"
      issueActive={issueActive}
      tone="info"
      density={density}
      title={t("business.fixConnect.title")}
      description={t("business.fixConnect.description")}
      actionLabel={t("business.fixConnect.action")}
      actionTo={STRIPE_CONNECT_HREF}
      dismissPersistence="session"
      className={className}
    />
  );
}
