import { Link } from "react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { LandingHeroAnimatedWord } from "@/components/landing/LandingHeroAnimatedWord";
import { LandingHeroStoryShowcase } from "@/components/landing/LandingHeroStoryShowcase";
import { LandingCopySentences } from "@/components/landing/LandingCopySentences";
import { AnimatedHeading } from "@/components/ui/AnimatedHeading";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export type CareTipLandingHeroProps = {
  id?: string;
  imageAlt: string;
  /** Locale marker for hero shell styling. */
  isDe?: boolean;
  className?: string;
};

/** Full-bleed hospitality hero — crossfading images, dark overlay, layered copy. */
export function CareTipLandingHero({
  id,
  imageAlt,
  isDe = false,
  className,
}: CareTipLandingHeroProps) {
  const { t, i18n } = useTranslation();
  const [activeFrameKey, setActiveFrameKey] = useState("wyc");

  const heroRotatingWords = useMemo(() => {
    const raw = t("landing.showcase.heroRotatingWords", { returnObjects: true });
    if (Array.isArray(raw) && raw.every((w) => typeof w === "string")) {
      return raw as string[];
    }
    const fallback = t("landing.showcase.heroTitleLine2Emphasis");
    return fallback ? [fallback] : [];
  }, [t, i18n.language]);

  const heroDescription = t("landing.showcase.description");
  const heroDescriptionMobile = t("landing.showcase.descriptionMobile");
  const heroHeadline = t("landing.showcase.heroHeadline");
  const heroHeadlineMobile = t("landing.showcase.heroHeadlineMobile");
  const isMobileHeadline = useMediaQuery("(max-width: 767px)");
  const activeHeadline =
    isMobileHeadline && landingCopyVisible(heroHeadlineMobile) ? heroHeadlineMobile : heroHeadline;

  const activeDescription =
    isMobileHeadline && landingCopyVisible(heroDescriptionMobile)
      ? heroDescriptionMobile
      : heroDescription;
  const mobileDescriptionLines =
    isMobileHeadline && activeDescription.includes("\n")
      ? activeDescription
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : null;
  const heroHeadlineHighlight = t("landing.showcase.heroHeadlineHighlight");
  const heroBrandTagline = t("landing.showcase.heroTagline");
  const heroHeadlineHighlightsRaw = t("landing.showcase.heroHeadlineHighlights", {
    returnObjects: true,
  });
  const heroHeadlineHighlights =
    Array.isArray(heroHeadlineHighlightsRaw) &&
    heroHeadlineHighlightsRaw.every((word) => typeof word === "string")
      ? (heroHeadlineHighlightsRaw as string[])
      : heroHeadlineHighlight
        ? [heroHeadlineHighlight]
        : [];
  const useStaticHeadline = landingCopyVisible(heroHeadline);
  const headlineMode = useStaticHeadline ? "static" : "composed";
  const showSupportingCopy = landingCopyVisible(activeDescription);

  return (
    <section
      id={id}
      data-hero-art={isDe ? "de" : "en"}
      className={cn(
        "caretip-hero-section caretip-hero-section--full-bg caretip-hero-section--fullbleed-dark relative isolate w-full min-w-0 overflow-hidden",
        "scroll-mt-[80px]",
        landingUi.heroSectionCinematic,
        className,
      )}
      data-hero-slide={activeFrameKey}
    >
      <div className="caretip-hero-visual-band">
        <div className="caretip-hero-bg-layer" aria-hidden>
          <LandingHeroStoryShowcase
            alt={imageAlt}
            variant="background"
            onActiveFrameChange={setActiveFrameKey}
          />
        </div>
        <div className="caretip-hero-bg-overlay caretip-hero-bg-overlay--dark" aria-hidden />
      </div>

      <div className="caretip-hero-full-bg-inner relative z-[3] w-full">
        <div className="caretip-hero-full-bg-content caretip-hero-copy caretip-hero-copy-block">
          {landingCopyVisible(heroBrandTagline) ? (
            <p className={cn(landingUi.heroTagline, "caretip-hero-split-reveal")} data-hero-brand-tagline="">
              <span className={landingUi.heroTaglineAccent} aria-hidden />
              <span className={landingUi.heroTaglineText}>{heroBrandTagline}</span>
            </p>
          ) : null}

          <h1
            className={cn(
              landingUi.heroHeadline,
              "mt-0 caretip-hero-split-reveal caretip-hero-split-reveal--1",
            )}
            data-hero-headline-mode={headlineMode}
          >
            {useStaticHeadline ? (
              activeHeadline.includes("\n") ? (
                activeHeadline.split("\n").map((line, index) => (
                  <span
                    key={`${index}-${line}`}
                    className={cn(
                      landingUi.heroHeadlineLine,
                      "caretip-hero-headline-line--controlled",
                      index === 0 && "caretip-hero-headline-line--static",
                    )}
                  >
                    <AnimatedHeading
                      text={line}
                      highlight={heroHeadlineHighlights}
                      highlightClassName={landingUi.heroHeadlineEmphasis}
                    />
                  </span>
                ))
              ) : (
                <span
                  className={cn(
                    landingUi.heroHeadlineLine,
                    "caretip-hero-headline-line--static",
                    "caretip-hero-headline-line--controlled",
                  )}
                >
                  <AnimatedHeading
                    text={activeHeadline}
                    highlight={heroHeadlineHighlights}
                    highlightClassName={landingUi.heroHeadlineEmphasis}
                  />
                </span>
              )
            ) : (
              <>
                <span className={landingUi.heroHeadlineLine}>
                  {t("landing.showcase.heroTitlePrefix")}
                  {t("landing.showcase.heroTitleEmphasis") ? (
                    <span className={landingUi.heroHeadlineEmphasis}>
                      {t("landing.showcase.heroTitleEmphasis")}
                    </span>
                  ) : null}
                  {t("landing.showcase.heroTitleSuffix")}
                </span>
                {heroRotatingWords.length > 0 || t("landing.showcase.heroTitleLine2Emphasis") ? (
                  <span className={cn(landingUi.heroHeadlineLine, "caretip-hero-headline-line--rotating")}>
                    <span className="caretip-hero-headline-rotating-stack">
                      {t("landing.showcase.heroTitleLine2Prefix") ? (
                        <span className="caretip-hero-headline-rotating-prefix">
                          {t("landing.showcase.heroTitleLine2Prefix")}
                        </span>
                      ) : null}
                      <span className="caretip-hero-headline-rotating-emphasis-line">
                        <LandingHeroAnimatedWord
                          words={heroRotatingWords}
                          className={landingUi.heroHeadlineEmphasis}
                        />
                      </span>
                      {t("landing.showcase.heroTitleLine2Suffix") ? (
                        <span className="caretip-hero-headline-rotating-suffix">
                          {t("landing.showcase.heroTitleLine2Suffix")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                ) : t("landing.showcase.heroTitleLine2") ? (
                  <span className={landingUi.heroHeadlineLine}>
                    {t("landing.showcase.heroTitleLine2")}
                  </span>
                ) : null}
                {t("landing.showcase.heroTitleLine3") ? (
                  <span className={landingUi.heroHeadlineLine}>
                    {t("landing.showcase.heroTitleLine3")}
                  </span>
                ) : null}
              </>
            )}
          </h1>

          {showSupportingCopy ? (
            mobileDescriptionLines ? (
              <div
                className={cn(
                  landingUi.heroSubtitle,
                  "caretip-hero-subtitle caretip-hero-description-block caretip-hero-description-block--mobile-lines caretip-hero-split-reveal caretip-hero-split-reveal--2",
                )}
              >
                {mobileDescriptionLines.map((line, index) => (
                  <p key={`${index}-${line}`} className="caretip-hero-description-line m-0">
                    {line}
                  </p>
                ))}
              </div>
            ) : (
              <LandingCopySentences
                text={activeDescription}
                layout="paragraphs"
                className={cn(
                  landingUi.heroSubtitle,
                  "caretip-hero-subtitle caretip-hero-description-block caretip-hero-split-reveal caretip-hero-split-reveal--2",
                )}
                sentenceClassName="caretip-hero-description-line m-0"
              />
            )
          ) : null}

          <div
            className={cn(
              landingUi.heroCtaRow,
              "caretip-hero-cta-cluster caretip-hero-split-reveal caretip-hero-split-reveal--3",
            )}
          >
            <div className={landingUi.heroCtaUnit}>
              <Link
                to="/signup"
                className={landingUi.heroCtaPrimary}
                aria-label={t("landing.showcase.primaryCta")}
              >
                {t("landing.showcase.primaryCta")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
