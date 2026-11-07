import { Outlet, useLocation } from "react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Coins, HandCoins } from "lucide-react";
import { BusinessModuleWorkspaceHeader } from "../../../components/business/BusinessModuleWorkspaceHeader";
import { PremiumModuleFeatureGate } from "../../../components/subscription/PremiumModuleFeatureGate";
import type { HeroPersonality } from "@/lib/heroPersonalitySystem";
import { businessUi } from "@/app/components/business/businessDashboardUi";

export function BusinessTipsLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isAnalytics = pathname.includes("/analytics");
  const isTipDistribution = pathname.includes("/tip-distribution");

  /** One header per page: Tip distribution shows its own title here instead of a second header below. */
  const header = useMemo(() => {
    if (isTipDistribution) {
      return {
        personality: "billing" as HeroPersonality,
        badge: t("business.tipDistribution.eyebrow"),
        icon: HandCoins,
        title: t("business.tipDistribution.title"),
        subtitle: t("business.tipDistribution.subtitle"),
      };
    }
    if (isAnalytics) {
      return {
        personality: "analytics" as HeroPersonality,
        badge: t("business.tips.eyebrow"),
        icon: Coins,
        title: t("business.tips.title"),
        subtitle: t("business.tips.analyticsHeaderSubtitle"),
      };
    }
    return {
      personality: "tips" as HeroPersonality,
      badge: t("business.tips.eyebrow"),
      icon: Coins,
      title: t("business.tips.title"),
      subtitle: t("business.tips.subtitle"),
    };
  }, [isAnalytics, isTipDistribution, t]);

  const moduleContent = (
    <>
      <BusinessModuleWorkspaceHeader
        personality={header.personality}
        badge={header.badge}
        icon={header.icon}
        title={header.title}
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
