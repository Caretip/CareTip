import { useTranslation } from "react-i18next";
import { landingUi } from "@/components/landing/landingUi";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingSectionAccent } from "@/components/landing/LandingSectionAccent";
import { AnimatedHeadingLazy } from "@/components/ui/AnimatedHeading.lazy";
import { IndustryShowcase } from "@/components/landing/IndustryShowcase";
import { cn } from "@/lib/utils";

function parseLandingHeadline(raw: string): { text: string; highlight: string[] } {
  const highlight = [...raw.matchAll(/<hl>(.*?)<\/hl>/gi)].map((m) => m[1] ?? "").filter(Boolean);
  const text = raw.replace(/<\/?hl>/gi, "");
  return { text, highlight };
}

/** Matches Navigation + landing section gutters. */
const INDUSTRIES_FRAME =
  "mx-auto w-full min-w-0 max-w-7xl px-4 sm:px-6 lg:px-8";

/**
 * Homepage industries — immersive one-at-a-time showcase (wow moment).
 */
export function LandingIndustriesTeaserSection() {
  const { t } = useTranslation();
  const prefix = "landing.industriesTeaser";
  const { text: overviewHeadline, highlight: overviewHighlight } = parseLandingHeadline(
    t(`${prefix}.overviewHeadline`),
  );

  return (
    <section
      id="industries"
      className={cn(landingUi.sectionWhite, "caretip-industries-teaser scroll-mt-[80px]")}
      aria-labelledby="industries-overview-heading"
    >
      <div className={cn(INDUSTRIES_FRAME, "caretip-industries-teaser__frame")}>
        <LandingReveal>
          <header className="caretip-industries-teaser__overview-header">
            <div className={cn(landingUi.sectionAccentRow, "justify-center lg:justify-center")}>
              <LandingSectionAccent variant="spark" className="mx-auto lg:mx-auto">
                {t(`${prefix}.eyebrow`)}
              </LandingSectionAccent>
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
          <IndustryShowcase className="h-full w-full max-w-full" />
        </LandingReveal>
      </div>
    </section>
  );
}
