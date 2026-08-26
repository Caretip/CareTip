import { useMemo } from "react";
import { Link } from "react-router";
import { useTranslation, Trans } from "react-i18next";
import { LandingBenefitChecklist } from "@/components/landing/LandingCheckBadge";
import { LandingSectionAccent } from "@/components/landing/LandingSectionAccent";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { landingHeadlineComponents } from "@/components/landing/landingRichText";
import { cn } from "@/lib/utils";
import { LandingMotivationActivityStack } from "./LandingMotivationActivityStack";
import { LandingCopySentences } from "@/components/landing/LandingCopySentences";
import storyPrimary from "../../../../images/story-hero02.webp";
import storySecondary from "../../../../images/FYP.webp";

export function LandingMotivationSection() {
  const { t, i18n } = useTranslation();
  const subtitle = t("landing.motivation.subtitle");
  const points = useMemo(
    () => [t("landing.motivation.point1"), t("landing.motivation.point2"), t("landing.motivation.point3")],
    [t, i18n.language],
  );

  return (
    <section
      id="recognition"
      className={cn(
        landingUi.section,
        landingUi.sectionWhite,
        "caretip-landing-motivation caretip-landing-motivation--story relative scroll-mt-[80px]",
      )}
    >
      <div className="caretip-motivation-ambient" aria-hidden />

      <div className={cn(landingUi.sectionShell, landingUi.splitGrid, "relative")}>
        <div className={cn(landingUi.copyColumn, "lg:order-1")}>
          <div
            className={cn(
              landingUi.copyStack,
              landingUi.mobileStackIntro,
              "caretip-motivation-copy",
            )}
          >
            {landingCopyVisible(t("landing.motivation.pill")) ? (
              <div className={cn(landingUi.sectionAccentRow, "caretip-motivation-accent-row")}>
                <LandingSectionAccent variant="spark">{t("landing.motivation.pill")}</LandingSectionAccent>
              </div>
            ) : null}

            <h2 className={landingUi.headline}>
              <Trans
                i18nKey="landing.motivation.title"
                components={landingHeadlineComponents}
              />
            </h2>

            {landingCopyVisible(subtitle) ? (
              <LandingCopySentences
                text={subtitle}
                layout="paragraphs"
                className={landingUi.subtitle}
                sentenceClassName={cn(landingUi.subtitle, "m-0")}
              />
            ) : null}
          </div>

          <LandingReveal className={cn(landingUi.mobileStackAfter, "caretip-motivation-after w-full")}>
            <LandingBenefitChecklist
              items={points.filter(landingCopyVisible)}
              tone="split"
              className="caretip-motivation-points lg:mx-0"
            />

            <div className={cn(landingUi.sectionCtaCluster, "caretip-motivation-cta")}>
              <div className={landingUi.sectionCtaUnit}>
                <Link to="/contact?intent=demo" className={landingUi.sectionCtaPrimary}>
                  {t("nav.requestDemo")}
                </Link>
              </div>
            </div>
          </LandingReveal>
        </div>

        <LandingReveal
          delay={0.08}
          className={cn(
            landingUi.visualColumn,
            landingUi.mobileStackVisual,
            "caretip-motivation-visual lg:order-2 lg:justify-end",
          )}
        >
          <div className="caretip-motivation-story-gallery">
            <img
              src={storyPrimary}
              alt=""
              className="caretip-motivation-story-gallery__img caretip-motivation-story-gallery__img--primary"
              loading="lazy"
              decoding="async"
            />
            <img
              src={storySecondary}
              alt=""
              className="caretip-motivation-story-gallery__img caretip-motivation-story-gallery__img--secondary"
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="caretip-motivation-activity-wrap">
            <LandingMotivationActivityStack />
          </div>
        </LandingReveal>
      </div>
    </section>
  );
}
