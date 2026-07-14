import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const TIP_PRESETS = [
  { id: "2", amountKey: "landing.showcase.heroTipPanel.amount2" },
  { id: "5", amountKey: "landing.showcase.heroTipPanel.amount5" },
  { id: "10", amountKey: "landing.showcase.heroTipPanel.amount10" },
  { id: "other", amountKey: "landing.showcase.heroTipPanel.amountOther" },
] as const;

/** Prefetched selected chip for the product mockup (visual only). */
const DEMO_SELECTED_ID = "5";

type LandingHeroTipExperiencePanelProps = {
  className?: string;
};

/**
 * In-scene CareTip tip UI — non-interactive product preview in the hero photo.
 * Demonstrates the guest experience; the page CTA remains the only action.
 */
export function LandingHeroTipExperiencePanel({
  className,
}: LandingHeroTipExperiencePanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "caretip-hero-tip-panel",
        "caretip-hero-tip-panel--enter",
        className,
      )}
      aria-hidden
    >
      <p className="caretip-hero-tip-panel__title">
        {t("landing.showcase.heroTipPanel.title")}
      </p>

      <div className="caretip-hero-tip-panel__rating">
        <span className="caretip-hero-tip-panel__stars">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              className="caretip-hero-tip-panel__star"
              fill="currentColor"
              strokeWidth={0}
            />
          ))}
        </span>
        <span className="caretip-hero-tip-panel__rating-label">
          {t("landing.showcase.heroTipPanel.ratingLabel")}
        </span>
      </div>

      <div className="caretip-hero-tip-panel__amounts">
        {TIP_PRESETS.map((preset) => {
          const selected = preset.id === DEMO_SELECTED_ID;
          return (
            <span
              key={preset.id}
              className={cn(
                "caretip-hero-tip-panel__amount",
                selected && "caretip-hero-tip-panel__amount--selected",
              )}
            >
              {t(preset.amountKey)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
