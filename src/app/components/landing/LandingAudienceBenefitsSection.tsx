import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  LayoutDashboard,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingSectionAccent } from "@/components/landing/LandingSectionAccent";
import { landingUi } from "@/components/landing/landingUi";
import { landingStaggerDelay } from "@/lib/landingMotion";
import { cn } from "@/lib/utils";

type AudienceCard = {
  id: "business" | "teams";
  Icon: LucideIcon;
  roleKey: string;
  titleKey: string;
  bodyKey: string;
  points: Array<{ titleKey: string; bodyKey: string }>;
  ctaLabelKey: string;
  ctaTo: string;
};

const CARDS: AudienceCard[] = [
  {
    id: "business",
    Icon: LayoutDashboard,
    roleKey: "businessRole",
    titleKey: "businessTitle",
    bodyKey: "businessBody",
    points: [
      { titleKey: "businessP1Title", bodyKey: "businessP1Body" },
      { titleKey: "businessP2Title", bodyKey: "businessP2Body" },
      { titleKey: "businessP3Title", bodyKey: "businessP3Body" },
    ],
    ctaLabelKey: "businessCta",
    ctaTo: "/contact?intent=demo",
  },
  {
    id: "teams",
    Icon: Smartphone,
    roleKey: "teamsRole",
    titleKey: "teamsTitle",
    bodyKey: "teamsBody",
    points: [
      { titleKey: "teamsP1Title", bodyKey: "teamsP1Body" },
      { titleKey: "teamsP2Title", bodyKey: "teamsP2Body" },
      { titleKey: "teamsP3Title", bodyKey: "teamsP3Body" },
    ],
    ctaLabelKey: "teamsCta",
    ctaTo: "/join",
  },
];

/**
 * Combined business + employee landing block — side-by-side audience cards
 * (template: Benefits at a glance).
 */
export function LandingAudienceBenefitsSection() {
  const { t, i18n } = useTranslation();
  const prefix = "landing.audienceBenefits";

  const cards = useMemo(
    () =>
      CARDS.map((card) => ({
        ...card,
        role: t(`${prefix}.${card.roleKey}`),
        title: t(`${prefix}.${card.titleKey}`),
        body: t(`${prefix}.${card.bodyKey}`),
        points: card.points.map((p) => ({
          title: t(`${prefix}.${p.titleKey}`),
          body: t(`${prefix}.${p.bodyKey}`),
        })),
        ctaLabel: t(`${prefix}.${card.ctaLabelKey}`),
      })),
    [t, i18n.language],
  );

  return (
    <section
      id="business-section"
      className={cn(landingUi.sectionWhite, "caretip-audience-benefits scroll-mt-[80px]")}
      aria-labelledby="audience-benefits-heading"
    >
      <div className={cn(landingUi.sectionShell, "caretip-audience-benefits__inner px-4 sm:px-6 lg:px-8")}>
        <LandingReveal>
          <header className={cn(landingUi.sectionIntro, "caretip-audience-benefits__header mb-0")}>
            <div className={cn(landingUi.sectionAccentRow, "justify-center lg:justify-center")}>
              <LandingSectionAccent variant="spark" className="mx-auto lg:mx-auto">
                {t(`${prefix}.eyebrow`)}
              </LandingSectionAccent>
            </div>
            <h2 id="audience-benefits-heading" className={landingUi.sectionTitle}>
              {t(`${prefix}.headline`)}
            </h2>
          </header>
        </LandingReveal>

        <div className="caretip-audience-benefits__grid">
          {cards.map((card, index) => {
            const Icon = card.Icon;
            return (
              <LandingReveal
                key={card.id}
                className="caretip-audience-benefits__card"
                delay={landingStaggerDelay(index + 1)}
              >
                <p className="caretip-audience-benefits__role">{card.role}</p>
                <span className="caretip-audience-benefits__icon" aria-hidden>
                  <Icon strokeWidth={1.75} />
                </span>
                <h3 className="caretip-audience-benefits__title">{card.title}</h3>
                <p className="caretip-audience-benefits__body">{card.body}</p>
                <ul className="caretip-audience-benefits__points">
                  {card.points.map((point) => (
                    <li key={point.title} className="caretip-audience-benefits__point">
                      <span className="caretip-audience-benefits__check caretip-feature-check" aria-hidden>
                        <Check strokeWidth={2.75} />
                      </span>
                      <div className="caretip-audience-benefits__point-copy">
                        <p className="caretip-audience-benefits__point-title">{point.title}</p>
                        <p className="caretip-audience-benefits__point-body">{point.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <PrefetchLink
                  to={card.ctaTo}
                  className={cn(
                    card.id === "business" ? landingUi.cta : landingUi.sectionCtaSecondary,
                    "caretip-audience-benefits__cta caretip-section-cta-button",
                  )}
                >
                  {card.ctaLabel}
                </PrefetchLink>
              </LandingReveal>
            );
          })}
        </div>
      </div>
      {/* Keep employee hash working for existing deep links */}
      <div id="for-employees" className="sr-only" aria-hidden />
    </section>
  );
}
