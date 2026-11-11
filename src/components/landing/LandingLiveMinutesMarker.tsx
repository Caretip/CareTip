import { ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

/** Row layout paired with markers — matches `#how-it-works` step rows. */
export const landingLiveMinutesRowClass = "flex items-start gap-3 sm:gap-3.5";

const markerShell =
  "relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-sans transition-[background-color,color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:h-9 sm:w-9";

const markerActive =
  "bg-primary text-black shadow-[0_4px_12px_rgba(235,153,44,0.28)]";

const markerInactive =
  "bg-primary/10 group-hover:bg-primary/15 dark:bg-primary/15";

/** Gradient stroke applied via `.caretip-landing-uptrend-icon__glyph` — not on marker shell. */
export const landingListMarkerIconClass = "caretip-landing-uptrend-icon__glyph";

/** @deprecated Use `landingListMarkerIconClass` */
export const landingUptrendIconClass = landingListMarkerIconClass;

type LandingLiveMinutesMarkerProps = {
  /** When set, shows step index (Live in Minutes only — do not use on other sections). */
  stepNumber?: number;
  active?: boolean;
  className?: string;
};

/**
 * Circular list marker — primary fill when active, soft tint + list icon otherwise.
 */
export function LandingLiveMinutesMarker({
  stepNumber,
  active = false,
  className,
}: LandingLiveMinutesMarkerProps) {
  return (
    <span
      className={cn(
        markerShell,
        active ? markerActive : markerInactive,
        stepNumber != null && "text-card-title font-bold tabular-nums",
        className,
      )}
      aria-hidden={stepNumber == null}
    >
      {stepNumber != null ? (
        stepNumber
      ) : (
        <ListChecks
          className={cn(
            landingListMarkerIconClass,
            active && "caretip-landing-uptrend-icon__glyph--active",
            "h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4",
          )}
          strokeWidth={2.25}
          aria-hidden
        />
      )}
    </span>
  );
}
