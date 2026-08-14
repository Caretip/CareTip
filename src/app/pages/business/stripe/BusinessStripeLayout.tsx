import { Outlet, useLocation } from "react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { BusinessModuleWorkspaceHeader } from "../../../components/business/BusinessModuleWorkspaceHeader";
import { businessUi } from "@/app/components/business/businessDashboardUi";

export function BusinessStripeLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isPayouts = pathname.includes("/payouts");

  const header = useMemo(() => {
    if (isPayouts) {
      return {
        subtitle: t("business.stripe.payoutsSubtitle"),
      };
    }
    return {
      subtitle: t("business.stripe.moduleSubtitle"),
    };
  }, [isPayouts, t]);

  return (
    <div className={businessUi.modulePageShell}>
      <div className={businessUi.modulePageContained}>
        <BusinessModuleWorkspaceHeader
          personality="tips"
          badge={t("business.stripe.moduleEyebrow")}
          icon={Landmark}
          title={t("business.stripe.moduleTitle")}
          subtitle={header.subtitle}
        />
        <Outlet />
      </div>
    </div>
  );
}
