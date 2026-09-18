import type { ReactNode } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Link } from "react-router";
import { RequestDemoCta } from "@/app/components/RequestDemoCta";
import { LandingParallaxWrap } from "@/components/landing/LandingParallaxWrap";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { landingStaggerDelay } from "@/lib/landingMotion";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { LandingBenefitBlock } from "@/components/landing/LandingCheckBadge";
import {
  LandingSectionAccent,
  type LandingAccentVariant,
} from "@/components/landing/LandingSectionAccent";
import { MarketingPicture } from "@/lib/marketingPicture";
import { cn } from "@/lib/utils";

export type LandingShowcaseBenefit = {
  title: string;
  description: string;
};

export type LandingSplitShowcaseSectionProps = {
  id: string;
  visualPosition: "left" | "right";
  tone?: "warm" | "muted";
  eyebrow: string;
  eyebrowVariant?: LandingAccentVariant;
  titleLine1: string;
  titleLine2?: string;
  subtitle: string;
  benefits: LandingShowcaseBenefit[];
  benefitsVariant?: "split" | "showcase";
  cta?: { label: string; to: string; icon?: ReactNode };
  visual: ReactNode;
  benefitsAriaLabel?: string;
};

function isDemoIntentPath(to: string): boolean {
  return to.includes("intent=demo");
}

export function LandingSplitShowcaseSection({
  id,
  visualPosition,
  tone = "warm",
  eyebrow,
  eyebrowVariant = "trend",
  titleLine1,
  titleLine2,
  subtitle,
  benefits,
  benefitsVariant = "showcase",
  cta,
  visual,
  benefitsAriaLabel,
}: LandingSplitShowcaseSectionProps) {
  const visualLgOrder = visualPosition === "left" ? "lg:order-1" : "lg:order-2";
  const copyLgOrder = visualPosition === "left" ? "lg:order-2" : "lg:order-1";
  const visualDelay = landingStaggerDelay(0);
  const copyDelay = landingStaggerDelay(1);

  return (
    <section
      id={id}
      data-landing-tone={tone}
      className={cn(
        landingUi.showcaseSection,
        tone === "muted" ? landingUi.showcaseSectionToneMuted : landingUi.showcaseSectionToneWarm,
      )}
    >
      <div className={cn(landingUi.showcaseGrid, landingUi.sectionShell)}>
        <LandingReveal
          data-polish-view
          delay={visualDelay}
          className={cn(landingUi.showcaseVisualCol, landingUi.mobileStackVisual, visualLgOrder)}
        >
          <LandingParallaxWrap className="relative w-full">{visual}</LandingParallaxWrap>
        </LandingReveal>

        <div className={cn(landingUi.copyColumn, "lg:flex lg:flex-col", copyLgOrder)}>
          <div className={landingUi.showcaseIntro}>
            <LandingSectionAccent variant={eyebrowVariant}>{eyebrow}</LandingSectionAccent>
            <h2 className={landingUi.showcaseHeadline}>
              <span className="block text-foreground">{titleLine1}</span>
              {titleLine2 ? (
                <span className={landingUi.showcaseHeadlineAccent}>{titleLine2}</span>
              ) : null}
            </h2>
            {landingCopyVisible(subtitle) ? (
              <p className={landingUi.showcaseSubtitle}>{subtitle}</p>
            ) : null}
          </div>

          <LandingReveal
            delay={copyDelay}
            className={cn(
              landingUi.showcaseActionCluster,
              landingUi.mobileStackAfter,
              "max-lg:caretip-split-showcase-content-panel max-lg:caretip-split-showcase-content-panel--mobile",
            )}
          >
            <div
              className={cn(
                landingUi.showcaseBenefits,
                benefitsVariant === "showcase" && landingUi.showcaseBenefitsPanel,
              )}
              role="list"
              aria-label={benefitsAriaLabel}
            >
              {benefits.map((item) => (
                <LandingBenefitBlock
                  key={item.title}
                  variant={benefitsVariant}
                  title={item.title}
                  description={item.description}
                />
              ))}
            </div>

            {cta ? (
              <div className={landingUi.sectionCtaCluster}>
                <div className={landingUi.sectionCtaUnit}>
                  {isDemoIntentPath(cta.to) ? (
                    <RequestDemoCta className={landingUi.sectionCtaPrimary}>{cta.label}</RequestDemoCta>
                  ) : (
                    <Link
                      to={cta.to}
                      className={
                        cta.to === "/join" ? landingUi.sectionCtaSecondary : landingUi.sectionCtaPrimary
                      }
                    >
                      {cta.label}
                    </Link>
                  )}
                </div>
              </div>
            ) : null}
          </LandingReveal>
        </div>
      </div>
    </section>
  );
}

export function LandingShowcaseVisualFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("caretip-showcase-depth relative w-full", className)}>
      <div aria-hidden className={landingUi.showcaseVisualGlow} />
      {children}
    </div>
  );
}

export function LandingShowcaseCoverImage({
  src,
  webpSrc,
  avifSrc,
  alt,
  objectPosition = "center",
  className,
  floatHint,
  priority = false,
}: {
  src: string;
  webpSrc?: string;
  avifSrc?: string;
  alt: string;
  objectPosition?: string;
  className?: string;
  floatHint?: string;
  priority?: boolean;
}) {
  return (
    <LandingShowcaseVisualFrame>
      <div className={landingUi.showcaseVisualFrame}>
        <MarketingPicture
          src={webpSrc ?? src}
          webpSrc={webpSrc ?? src}
          avifSrc={avifSrc}
          alt={alt}
          className={cn(landingUi.showcaseVisualImg, className)}
          style={{ objectPosition }}
          priority={priority}
          decoding="async"
        />
      </div>
      {floatHint ? (
        <div aria-hidden className="caretip-showcase-float-card hidden lg:block">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {floatHint}
          </p>
        </div>
      ) : null}
    </LandingShowcaseVisualFrame>
  );
}
