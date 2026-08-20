import { Outlet, useLocation } from "react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
import { BusinessModuleWorkspaceHeader } from "../../../components/business/BusinessModuleWorkspaceHeader";
import { PremiumModuleFeatureGate } from "../../../components/subscription/PremiumModuleFeatureGate";
import type { HeroPersonality } from "@/lib/heroPersonalitySystem";
import { businessUi } from "@/app/components/business/businessDashboardUi";

export function BusinessTipsLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isAnalytics = pathname.includes("/analytics");

  const header = useMemo(() => {
    if (isAnalytics) {
      return {
        personality: "analytics" as HeroPersonality,
        subtitle: t("business.tips.analyticsHeaderSubtitle"),
      };
    }
    return {
      personality: "tips" as HeroPersonality,
      subtitle: t("business.tips.subtitle"),
    };
  }, [isAnalytics, t]);

  const moduleContent = (
    <>
      <BusinessModuleWorkspaceHeader
        personality={header.personality}
        badge={t("business.tips.eyebrow")}
        icon={Coins}
        title={t("business.tips.title")}
        subtitle={header.subtitle}
        hideSubtitleOnMobile
      />
      <Outlet />
    </>
  );

  return (
    <div className={businessUi.modulePageShell}>
      <div className={businessUi.modulePageContained}>
        {isAnalytics ? (
          <PremiumModuleFeatureGate featureKey="advancedAnalytics">{moduleContent}</PremiumModuleFeatureGate>
        ) : (
          moduleContent
        )}
      </div>
    </div>
  );
}
