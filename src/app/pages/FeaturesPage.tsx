import { useMemo } from "react";
import { Activity, BarChart3, History, QrCode, Star, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import "@/styles/bundles/marketing-pages.css";
import "@/styles/bundles/landing.css";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { FeaturesPageFinalCta } from "@/components/public/features/FeaturesPageFinalCta";
import { FeatureProductVisual } from "@/components/public/features/FeatureProductVisual";
import type { FeatureVisualVariant } from "@/components/public/features/featuresPageConfig";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingSectionAccent, type LandingAccentVariant } from "@/components/landing/LandingSectionAccent";
import { landingCopyVisible, landingUi } from "@/components/landing/landingUi";
import { landingType } from "@/components/landing/landingTypography";
import { landingStaggerDelay } from "@/lib/landingMotion";
import { usePublicMountProbe } from "@/lib/publicMountProbe";
import { cn } from "@/lib/utils";

const FEATURE_VISUALS: FeatureVisualVariant[] = [
  "qr",
  "employee",
  "analytics",
  "security",
  "realtime",
  "locations",
];

const FEATURE_ICONS = [QrCode, Activity, BarChart3, History, Wallet, Star] as const;

const featureAccentVariants: LandingAccentVariant[] = [
  "spark",
  "trend",
  "arrow",
  "line",
  "spark",
  "trend",
];

const cardClassName = cn(
  "caretip-landing-card caretip-landing-feature-card group relative flex h-full flex-col overflow-hidden rounded-2xl",
  "border border-border/80 bg-card/95",
);

/**
 * Features / Funktionen page — landing modern grid + real app visuals.
 */
export function FeaturesPage() {
  usePublicMountProbe("FeaturesPage");
  const { t, i18n } = useTranslation();
  const sectionSubtitle = t("landing.features.subtitle");

  const items = useMemo(
    () =>
      ([1, 2, 3, 4, 5, 6] as const).map((n, idx) => ({
        key: `i${n}`,
        Icon: FEATURE_ICONS[idx]!,
        visual: FEATURE_VISUALS[idx]!,
        title: t(`landing.features.i${n}Title`),
        text: t(`landing.features.i${n}Text`),
        tag: t(`landing.features.i${n}Tag`),
      })),
    [t, i18n.language],
  );

  return (
    <PublicPageShell maxWidth="full" contentClassName="pb-0" className="bg-background">
      <main
        id="features"
        className="caretip-features-page caretip-features-page--wise caretip-landing caretip-landing--premium"
        aria-label={t("nav.features")}
      >
        <section
          className={cn(
            landingUi.section,
            landingUi.landingSurface,
            "caretip-landing-features-section relative overflow-hidden",
          )}
        >
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className={landingUi.sectionIntro}>
              {landingCopyVisible(t("landing.features.eyebrow")) ? (
                <div className={landingUi.sectionAccentRow}>
                  <LandingSectionAccent variant="spark">
                    {t("landing.features.eyebrow")}
                  </LandingSectionAccent>
                </div>
              ) : null}
              <h1 className={cn(landingUi.sectionTitle, "caretip-landing-scroll-reveal--visible")}>
                {t("landing.features.title")}
              </h1>
              {landingCopyVisible(sectionSubtitle) ? (
                <p className={cn(landingUi.sectionSubtitle, "caretip-landing-scroll-reveal--visible")}>
                  {sectionSubtitle}
                </p>
              ) : null}
            </div>

            <ul className="caretip-landing-features-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item, idx) => {
                const Icon = item.Icon;
                return (
                  <LandingReveal
                    key={item.key}
                    as="li"
                    delay={landingStaggerDelay(idx, 0.07)}
                    className="h-full"
                  >
                    <article className={cardClassName}>
                      <FeatureProductVisual
                        variant={item.visual}
                        className="m-3 mb-0 sm:m-4 sm:mb-0"
                      />
                      <div className="flex flex-1 flex-col p-4 pt-3 sm:p-5 sm:pt-4">
                        <LandingSectionAccent
                          variant={featureAccentVariants[idx % featureAccentVariants.length]}
                          className="caretip-landing-feature-accent mb-2.5 sm:mb-3"
                        >
                          {item.title}
                        </LandingSectionAccent>
                        <div className="mb-2 flex items-center gap-2">
                          <Icon
                            className="h-4 w-4 shrink-0 text-primary"
                            strokeWidth={2.25}
                            aria-hidden
                          />
                          {landingCopyVisible(item.tag) ? (
                            <h2 className={cn(landingType.cardTitle, "tracking-tight text-foreground")}>
                              {item.tag}
                            </h2>
                          ) : null}
                        </div>
                        <p className={cn(landingUi.cardFeatureBody, "flex-1")}>{item.text}</p>
                      </div>
                    </article>
                  </LandingReveal>
                );
              })}
            </ul>
          </div>
        </section>

        <FeaturesPageFinalCta />
      </main>
    </PublicPageShell>
  );
}
