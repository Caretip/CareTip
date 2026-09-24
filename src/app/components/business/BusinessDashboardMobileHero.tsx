import { memo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MarketingPicture } from "@/lib/marketingPicture";
import bizzyHeroWebp from "../../../../images/finalbizzy-hero.webp";
import bizzyHeroAvif from "../../../../images/finalbizzy-hero.avif";
import { BusinessHeroFinancialMetrics } from "./BusinessHeroFinancialMetrics";
import type { BusinessFinancialSummaryBundle } from "../../lib/api";
import { BusinessDashboardHeroActions } from "./BusinessDashboardHeroActions";
import { dashboardFormalGreetingBadgeClassName } from "../../lib/dashboardFormalGreeting";

import type { BusinessSubscriptionTier } from "@/app/lib/subscriptionCapabilities";

type BusinessDashboardMobileHeroProps = {
  greetingBadge: string;
  isPreviewMode: boolean;
  entitlementsReady?: boolean;
  tier?: BusinessSubscriptionTier | null;
  financialSummary: BusinessFinancialSummaryBundle | null;
  financialSummaryLedgerLoading: boolean;
  financialSummaryConnectLoading: boolean;
  financialSummaryRefreshing: boolean;
  className?: string;
};

export const BusinessDashboardMobileHero = memo(function BusinessDashboardMobileHero({
  greetingBadge,
  isPreviewMode,
  entitlementsReady = true,
  tier = null,
  financialSummary,
  financialSummaryLedgerLoading,
  financialSummaryConnectLoading,
  financialSummaryRefreshing,
  className,
}: BusinessDashboardMobileHeroProps) {
  const { t } = useTranslation();

  return (
    <section
      className={cn("business-dashboard-mobile-hero", className)}
      aria-labelledby="business-mobile-hero-title"
    >
      <div className="business-dashboard-mobile-hero__content">
        <div
          className={cn(
            "business-dashboard-mobile-hero__badge",
            dashboardFormalGreetingBadgeClassName,
          )}
        >
          <span>{greetingBadge}</span>
        </div>

        <h1 id="business-mobile-hero-title" className="business-dashboard-mobile-hero__title">
          {t("business.hero.headlineLine1")}
          <span className="block">{t("business.hero.headlineLine2")}</span>
        </h1>

        <p className="business-dashboard-mobile-hero__description">{t("business.hero.sub")}</p>

        <motion.div
          className="business-dashboard-mobile-hero__actions"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <BusinessHeroFinancialMetrics
            ledgerLoading={financialSummaryLedgerLoading}
            connectLoading={financialSummaryConnectLoading}
            summary={financialSummary}
            isRefreshing={financialSummaryRefreshing}
            className="business-dashboard-mobile-hero__metrics"
          />
          <BusinessDashboardHeroActions
            isPreviewMode={isPreviewMode}
            entitlementsReady={entitlementsReady}
            tier={tier}
            className="business-dashboard-mobile-hero__cta-row"
            buttonClassName="business-dashboard-mobile-hero__btn"
            secondaryButtonClassName="business-dashboard-mobile-hero__btn business-dashboard-mobile-hero__btn--secondary"
          />
        </motion.div>

        <div className="business-dashboard-mobile-hero__visual" aria-hidden>
          <div className="business-dashboard-mobile-hero__visual-frame">
            <MarketingPicture
              src={bizzyHeroWebp}
              webpSrc={bizzyHeroWebp}
              avifSrc={bizzyHeroAvif}
              alt=""
              className="business-dashboard-mobile-hero__visual-img"
              sizes="(max-width: 1023px) 100vw, 640px"
              width={640}
              height={480}
              priority
              loading="eager"
              fetchPriority="high"
              fadeIn={false}
              decoding="sync"
            />
          </div>
        </div>
      </div>
    </section>
  );
});
