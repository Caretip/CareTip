import { Link } from "react-router";
import { Shield, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import "@/styles/bundles/marketing-pages.css";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { HowItWorksPageHero } from "@/components/public/howItWorks/HowItWorksPageHero";
import { HowItWorksStepContent } from "@/components/public/HowItWorksStepContent";
import { HOW_IT_WORKS_STEPS } from "@/components/public/howItWorksFlow";
import { HowItWorksTimelineStep } from "@/components/public/HowItWorksTimelineStep";
import { howItWorksPageUi } from "@/components/public/howItWorksPageUi";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";
import { publicPageUi } from "@/components/public/publicPageUi";
import { cn } from "@/lib/utils";

export function HowItWorksPage() {
  const { t } = useTranslation();

  return (
    <PublicPageShell maxWidth="wide" className="bg-background">
      <main
        id="how-it-works"
        className={howItWorksPageUi.page}
        aria-label={t("nav.howItWorks")}
      >
      <HowItWorksPageHero className={howItWorksPageUi.hero} />

      <div className={howItWorksPageUi.timeline}>
        {HOW_IT_WORKS_STEPS.map((def, index) => (
          <HowItWorksTimelineStep
            key={def.step}
            step={def.step}
            badge={t("staticPages.howItWorks.stepBadge", { n: def.step })}
            title={t(`staticPages.howItWorks.s${def.step}Title`)}
            icon={def.icon}
            visual={def.visual}
            reverse={def.reverse}
            isFirst={index === 0}
            isLast={index === HOW_IT_WORKS_STEPS.length - 1}
          >
            <HowItWorksStepContent step={def.step} extras={def.extras} />
          </HowItWorksTimelineStep>
        ))}
      </div>

      <section
        className={cn(
          publicPageUi.sectionGap,
          "caretip-how-trust-section border-t border-border/80 pt-10 sm:pt-12",
        )}
      >
        <h2
          className={cn(
            publicPageUi.sectionTitle,
            "caretip-public-marketing-section-title mb-6 text-center sm:mb-8",
          )}
        >
          {t("staticPages.howItWorks.trustTitle")}
        </h2>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
          <div className={cn(publicPageUi.card, publicPageUi.cardPad, publicPagesBrandUi.warmDarkCard)}>
            <div className={cn("mb-4", publicPagesBrandUi.warmDarkCardIcon)}>
              <Shield className="h-5 w-5" aria-hidden />
            </div>
            <h3 className={cn("mb-2 text-lg font-semibold", publicPagesBrandUi.warmDarkCardTitle)}>
              {t("staticPages.howItWorks.trust1Title")}
            </h3>
            <p className={cn("text-sm leading-relaxed", publicPagesBrandUi.warmDarkCardBody)}>
              {t("staticPages.howItWorks.trust1Body")}
            </p>
          </div>

          <div className={cn(publicPageUi.card, publicPageUi.cardPad)}>
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <Zap className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">
              {t("staticPages.howItWorks.trust2Title")}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("staticPages.howItWorks.trust2Body")}
            </p>
          </div>
        </div>
      </section>

      <section className={cn(publicPageUi.sectionGap, "pb-4 sm:pb-6")}>
        <div className={publicPagesBrandUi.warmDarkCta}>
          <h3 className={publicPagesBrandUi.warmDarkCtaTitle}>{t("staticPages.howItWorks.ctaTitle")}</h3>
          <p className={publicPagesBrandUi.warmDarkCtaBody}>{t("staticPages.howItWorks.ctaBody")}</p>
          <div className={publicPagesBrandUi.warmDarkCtaActions}>
            <Link to="/contact?intent=demo" className={publicPagesBrandUi.ctaButtonPrimary}>
              {t("nav.requestDemo")}
            </Link>
            <Link to="/pricing" className={publicPagesBrandUi.ctaButtonSecondary}>
              {t("staticPages.howItWorks.ctaPricing")}
            </Link>
          </div>
        </div>
      </section>
      </main>
    </PublicPageShell>
  );
}
