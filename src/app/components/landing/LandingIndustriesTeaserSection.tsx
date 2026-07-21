import { useTranslation, Trans } from "react-i18next";
import {
  BedDouble,
  BriefcaseMedical,
  HeartHandshake,
  Ticket,
  Truck,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { landingUi } from "@/components/landing/landingUi";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingSectionAccent } from "@/components/landing/LandingSectionAccent";
import { landingHeadlineHighlightComponents } from "@/components/landing/landingRichText";
import {
  ALL_INDUSTRY_PAGE_IDS,
  industryPath,
  type IndustryPageId,
} from "@/app/data/industryPages";
import { landingStaggerDelay } from "@/lib/landingMotion";
import { cn } from "@/lib/utils";

const INDUSTRY_ICONS: Record<IndustryPageId, LucideIcon> = {
  gastronomy: UtensilsCrossed,
  hotels: BedDouble,
  logistics: Truck,
  midwives: HeartHandshake,
  fairs: Ticket,
  "field-service": BriefcaseMedical,
};

/**
 * Homepage: compact 6-industry overview grid.
 */
export function LandingIndustriesTeaserSection() {
  const { t } = useTranslation();
  const prefix = "landing.industriesTeaser";

  return (
    <section
      id="industries"
      className={cn(landingUi.sectionWhite, "caretip-industries-teaser scroll-mt-[80px]")}
      aria-labelledby="industries-overview-heading"
    >
      <div className={cn(landingUi.sectionShell, "caretip-industries-teaser__inner px-4 sm:px-6 lg:px-8")}>
        <div className="caretip-industries-teaser__overview">
          <LandingReveal>
            <header className="caretip-industries-teaser__overview-header">
              <div className={cn(landingUi.sectionAccentRow, "justify-center lg:justify-center")}>
                <LandingSectionAccent variant="spark" className="mx-auto lg:mx-auto">
                  {t(`${prefix}.eyebrow`)}
                </LandingSectionAccent>
              </div>
              <h2 id="industries-overview-heading" className={landingUi.sectionTitle}>
                <Trans
                  i18nKey={`${prefix}.overviewHeadline`}
                  components={landingHeadlineHighlightComponents}
                />
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
