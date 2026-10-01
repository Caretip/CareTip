import { Outlet, useLocation } from "react-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { BusinessModuleWorkspaceHeader } from "../../../components/business/BusinessModuleWorkspaceHeader";
import { PremiumModuleFeatureGate } from "../../../components/subscription/PremiumModuleFeatureGate";
import { BusinessTeamHeaderActionsProvider } from "../../../components/business/BusinessTeamHeaderActions";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import type { HeroPersonality } from "@/lib/heroPersonalitySystem";

export function BusinessTeamLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isPerformance = pathname.includes("/performance");
  const isTopPerformers = pathname.includes("/top-performers");
  const isEmployees = !isPerformance && !isTopPerformers;
  const isPremiumAnalyticsRoute = isPerformance || isTopPerformers;
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const setActions = useCallback((node: ReactNode) => {
    setHeaderActions(node);
  }, []);

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
      hideSubtitleOnMobile: false,
      headerActionsAlign: "end" as const,
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
        hideSubtitleOnMobile={header.hideSubtitleOnMobile ?? true}
        actions={isEmployees ? headerActions : undefined}
        actionsAlign={header.headerActionsAlign ?? "start"}
      />
      {isEmployees ? (
        <BusinessTeamHeaderActionsProvider setActions={setActions}>
          <Outlet />
        </BusinessTeamHeaderActionsProvider>
      ) : (
        <Outlet />
      )}
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
