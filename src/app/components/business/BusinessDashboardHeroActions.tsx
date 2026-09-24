import { Link } from "react-router";
import { Lock, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CareIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { businessUi } from "./businessDashboardUi";
import { businessDashboardQuickAccessItems } from "./businessDashboardQuickAccess";
import {
  isBusinessNavItemLocked,
  type BusinessDashboardNavItem,
} from "./businessDashboardNav";
import type { BusinessSubscriptionTier } from "@/app/lib/subscriptionCapabilities";

type BusinessDashboardHeroActionsProps = {
  isPreviewMode: boolean;
  entitlementsReady?: boolean;
  tier?: BusinessSubscriptionTier | null;
  className?: string;
  buttonClassName?: string;
  secondaryButtonClassName?: string;
};

function BusinessDashboardHeroActions({
  isPreviewMode,
  entitlementsReady = true,
  tier = null,
  className,
  buttonClassName,
  secondaryButtonClassName,
}: BusinessDashboardHeroActionsProps) {
  const { t } = useTranslation();

  if (isPreviewMode) {
    return (
      <div className={cn("business-hero-cta-row business-hero-quick-access", className)}>
        <Button type="button" className={cn(businessUi.btnPrimary, buttonClassName)} asChild>
          <Link to="/dashboard/billing/subscription" className={businessUi.heroCtaLink}>
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            {t("business.dashboard.preview.viewPlans")}
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn(businessUi.btnSecondary, secondaryButtonClassName)}
          asChild
        >
          <Link to="#dashboard-premium-features" className={businessUi.heroCtaLink}>
            {t("business.dashboard.preview.exploreFeatures")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <nav
      className={cn("business-hero-cta-row business-hero-quick-access", className)}
      aria-label={t("business.dashboard.quickAccessAria")}
    >
      {businessDashboardQuickAccessItems.map((item) => {
        const locked =
          entitlementsReady &&
          item.featureKey &&
          isBusinessNavItemLocked(
            { featureKey: item.featureKey } as Pick<BusinessDashboardNavItem, "featureKey">,
            tier,
          );
        const isPrimary = item.isPrimary === true;

        return (
          <Button
            key={item.id}
            type="button"
            variant={isPrimary ? "default" : "outline"}
            className={cn(
              isPrimary ? businessUi.btnPrimary : businessUi.btnSecondary,
              "business-hero-quick-access__btn !leading-snug",
              isPrimary ? buttonClassName : secondaryButtonClassName,
            )}
            asChild
          >
            <Link to={item.href} className={businessUi.heroCtaLink}>
              <CareIcon name={item.icon} size="sm" className="shrink-0" aria-hidden />
              <span className="min-w-0 text-center">{t(item.labelKey)}</span>
              {locked ? <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden /> : null}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

export { BusinessDashboardHeroActions };
