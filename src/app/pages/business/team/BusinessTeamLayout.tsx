import { Link, Outlet, useLocation } from "react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { BusinessModuleWorkspaceHeader } from "../../../components/business/BusinessModuleWorkspaceHeader";
import { PremiumModuleFeatureGate } from "../../../components/subscription/PremiumModuleFeatureGate";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import type { HeroPersonality } from "@/lib/heroPersonalitySystem";

export function BusinessTeamLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isPerformance = pathname.includes("/performance");
  const isTopPerformers = pathname.includes("/top-performers");
  const isPremiumAnalyticsRoute = isPerformance || isTopPerformers;

  const header = useMemo(() => {
    if (isPerformance) {
      return {
        personality: "performance" as HeroPersonality,
        subtitle: t("business.team.performance.headerSubtitle"),
      };
    }
    if (isTopPerformers) {
      return {
        personality: "team" as HeroPersonality,
        subtitle: t("business.team.topPerformersHeaderSubtitle"),
      };
    }
    return {
      personality: "employees" as HeroPersonality,
      subtitle: t("business.team.employeesHeaderSubtitle"),
    };
  }, [isPerformance, isTopPerformers, t]);

  const moduleContent = (
    <>
      <BusinessModuleWorkspaceHeader
        personality={header.personality}
        badge={t("business.team.eyebrow")}
        icon={Users}
        title={t("business.team.title")}
        subtitle={header.subtitle}
        hideSubtitleOnMobile
      />
      <Outlet />
    </>
  );

  return (
    <div className={businessUi.modulePageShell}>
      <div className={businessUi.modulePageContained}>
        {isPremiumAnalyticsRoute ? (
          <PremiumModuleFeatureGate featureKey="advancedAnalytics">{moduleContent}</PremiumModuleFeatureGate>
        ) : (
          moduleContent
        )}
      </div>
    </div>
  );
}
