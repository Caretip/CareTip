import { useMemo } from "react";
import { useTranslation, Trans } from "react-i18next";
import { LandingBenefitChecklist } from "@/components/landing/LandingCheckBadge";
import { LandingSectionAccent } from "@/components/landing/LandingSectionAccent";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { landingHeadlineComponents } from "@/components/landing/landingRichText";
import { cn } from "@/lib/utils";
import { LandingMotivationActivityStack } from "./LandingMotivationActivityStack";
import { LandingCopySentences } from "@/components/landing/LandingCopySentences";
import { RequestDemoCta } from "@/app/components/RequestDemoCta";
import aminaWebp from "../../../../images/amina.webp";
import aminaAvif from "../../../../images/amina.avif";

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
                <RequestDemoCta className={landingUi.sectionCtaPrimary}>
                  {t("nav.requestDemo")}
                </RequestDemoCta>
              </div>
            </div>
          </LandingReveal>
        </div>

        <LandingReveal
          delay={0.08}
          className={cn(
            landingUi.visualColumn,
            landingUi.mobileStackVisual,
            "caretip-motivation-visual lg:order-2 lg:justify-start",
          )}
        >
          <div className="caretip-motivation-story-gallery caretip-motivation-story-gallery--single">
            <picture>
              <source type="image/avif" srcSet={aminaAvif} />
              <source type="image/webp" srcSet={aminaWebp} />
              <img
                src={aminaWebp}
                alt=""
                className="caretip-motivation-story-gallery__img caretip-motivation-story-gallery__img--primary"
                loading="lazy"
                decoding="async"
                onError={(event) => {
                  const img = event.currentTarget;
                  const picture = img.parentElement;
                  if (picture?.tagName === "PICTURE") {
                    picture
                      .querySelectorAll('source[type="image/avif"]')
                      .forEach((source) => source.remove());
                  }
                  if (img.getAttribute("src") !== aminaWebp) {
                    img.src = aminaWebp;
                  }
                }}
              />
            </picture>
            <p className="caretip-motivation-story-gallery__snippet">
              {t("landing.industriesTeaser.snippets.tipsToday")}
            </p>
          </div>
          <div className="caretip-motivation-activity-wrap">
            <LandingMotivationActivityStack />
          </div>
        </LandingReveal>
      </div>
    </section>
  );
}
