import { useTranslation } from "react-i18next";
import {
  BedDouble,
  BriefcaseMedical,
  Eye,
  HeartHandshake,
  Rocket,
  Ticket,
  Truck,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { landingUi } from "@/components/landing/landingUi";
import { LandingReveal } from "@/components/landing/LandingReveal";
import {
  ALL_INDUSTRY_PAGE_IDS,
  industryPath,
  type IndustryPageId,
} from "@/app/data/industryPages";
import { landingStaggerDelay } from "@/lib/landingMotion";
import { cn } from "@/lib/utils";

const CORE_BENEFITS = [
  { icon: Zap, titleKey: "b1Title", bodyKey: "b1Body" },
  { icon: Eye, titleKey: "b2Title", bodyKey: "b2Body" },
  { icon: Rocket, titleKey: "b3Title", bodyKey: "b3Body" },
] as const;

const INDUSTRY_ICONS: Record<IndustryPageId, LucideIcon> = {
  gastronomy: UtensilsCrossed,
  hotels: BedDouble,
  logistics: Truck,
  midwives: HeartHandshake,
  fairs: Ticket,
  "field-service": BriefcaseMedical,
};

/**
 * Homepage: level-up benefits, then compact 6-industry overview grid.
 */
export function LandingIndustriesTeaserSection() {
  const { t } = useTranslation();
  const prefix = "landing.industriesTeaser";

  return (
    <section
      id="industries"
      className={cn(landingUi.sectionWhite, "caretip-industries-teaser scroll-mt-[80px]")}
      aria-labelledby="industries-levelup-heading"
    >
      <div className={cn(landingUi.sectionShell, "caretip-industries-teaser__inner px-4 sm:px-6 lg:px-8")}>
        <LandingReveal>
          <header className={cn(landingUi.sectionIntro, "caretip-industries-teaser__header mb-0")}>
            <h2 id="industries-levelup-heading" className={landingUi.sectionTitle}>
              {t(`${prefix}.headline`)}
            </h2>
            <p className={cn(landingUi.sectionSubtitle, "caretip-industries-teaser__sub")}>
              {t(`${prefix}.subheadline`)}
            </p>
          </header>
        </LandingReveal>

        <ul className="caretip-industries-teaser__benefits" aria-label={t(`${prefix}.benefitsAria`)}>
          {CORE_BENEFITS.map((benefit, index) => {
            const Icon = benefit.icon;
            return (
              <LandingReveal
                key={benefit.titleKey}
                as="li"
                className="caretip-industries-teaser__benefit"
                delay={landingStaggerDelay(index + 1)}
              >
                <span className="caretip-industries-teaser__benefit-icon" aria-hidden>
                  <Icon strokeWidth={1.75} />
                </span>
                <div className="caretip-industries-teaser__benefit-copy">
                  <h3 className="caretip-industries-teaser__benefit-title">
                    {t(`${prefix}.${benefit.titleKey}`)}
                  </h3>
                  <p className="caretip-industries-teaser__benefit-body">
                    {t(`${prefix}.${benefit.bodyKey}`)}
                  </p>
                </div>
              </LandingReveal>
            );
          })}
        </ul>

        <div className="caretip-industries-teaser__overview">
          <LandingReveal>
            <header className="caretip-industries-teaser__overview-header">
              <p
                data-landing-accent
                className="caretip-industries-teaser__eyebrow"
              >
                {t(`${prefix}.eyebrow`)}
              </p>
              <h2 id="industries-overview-heading" className={landingUi.sectionTitle}>
                {t(`${prefix}.overviewHeadline`)}
              </h2>
              <p className={cn(landingUi.sectionSubtitle, "caretip-industries-teaser__sub")}>
                {t(`${prefix}.overviewSubheadline`)}
              </p>
            </header>
          </LandingReveal>

          <ul className="caretip-industries-teaser__cards" aria-label={t(`${prefix}.teasersAria`)}>
            {ALL_INDUSTRY_PAGE_IDS.map((id, index) => {
              const Icon = INDUSTRY_ICONS[id];
              return (
                <LandingReveal
                  key={id}
                  as="li"
                  className="caretip-industries-teaser__card"
                  delay={landingStaggerDelay(index + 1)}
                >
                  <PrefetchLink
                    to={industryPath(id)}
                    className="caretip-industries-teaser__card-link"
                  >
                    <span className="caretip-industries-teaser__card-icon" aria-hidden>
                      <Icon strokeWidth={1.75} />
                    </span>
                    <h3 className="caretip-industries-teaser__card-title">
                      {t(`${prefix}.cards.${id}.title`)}
                    </h3>
                    <p className="caretip-industries-teaser__card-body">
                      {t(`${prefix}.cards.${id}.body`)}
                    </p>
                    <span className="caretip-industries-teaser__card-cta">
                      {t(`${prefix}.learnMore`)}
                    </span>
                  </PrefetchLink>
                </LandingReveal>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
