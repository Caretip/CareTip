import { Link } from "react-router";
import { Sparkles, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CareIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { businessUi } from "./businessDashboardUi";
import { QR_STUDIO_BASE } from "./businessDashboardNav";

type BusinessDashboardHeroActionsProps = {
  isPreviewMode: boolean;
  className?: string;
  buttonClassName?: string;
  secondaryButtonClassName?: string;
};

export function BusinessDashboardHeroActions({
  isPreviewMode,
  className,
  buttonClassName,
  secondaryButtonClassName,
}: BusinessDashboardHeroActionsProps) {
  const { t } = useTranslation();

  if (isPreviewMode) {
    return (
      <div className={cn("business-hero-cta-row", className)}>
        <Button type="button" className={cn(businessUi.btnPrimary, buttonClassName)} asChild>
          <Link to="/dashboard/billing/subscription" className={businessUi.heroCtaLink}>
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            {t("business.dashboard.preview.viewPlans")}
          </Link>
        </Button>
        <Button type="button" variant="outline" className={cn(businessUi.btnSecondary, secondaryButtonClassName)} asChild>
          <Link to="#dashboard-premium-features" className={businessUi.heroCtaLink}>
            {t("business.dashboard.preview.exploreFeatures")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("business-hero-cta-row", className)}>
      <Button type="button" className={cn(businessUi.btnPrimary, buttonClassName)} asChild>
        <Link to={QR_STUDIO_BASE} className={businessUi.heroCtaLink}>
          <CareIcon name="tableQr" size="sm" className="shrink-0" />
          {t("business.hero.openQrStudio")}
        </Link>
      </Button>
      <Button type="button" variant="outline" className={cn(businessUi.btnSecondary, secondaryButtonClassName)} asChild>
        <Link to="/dashboard/team/performance" className={businessUi.heroCtaLink}>
          <TrendingUp className="h-4 w-4 shrink-0" aria-hidden />
          {t("business.hero.viewTeamPerformance")}
        </Link>
      </Button>
    </div>
  );
}
