import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Check, LayoutDashboard, Smartphone } from "lucide-react";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { RequestDemoCta } from "@/app/components/RequestDemoCta";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingSectionAccent } from "@/components/landing/LandingSectionAccent";
import { LandingCopySentences } from "@/components/landing/LandingCopySentences";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { landingHeadlineComponents } from "@/components/landing/landingRichText";
import { landingStaggerDelay } from "@/lib/landingMotion";
import { cn } from "@/lib/utils";
import { LandingDashboardShowcaseVisual } from "./dashboardShowcase/LandingDashboardShowcaseVisual";
import teamsVisual from "../../../../images/new-imo.webp";
import teamsVisualAvif from "../../../../images/new-imo.avif";

type BenefitPoint = { title: string; body: string };

type AudienceCardConfig = {
  id?: string;
  icon: ReactNode;
  role: string;
  title: string;
  body: string;
  points: BenefitPoint[];
  cta: ReactNode;
  image?: string;
  imageAvif?: string;
  imageAlt?: string;
  photoClass?: string;
  cardVisual?: ReactNode;
};

function BenefitPointsList({ points, className }: { points: BenefitPoint[]; className?: string }) {
  return (
    <ul className={cn("caretip-audience-benefits__points", className)}>
      {points.map((point) => (
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
  );
}

function warmTeamsPhoneImage(): void {
  if (typeof window === "undefined") return;
  const img = new Image();
  img.decoding = "async";
  img.setAttribute("fetchpriority", "low");
  img.src = teamsVisualAvif;
}

if (typeof window !== "undefined") {
  warmTeamsPhoneImage();
}

/**
 * Combined audience benefits: section intro + two flat columns (visual + copy on surface).
 */
export function LandingAudienceBenefitsSection() {
  const { t, i18n } = useTranslation();
  const prefix = "landing.audienceBenefits";
  const subtitle = t(`${prefix}.subtitle`);
  const dashboardVisualRef = useRef<HTMLDivElement>(null);
  const phoneVisualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dashboard = dashboardVisualRef.current;
    const phone = phoneVisualRef.current;
    if (!dashboard || !phone) return;

    const mq = window.matchMedia("(min-width: 1024px)");

    const syncPhoneVisualHeight = () => {
      if (!mq.matches) {
        phone.style.height = "";
        return;
      }
      const height = Math.round(dashboard.getBoundingClientRect().height);
      if (height > 0) {
        phone.style.height = `${height}px`;
      }
    };

    const observer = new ResizeObserver(syncPhoneVisualHeight);
    observer.observe(dashboard);
    mq.addEventListener("change", syncPhoneVisualHeight);
    window.addEventListener("resize", syncPhoneVisualHeight);
    syncPhoneVisualHeight();

    return () => {
      observer.disconnect();
      mq.removeEventListener("change", syncPhoneVisualHeight);
      window.removeEventListener("resize", syncPhoneVisualHeight);
      phone.style.height = "";
    };
  }, [i18n.language]);

  const cards = useMemo((): AudienceCardConfig[] => {
    const businessPoints = [
      { title: t(`${prefix}.businessP1Title`), body: t(`${prefix}.businessP1Body`) },
      { title: t(`${prefix}.businessP2Title`), body: t(`${prefix}.businessP2Body`) },
      { title: t(`${prefix}.businessP3Title`), body: t(`${prefix}.businessP3Body`) },
    ];
    const teamsPoints = [
      { title: t(`${prefix}.teamsP1Title`), body: t(`${prefix}.teamsP1Body`) },
      { title: t(`${prefix}.teamsP2Title`), body: t(`${prefix}.teamsP2Body`) },
      { title: t(`${prefix}.teamsP3Title`), body: t(`${prefix}.teamsP3Body`) },
    ];

    return [
      {
        icon: <LayoutDashboard aria-hidden />,
        role: t(`${prefix}.businessRole`),
        title: t(`${prefix}.businessTitle`),
        body: t(`${prefix}.businessBody`),
        points: businessPoints,
        photoClass: "caretip-audience-benefits__visual--dashboard",
        cardVisual: (
          <LandingDashboardShowcaseVisual
            variant="premium"
            employeeLimit={7}
            showCaption={false}
            embeddedInCard
          />
        ),
        cta: (
          <div className={cn(landingUi.sectionCtaCluster, "caretip-audience-benefits__cta-cluster")}>
            <div className={landingUi.sectionCtaUnit}>
              <RequestDemoCta className={landingUi.sectionCtaPrimary}>
                {t(`${prefix}.businessCta`)}
              </RequestDemoCta>
            </div>
          </div>
        ),
      },
      {
        id: "for-employees",
        icon: <Smartphone aria-hidden />,
        role: t(`${prefix}.teamsRole`),
        title: t(`${prefix}.teamsTitle`),
        body: t(`${prefix}.teamsBody`),
        points: teamsPoints,
        image: teamsVisual,
        imageAvif: teamsVisualAvif,
        imageAlt: t("landing.employeeSection.imageAlt"),
        photoClass: "caretip-audience-benefits__visual--phone",
        cta: (
          <div className={cn(landingUi.sectionCtaCluster, "caretip-audience-benefits__cta-cluster")}>
            <div className={landingUi.sectionCtaUnit}>
              <PrefetchLink to="/join" className={landingUi.sectionCtaSecondary}>
                {t(`${prefix}.teamsCta`)}
              </PrefetchLink>
            </div>
          </div>
        ),
      },
    ];
  }, [t, i18n.language]);

  return (
    <section
      id="business-section"
      className={cn(
        landingUi.sectionWhite,
        "caretip-audience-benefits scroll-mt-[80px]",
      )}
      aria-labelledby="audience-benefits-heading"
    >
      <div className={cn(landingUi.sectionShell, "caretip-audience-benefits__inner px-4 sm:px-6 lg:px-8")}>
        <LandingReveal>
          <header
            className={cn(
              landingUi.sectionIntro,
              "caretip-audience-benefits__header mb-0",
            )}
          >
            <div className={cn(landingUi.sectionAccentRow, "justify-center")}>
              <LandingSectionAccent variant="spark" className="mx-auto">
                {t(`${prefix}.eyebrow`)}
              </LandingSectionAccent>
            </div>
            <h2
              id="audience-benefits-heading"
              className={cn(landingUi.sectionTitle, "caretip-audience-benefits__headline")}
            >
              <Trans i18nKey={`${prefix}.headline`} components={landingHeadlineComponents} />
            </h2>
            {landingCopyVisible(t(`${prefix}.subheadline`)) ? (
              <p
                className={cn(
                  landingUi.subtitle,
                  "caretip-audience-benefits__subheadline mx-auto max-w-3xl font-semibold text-foreground",
                )}
              >
                <Trans i18nKey={`${prefix}.subheadline`} components={landingHeadlineComponents} />
              </p>
            ) : null}
            {landingCopyVisible(subtitle) ? (
              <LandingCopySentences
                text={subtitle}
                className={cn(landingUi.subtitle, "caretip-audience-benefits__subtitle mx-auto max-w-2xl")}
                sentenceClassName={cn(landingUi.subtitle, "m-0")}
              />
            ) : null}
          </header>
        </LandingReveal>

        <div className="caretip-audience-benefits__grid mt-8 sm:mt-10 lg:mt-11">
          {cards.map((card, index) => (
            <LandingReveal
              key={card.role}
              delay={landingStaggerDelay(index + 1)}
              className="caretip-audience-benefits__column"
              {...(card.id ? { id: card.id } : {})}
            >
              {card.cardVisual ? (
                <div
                  ref={dashboardVisualRef}
                  className={cn(
                    "caretip-audience-benefits__visual",
                    "caretip-audience-benefits__visual--matched",
                    card.photoClass,
                  )}
                  id={index === 0 ? "dashboard-showcase" : undefined}
                >
                  {card.cardVisual}
                </div>
              ) : card.image ? (
                <div
                  ref={phoneVisualRef}
                  className={cn(
                    "caretip-audience-benefits__visual",
                    "caretip-audience-benefits__visual--matched",
                    card.photoClass,
                  )}
                >
                  <picture>
                    {card.imageAvif ? <source type="image/avif" srcSet={card.imageAvif} /> : null}
                    <img
                      src={card.image}
                      alt={card.imageAlt ?? ""}
                      loading="lazy"
                      decoding="async"
                      sizes="(min-width: 1024px) 32rem, 100vw"
                      width={854}
                      height={1280}
                      onError={(event) => {
                        const img = event.currentTarget;
                        const picture = img.parentElement;
                        if (picture?.tagName === "PICTURE") {
                          picture
                            .querySelectorAll('source[type="image/avif"]')
                            .forEach((source) => source.remove());
                        }
                        if (card.image && img.getAttribute("src") !== card.image) {
                          img.src = card.image;
                        }
                      }}
                    />
                  </picture>
                </div>
              ) : null}

              <div className="caretip-audience-benefits__copy">
                <p className="caretip-audience-benefits__role">{card.role}</p>
                <div className="caretip-audience-benefits__icon">{card.icon}</div>
                <h3 className="caretip-audience-benefits__title">{card.title}</h3>
                <p className="caretip-audience-benefits__body">{card.body}</p>
                <BenefitPointsList points={card.points} />
                {card.cta}
              </div>
            </LandingReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
