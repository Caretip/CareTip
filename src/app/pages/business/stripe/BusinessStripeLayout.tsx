import { Outlet, useLocation } from "react-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { BusinessModuleWorkspaceHeader } from "../../../components/business/BusinessModuleWorkspaceHeader";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { BusinessStripeHeaderActionsProvider } from "../../../components/business/BusinessStripeHeaderActions";

export function BusinessStripeLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isPayouts = pathname.includes("/payouts");
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const setActions = useCallback((node: ReactNode) => {
    setHeaderActions(node);
  }, []);

  const header = useMemo(() => {
    if (isPayouts) {
      return {
        title: t("business.stripe.nav.payouts"),
        subtitle: t("business.stripe.payoutsSubtitle"),
        hideSubtitleOnMobile: false,
      };
    }
    return {
      title: t("business.stripe.nav.connect"),
      subtitle: t("business.stripe.moduleSubtitle"),
      hideSubtitleOnMobile: false,
    };
  }, [isPayouts, t]);

  return (
    <div className={businessUi.modulePageShell}>
      <div className={businessUi.modulePageContained}>
        <BusinessStripeHeaderActionsProvider setActions={setActions}>
          <BusinessModuleWorkspaceHeader
            personality="tips"
            badge={t("business.stripe.moduleEyebrow")}
            icon={Landmark}
            title={header.title}
            subtitle={header.subtitle}
            hideSubtitleOnMobile={header.hideSubtitleOnMobile}
            actions={headerActions}
            actionsAlign="end"
          />
          <Outlet />
        </BusinessStripeHeaderActionsProvider>
      </div>
    </div>
  );
}
