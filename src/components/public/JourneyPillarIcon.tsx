import { Timer, type LucideIcon } from "lucide-react";
import { CareIcon, CARE_ICON_REGISTRY, type CareIconName } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Lucide icons for journey pillars without a dedicated CareTip semantic icon. */
const JOURNEY_PILLAR_LUCIDE: Record<string, LucideIcon> = {
  timer: Timer,
};

function isCareIconName(value: string): value is CareIconName {
  return value in CARE_ICON_REGISTRY;
}

type JourneyPillarIconProps = {
  iconKey: string;
  className?: string;
  variant?: "default" | "obsidian";
};

export function JourneyPillarIcon({ iconKey, className, variant = "default" }: JourneyPillarIconProps) {
  const shellClass = cn(
    variant === "obsidian"
      ? "caretip-public-obsidian-icon"
      : "caretip-marketing-icon-chip flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:h-8 sm:w-8",
    className,
  );

  const iconClass =
    variant === "obsidian"
      ? "h-3.5 w-3.5 sm:h-4 sm:w-4"
      : "h-4 w-4 sm:h-[1.125rem] sm:w-[1.125rem]";

  const Lucide = JOURNEY_PILLAR_LUCIDE[iconKey];
  if (Lucide) {
    return (
      <span className={shellClass} aria-hidden>
        <Lucide className={iconClass} strokeWidth={1.85} />
      </span>
    );
  }

  if (isCareIconName(iconKey)) {
    return (
      <span className={shellClass} aria-hidden>
        <CareIcon name={iconKey} size="sm" />
      </span>
    );
  }

  return null;
}
