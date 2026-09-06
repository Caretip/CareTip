import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { landingUi } from "@/components/landing/landingUi";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingSectionAccent } from "@/components/landing/LandingSectionAccent";
import { parseLandingHeadline } from "@/components/landing/landingRichText";
import { AnimatedHeadingLazy } from "@/components/ui/AnimatedHeading.lazy";
import { IndustryPhotoGrid } from "@/components/landing/IndustryPhotoGrid";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

const INDUSTRIES_FRAME =
  "mx-auto w-full min-w-0 max-w-7xl px-4 sm:px-6 lg:px-8";

/**
 * Homepage industries — TrickyFreshString second-section 3-up teaser + expand.
 */
export function LandingIndustriesTeaserSection() {
  const { t } = useTranslation();
  const prefix = "landing.industriesTeaser";
  const morePanelId = useId();
  const morePanelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!showAll) return;
    const node = morePanelRef.current;
    if (!node) return;
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        node.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "start",
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [showAll, reduceMotion]);

  const { text: overviewHeadline, highlight: overviewHighlight } = parseLandingHeadline(
    t(`${prefix}.overviewHeadline`),
  );

  return (
    <section
      id="industries"
      className={cn(
        landingUi.sectionWhite,
        "caretip-industries-teaser caretip-industries-teaser--photo-grid scroll-mt-[80px]",
      )}
      aria-labelledby="industries-overview-heading"
    >
      <div className={cn(INDUSTRIES_FRAME, "caretip-industries-teaser__frame")}>
        <LandingReveal>
          <header className="caretip-industries-teaser__overview-header">
            <div className="caretip-industries-teaser__overview-top">
              <div className={cn(landingUi.sectionAccentRow, "justify-center lg:justify-center")}>
                <LandingSectionAccent variant="spark" className="mx-auto lg:mx-auto">
                  {t(`${prefix}.eyebrow`)}
                </LandingSectionAccent>
              </div>
            </div>
            <h2 id="industries-overview-heading" className={landingUi.sectionTitle}>
              <AnimatedHeadingLazy
                text={overviewHeadline}
                highlight={overviewHighlight}
                highlightClassName="bg-gradient-to-r from-[#ff9e2d] via-[#e9781c] to-[#d96810] bg-clip-text text-transparent"
              />
            </h2>
            <p className={cn(landingUi.sectionSubtitle, "caretip-industries-teaser__sub")}>
              {t(`${prefix}.overviewSubheadline`)}
            </p>
          </header>
        </LandingReveal>

        <LandingReveal
          className="caretip-industries-teaser__showcase-shell w-full min-w-0"
          delay={0.08}
        >
          <div className="caretip-industry-view-all-nav-slot">
            <button
              type="button"
              className="caretip-industry-view-all-nav"
              aria-expanded={showAll}
              aria-controls={morePanelId}
              onClick={() => setShowAll((open) => !open)}
            >
              {showAll ? t(`${prefix}.showFewerIndustries`) : t(`${prefix}.viewAllIndustries`)}
            </button>
          </div>
          <IndustryPhotoGrid
            showAll={showAll}
            morePanelId={morePanelId}
            morePanelRef={morePanelRef}
          />
        </LandingReveal>
      </div>
    </section>
  );
}
