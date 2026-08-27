import { memo } from "react";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MarketingPicture } from "@/lib/marketingPicture";
import bizzyHeroWebp from "../../../../images/finalbizzy-hero.webp";
import bizzyHeroAvif from "../../../../images/finalbizzy-hero.avif";
import {
  BusinessHeroPulseMetrics,
  type BusinessHeroOperationalPulse,
} from "./BusinessHeroPulseMetrics";
import { BusinessDashboardHeroActions } from "./BusinessDashboardHeroActions";

type BusinessDashboardMobileHeroProps = {
  welcomeName?: string;
  isPreviewMode: boolean;
  heroPulseLoading: boolean;
  operationalPulse: BusinessHeroOperationalPulse | null;
  isPeriodRefreshing: boolean;
  className?: string;
};

export const BusinessDashboardMobileHero = memo(function BusinessDashboardMobileHero({
  welcomeName,
  isPreviewMode,
  heroPulseLoading,
  operationalPulse,
  isPeriodRefreshing,
  className,
}: BusinessDashboardMobileHeroProps) {
  const { t } = useTranslation();

  return (
    <section
      className={cn("business-dashboard-mobile-hero", className)}
      aria-labelledby="business-mobile-hero-title"
    >
      <div className="business-dashboard-mobile-hero__content">
        <div className="business-dashboard-mobile-hero__badge">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
          <span>
            {welcomeName
              ? t("business.hero.welcomeBackNamed", { name: welcomeName })
              : t("business.hero.welcomeBack")}
          </span>
        </div>

        <h1 id="business-mobile-hero-title" className="business-dashboard-mobile-hero__title">
          {t("business.hero.headlineLine1")}
          <span className="block">{t("business.hero.headlineLine2")}</span>
        </h1>

        <p className="business-dashboard-mobile-hero__description">{t("business.hero.sub")}</p>

        <div className="business-dashboard-mobile-hero__visual" aria-hidden>
          <div className="business-dashboard-mobile-hero__visual-frame">
            <MarketingPicture
              src={bizzyHeroWebp}
              webpSrc={bizzyHeroWebp}
              avifSrc={bizzyHeroAvif}
              alt=""
              className="business-dashboard-mobile-hero__visual-img"
              sizes="(max-width: 640px) 100vw, 320px"
              width={320}
              height={240}
              priority
              loading="eager"
              fetchPriority="high"
              fadeIn={false}
              decoding="sync"
            />
          </div>
        </div>

        <motion.div
          className="business-dashboard-mobile-hero__actions"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <BusinessDashboardHeroActions
            isPreviewMode={isPreviewMode}
            className="business-dashboard-mobile-hero__cta-row"
            buttonClassName="business-dashboard-mobile-hero__btn"
            secondaryButtonClassName="business-dashboard-mobile-hero__btn business-dashboard-mobile-hero__btn--secondary"
          />
        </motion.div>

        <BusinessHeroPulseMetrics
          loading={heroPulseLoading}
          pulse={operationalPulse}
          isRefreshing={isPeriodRefreshing}
          className="business-dashboard-mobile-hero__metrics"
        />
      </div>
    </section>
  );
});
