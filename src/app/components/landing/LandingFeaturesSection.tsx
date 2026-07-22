import { useMemo } from "react";
import { QrCode, Activity, BarChart3, History, Wallet, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { landingStaggerDelay } from "@/lib/landingMotion";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { landingType } from "@/components/landing/landingTypography";
import {
  LandingSectionAccent,
  type LandingAccentVariant,
} from "@/components/landing/LandingSectionAccent";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { AnimatedHeadingLazy } from "@/components/ui/AnimatedHeading.lazy";
import { cn } from "@/lib/utils";

const cardClassName = cn(
  "caretip-landing-card caretip-landing-feature-card group relative flex h-full flex-col overflow-hidden rounded-2xl",
  "border border-border/80 bg-card/95",
);

const iconWrapBaseClassName = cn(
  "caretip-landing-feature-icon mb-3 shrink-0 sm:mb-5",
  "transition-[background,box-shadow,border-color] duration-300 ease-out",
);

const iconGlyphClassName = "caretip-landing-feature-icon__glyph--obsidian";

const featureAccentVariants: LandingAccentVariant[] = [
  "spark",
  "trend",
  "arrow",
  "line",
  "spark",
  "trend",
];

export function LandingFeaturesSection() {
  const { t, i18n } = useTranslation();
  const sectionSubtitle = t("landing.features.subtitle");
  const rawTitle = t("landing.features.title");
  const featuresHighlight = [...rawTitle.matchAll(/<hl>(.*?)<\/hl>/gi)]
    .map((m) => m[1] ?? "")
    .filter(Boolean);
  const featuresTitle = rawTitle.replace(/<\/?hl>/gi, "");

  const items = useMemo(
    () =>
      [
        {
          icon: QrCode,
          title: t("landing.features.i1Title"),
          text: t("landing.features.i1Text"),
          tag: t("landing.features.i1Tag"),
        },
        {
          icon: Activity,
          title: t("landing.features.i2Title"),
          text: t("landing.features.i2Text"),
          tag: t("landing.features.i2Tag"),
        },
        {
          icon: BarChart3,
          title: t("landing.features.i3Title"),
          text: t("landing.features.i3Text"),
          tag: t("landing.features.i3Tag"),
        },
        {
          icon: History,
          title: t("landing.features.i4Title"),
          text: t("landing.features.i4Text"),
          tag: t("landing.features.i4Tag"),
        },
        {
          icon: Wallet,
          title: t("landing.features.i5Title"),
          text: t("landing.features.i5Text"),
          tag: t("landing.features.i5Tag"),
        },
        {
          icon: Star,
          title: t("landing.features.i6Title"),
          text: t("landing.features.i6Text"),
          tag: t("landing.features.i6Tag"),
        },
      ],
    [t, i18n.language],
  );

  return (
    <section
      id="features"
      className={cn(
        landingUi.section,
        landingUi.landingSurface,
        "caretip-landing-features-section relative overflow-hidden dark:bg-neutral-950",
      )}
    >
      <div className="relative mx-auto max-w-7xl">
        <svg aria-hidden className="pointer-events-none absolute h-0 w-0 overflow-hidden">
          <defs>
            <linearGradient id="caretip-features-icon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FCC842" />
              <stop offset="42%" stopColor="#EF8728" />
              <stop offset="100%" stopColor="#171717" />
            </linearGradient>
            <linearGradient id="caretip-features-icon-gradient-dark" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FCD34D" />
              <stop offset="40%" stopColor="#F6AB2A" />
              <stop offset="100%" stopColor="#0a0a0a" />
            </linearGradient>
          </defs>
        </svg>
        <div className={landingUi.sectionIntro}>
          {landingCopyVisible(t("landing.features.eyebrow")) ? (
            <div className={landingUi.sectionAccentRow}>
              <LandingSectionAccent variant="spark">{t("landing.features.eyebrow")}</LandingSectionAccent>
            </div>
          ) : null}
          <h2 className={cn(landingUi.sectionTitle, "caretip-landing-scroll-reveal--visible")}>
            <AnimatedHeadingLazy
              text={featuresTitle}
              highlight={featuresHighlight}
              highlightClassName="bg-gradient-to-r from-[#EB992C] via-[#E89124] to-[#D88118] bg-clip-text text-transparent"
            />
          </h2>
          {landingCopyVisible(sectionSubtitle) ? (
            <p className={cn(landingUi.sectionSubtitle, "caretip-landing-scroll-reveal--visible")}>
              {sectionSubtitle}
            </p>
          ) : null}
        </div>

        <ul className="caretip-landing-features-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, idx) => {
            const Icon = item.icon;
            return (
              <LandingReveal
                key={item.title}
                as="li"
                delay={landingStaggerDelay(idx, 0.07)}
                className="h-full"
              >
                <article className={cardClassName}>
                  <LandingSectionAccent
                    compact
                    variant={featureAccentVariants[idx % featureAccentVariants.length]}
                    className="caretip-landing-feature-accent mb-2.5 sm:mb-3"
                  >
                    {item.title}
                  </LandingSectionAccent>
                  <div
                    className={cn(
                      iconWrapBaseClassName,
                      "caretip-landing-feature-icon--obsidian",
                    )}
                  >
                    <Icon
                      className={iconGlyphClassName}
                      strokeWidth={2.25}
                      aria-hidden
                    />
                  </div>
                  {landingCopyVisible(item.tag) ? (
                    <h3 className={cn(landingType.cardTitle, "tracking-tight text-foreground")}>
                      {item.tag}
                    </h3>
                  ) : null}
                  <p className={cn(landingUi.cardFeatureBody, "flex-1")}>
                    {item.text}
                  </p>
                </article>
              </LandingReveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
