import { useTranslation } from "react-i18next";
import { ArrowRight, Eye, Rocket, Zap } from "lucide-react";
import newMidWebp from "../../../../images/new-mid.webp";
import newMidAvif from "../../../../images/new-mid.avif";
import handwerkerWebp from "../../../../images/Handwerker.webp";
import handwerkerAvif from "../../../../images/Handwerker.avif";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { landingUi } from "@/components/landing/landingUi";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { industryPath } from "@/app/data/industryPages";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";
import { landingStaggerDelay } from "@/lib/landingMotion";
import { cn } from "@/lib/utils";

const CORE_BENEFITS = [
  { icon: Zap, titleKey: "b1Title", bodyKey: "b1Body" },
  { icon: Eye, titleKey: "b2Title", bodyKey: "b2Body" },
  { icon: Rocket, titleKey: "b3Title", bodyKey: "b3Body" },
] as const;

const TEASERS = [
  {
    id: "midwives" as const,
    image: { webp: newMidWebp, avif: newMidAvif },
    titleKey: "teaser1Title",
    bodyKey: "teaser1Body",
    altKey: "teaser1Alt",
  },
  {
    id: "field-service" as const,
    image: { webp: handwerkerWebp, avif: handwerkerAvif },
    titleKey: "teaser2Title",
    bodyKey: "teaser2Body",
    altKey: "teaser2Alt",
  },
] as const;

/**
 * Homepage teaser — 3 compact benefits + 2 industry cards.
 * Replaces former business/employee benefit splits and real-life target cards.
 */
export function LandingIndustriesTeaserSection() {
  const { t } = useTranslation();
  const prefix = "landing.industriesTeaser";

  return (
    <section
      id="industries-teaser"
      className={cn(landingUi.sectionWhite, "caretip-industries-teaser scroll-mt-[80px]")}
      aria-labelledby="industries-teaser-heading"
    >
      <div className={cn(landingUi.sectionShell, "caretip-industries-teaser__inner px-4 sm:px-6 lg:px-8")}>
        <LandingReveal>
          <header className="caretip-industries-teaser__header">
            <h2 id="industries-teaser-heading" className={landingUi.sectionTitle}>
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
                <h3 className="caretip-industries-teaser__benefit-title">
                  {t(`${prefix}.${benefit.titleKey}`)}
                </h3>
                <p className="caretip-industries-teaser__benefit-body">
                  {t(`${prefix}.${benefit.bodyKey}`)}
                </p>
              </LandingReveal>
            );
          })}
        </ul>

        <p className="caretip-industries-teaser__teasers-label">{t(`${prefix}.teasersLabel`)}</p>

        <ul className="caretip-industries-teaser__cards" aria-label={t(`${prefix}.teasersAria`)}>
          {TEASERS.map((teaser, index) => (
            <LandingReveal
              key={teaser.id}
              as="li"
              className="caretip-industries-teaser__card"
              delay={landingStaggerDelay(index + 1)}
            >
              <div className="caretip-industries-teaser__card-media">
                <picture>
                  <source srcSet={teaser.image.avif} type="image/avif" />
                  <source srcSet={teaser.image.webp} type="image/webp" />
                  <img
                    src={teaser.image.webp}
                    alt={t(`${prefix}.${teaser.altKey}`)}
                    width={640}
                    height={420}
                    loading="lazy"
                    decoding="async"
                    className="caretip-industries-teaser__card-img"
                  />
                </picture>
              </div>
              <div className="caretip-industries-teaser__card-copy">
                <h3 className="caretip-industries-teaser__card-title">
                  {t(`${prefix}.${teaser.titleKey}`)}
                </h3>
                <p className="caretip-industries-teaser__card-body">
                  {t(`${prefix}.${teaser.bodyKey}`)}
                </p>
                <PrefetchLink
                  to={industryPath(teaser.id)}
                  className={cn(
                    publicPagesBrandUi.ctaButtonSecondary,
                    "caretip-industries-teaser__card-cta",
                  )}
                >
                  {t(`${prefix}.learnMore`)}
                  <ArrowRight className="size-4" strokeWidth={2} aria-hidden />
                </PrefetchLink>
              </div>
            </LandingReveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
