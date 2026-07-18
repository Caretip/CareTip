import { useMemo, type CSSProperties } from "react";
import { CheckCircle2, Coins, Star, Users, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

type ChipSpec = {
  id: string;
  labelKey: string;
  Icon: LucideIcon;
  position: string;
  hideBelowMd?: boolean;
  hideBelowLg?: boolean;
  floatDuration: number;
  floatDelay: number;
};

const CHIP_BASE = cn(
  "caretip-hospitality-float-chip pointer-events-none absolute z-20",
  "max-w-[min(calc(100%-1.5rem),148px)] rounded-lg border border-white/48",
  "bg-white/74 px-2 py-1.5 shadow-[0_2px_8px_rgba(15,23,42,0.05),0_8px_22px_-6px_rgba(15,23,42,0.08)]",
  "backdrop-blur-md ring-1 ring-white/35",
  "max-lg:max-w-[min(calc(100%-1rem),124px)] max-lg:scale-[0.88]",
  "sm:max-lg:scale-[0.92]",
);

/** Subtle glass chips around the hospitality marquee — presentation only. */
export function HospitalityMediaFloatChips() {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();

  const chips = useMemo<ChipSpec[]>(
    () => [
      {
        id: "tip",
        labelKey: "landing.hospitality.floatTip",
        Icon: Coins,
        position: "top-[8%] left-[3%] sm:top-[9%] sm:left-[4%] lg:top-[10%] lg:left-[5%]",
        hideBelowMd: true,
        floatDuration: 7.2,
        floatDelay: 0,
      },
      {
        id: "review",
        labelKey: "landing.hospitality.floatReview",
        Icon: Star,
        position: "top-[9%] right-[3%] sm:top-[10%] sm:right-[4%] lg:top-[11%] lg:right-[5%]",
        floatDuration: 8,
        floatDelay: 0.45,
      },
      {
        id: "shift",
        labelKey: "landing.hospitality.floatShift",
        Icon: CheckCircle2,
        position: "bottom-[14%] left-[2%] sm:bottom-[13%] lg:bottom-[15%] lg:left-[4%]",
        hideBelowLg: true,
        floatDuration: 7.6,
        floatDelay: 0.9,
      },
      {
        id: "team",
        labelKey: "landing.hospitality.floatTeam",
        Icon: Users,
        position: "bottom-[10%] right-[3%] sm:bottom-[11%] sm:right-[4%] lg:bottom-[12%] lg:right-[5%]",
        floatDuration: 8.4,
        floatDelay: 0.25,
      },
    ],
    [],
  );

  const visibleOnMobile = new Set(["review", "team"]);

  return (
    <div
      className="caretip-hospitality-float-chips pointer-events-none absolute inset-0 z-20 overflow-hidden"
      aria-hidden
    >
      {chips.map((chip) => {
        const Icon = chip.Icon;
        const hiddenMobile = !visibleOnMobile.has(chip.id);
        return (
          <LandingReveal
            key={chip.id}
            delay={chip.floatDelay * 0.12}
            className={cn(
              CHIP_BASE,
              chip.position,
              chip.hideBelowLg && "hidden lg:block",
              chip.hideBelowMd && "hidden md:block",
              hiddenMobile && "max-lg:hidden",
              !reduceMotion && "caretip-hero-float-pill--animate",
            )}
            style={
              {
                "--float-duration": `${chip.floatDuration}s`,
                "--float-delay": `${chip.floatDelay}s`,
                "--float-offset": "-4px",
              } as CSSProperties
            }
          >
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="caretip-marketing-icon-chip flex h-5 w-5 shrink-0 items-center justify-center rounded-md sm:h-6 sm:w-6">
                <Icon className="h-2.5 w-2.5 sm:h-3 sm:w-3" strokeWidth={2.25} />
              </span>
              <span className="block font-sans text-[10px] font-medium leading-snug text-neutral-800 sm:text-[11px] dark:text-neutral-100">
                {t(chip.labelKey)}
              </span>
            </div>
          </LandingReveal>
        );
      })}
    </div>
  );
}
