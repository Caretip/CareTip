import type { ReactNode } from "react";
import { landingUi } from "@/components/landing/landingUi";
import { cn } from "@/lib/utils";

export type LandingAccentVariant = "trend" | "spark" | "arrow" | "line";

type LandingSectionAccentProps = {
  children: ReactNode;
  /** Kept for call-site compatibility; section eyebrows share one treatment. */
  variant?: LandingAccentVariant;
  /** Softer neutral eyebrow (secondary label, no orange dot). */
  muted?: boolean;
  /**
   * Feature-card labels reuse this component — keep a compact label
   * so card titles are not forced into uppercase section eyebrows.
   */
  compact?: boolean;
  className?: string;
};

/** Section eyebrow: small accent + sentence-case label (no pill chrome). */
export function LandingSectionAccent({
  children,
  muted = false,
  compact = false,
  className,
}: LandingSectionAccentProps) {
  if (compact) {
    return (
      <span
        className={cn(landingUi.sectionAccentCompact, className)}
        data-landing-accent=""
        data-landing-accent-compact=""
        role="presentation"
      >
        <span
          className={cn(
            "caretip-landing-accent-text",
            muted ? landingUi.sectionAccentTextMuted : landingUi.sectionAccentTextCompact,
          )}
        >
          {children}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        muted ? landingUi.sectionAccentMuted : landingUi.sectionAccent,
        className,
      )}
      data-landing-accent=""
      data-landing-accent-eyebrow=""
      role="presentation"
    >
      {!muted ? (
        <span aria-hidden className={landingUi.sectionAccentDot} data-accent-dot="" />
      ) : null}
      <span
        className={cn(
          "caretip-landing-accent-text",
          muted && "caretip-landing-accent-text--muted",
          muted ? landingUi.sectionAccentTextMuted : landingUi.sectionAccentText,
        )}
      >
        {children}
      </span>
    </span>
  );
}
