import { cn } from "@/lib/utils";
import { LandingHeroTipExperiencePanel } from "@/components/landing/LandingHeroTipExperiencePanel";

type LandingHeroFloatingCardsProps = {
  /** Active hero story frame — drives placement near staff in the photo. */
  activeFrameKey: string;
  /** `full-bg` = landing hero; `card` = legacy framed showcase. */
  variant?: "full-bg" | "card";
  className?: string;
};

/**
 * Product demo layer for the hero photo — CareTip QR tipping panel
 * positioned as if it belongs in the service environment.
 */
export function LandingHeroFloatingCards({
  activeFrameKey,
  variant = "full-bg",
  className,
}: LandingHeroFloatingCardsProps) {
  return (
    <div
      className={cn("caretip-hero-float-cards", className)}
      data-hero-slide={activeFrameKey}
      data-hero-float-variant={variant}
    >
      <LandingHeroTipExperiencePanel />
    </div>
  );
}
