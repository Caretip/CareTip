import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  resolveHeroSlideMetricCards,
  type HeroMetricCardId,
} from "@/components/landing/landingHeroMetricCards";

type LandingHeroFloatingCardsProps = {
  /** Active hero story frame — drives card content and placement. */
  activeFrameKey: string;
  /** `full-bg` = landing hero; `card` = legacy framed showcase. */
  variant?: "full-bg" | "card";
  className?: string;
};

/**
 * Premium SaaS metric widgets — contextual per hero slide, subtle enter animation.
 */
export function LandingHeroFloatingCards({
  activeFrameKey,
  variant = "full-bg",
  className,
}: LandingHeroFloatingCardsProps) {
  const { t } = useTranslation();
  const cards = resolveHeroSlideMetricCards(activeFrameKey);

  return (
    <div
      className={cn("caretip-hero-float-cards", className)}
      data-hero-slide={activeFrameKey}
      data-hero-float-variant={variant}
      aria-hidden
    >
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <div
            key={`${activeFrameKey}-${card.slot}`}
            className={cn(
              "caretip-hero-metric-card",
              `caretip-hero-metric-card--${card.slot}` as `caretip-hero-metric-card--${HeroMetricCardId}`,
              "caretip-hero-metric-card--enter",
            )}
            style={
              {
                "--metric-enter-delay": `${index * 90}ms`,
                "--metric-float-duration": index === 0 ? "5.5s" : "6.75s",
                "--metric-float-rotate": index === 0 ? "-0.5deg" : "0.45deg",
              } as CSSProperties
            }
          >
            <span className="caretip-hero-metric-card__icon" aria-hidden>
              <Icon className="caretip-hero-metric-card__icon-svg" strokeWidth={2.25} />
            </span>
            <div className="caretip-hero-metric-card__copy">
              <p className="caretip-hero-metric-card__title">{t(card.titleKey)}</p>
              <p className="caretip-hero-metric-card__subtitle">{t(card.subtitleKey)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
