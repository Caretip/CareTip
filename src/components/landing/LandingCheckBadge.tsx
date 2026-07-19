import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { caretipType } from "@/lib/typography/caretipType";
import { cn } from "@/lib/utils";

/** Shared row layout for landing benefit bullets — matches #built-for-hospitality rhythm. */
export const landingBenefitRowClass =
  "caretip-landing-benefit-row flex items-start gap-3.5 sm:gap-3.5";

/** @deprecated Use `landingBenefitRowClass` */
export const landingLiveMinutesRowClass = landingBenefitRowClass;

/** Single primary check — same marker as pricing tier feature bullets. */
export function LandingBenefitCheckMark({ className }: { className?: string }) {
  return (
    <span className={cn("caretip-pricing-tier-features__check caretip-landing-benefit-check", className)} aria-hidden>
      <Check className="size-3 caretip-landing-benefit-check__glyph" strokeWidth={2.75} />
    </span>
  );
}

/** @deprecated Use `landingLiveMinutesRowClass` — kept for imports that reference the grid helper. */
export const landingUptrendRowGrid = landingLiveMinutesRowClass;

export type LandingBenefitTone = "cinematic" | "split" | "default";

type LandingBenefitChecklistProps = {
  items: string[];
  tone: LandingBenefitTone;
  className?: string;
};

/** Hero-style benefit list — single check marker (matches hospitality section). */
export function LandingBenefitChecklist({ items, tone, className }: LandingBenefitChecklistProps) {
  const textClass =
    tone === "default"
      ? "text-foreground"
      : "text-foreground";

  return (
    <ul
      className={cn(
        "mt-5 flex w-full max-w-xl flex-col gap-3 sm:mt-7 sm:gap-4",
        tone === "cinematic" && "max-md:mt-0 max-md:gap-2.5 max-md:max-w-full",
        className,
      )}
      role="list"
    >
      {items.map((label, i) => (
        <li
          key={i}
          className={cn(landingBenefitRowClass, caretipType.featureCopy, textClass)}
          role="listitem"
        >
          <LandingBenefitCheckMark />
          <span className="min-w-0 [text-wrap:pretty]">{label}</span>
        </li>
      ))}
    </ul>
  );
}

type LandingBenefitBlockProps = {
  title: ReactNode;
  description?: ReactNode;
  titleClassName?: string;
  bodyClassName?: string;
  className?: string;
  variant?: "default" | "split" | "showcase";
  active?: boolean;
};

export function LandingBenefitBlock({
  title,
  description,
  titleClassName,
  bodyClassName,
  className,
  variant = "default",
  active: _active = false,
}: LandingBenefitBlockProps) {
  const isRich = variant === "split" || variant === "showcase";

  return (
    <div className={cn(landingBenefitRowClass, className)} role="listitem">
      <LandingBenefitCheckMark />
      <div
        className={cn(
          "min-w-0 flex-1",
          isRich ? "space-y-1 max-md:space-y-1 sm:space-y-1.5 lg:space-y-2" : "space-y-1.5 sm:space-y-2",
        )}
      >
        <div
          className={cn(
            isRich ? caretipType.featureCopySemibold : caretipType.cardTitle,
            "tracking-tight",
            titleClassName,
          )}
        >
          {title}
        </div>
        {description ? (
          <div className={cn(caretipType.bodyCopyMuted, bodyClassName)}>{description}</div>
        ) : null}
      </div>
    </div>
  );
}

/** @deprecated Use `LandingBenefitCheckMark` */
export function LandingCheckBadge({ className }: { className?: string; matchLineHeight?: boolean; active?: boolean }) {
  return <LandingBenefitCheckMark className={className} />;
}
