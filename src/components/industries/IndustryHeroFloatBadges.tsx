import { BellRing, CheckCircle2, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { IndustryPageId } from "@/app/data/industryPages";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

const FLOAT_ICONS = [CheckCircle2, BellRing, TrendingUp] as const;

type IndustryHeroFloatBadgesProps = {
  industryId: IndustryPageId;
  className?: string;
};

/**
 * Shared floating UI badges over the industry hero image.
 * Structure identical across industries — only i18n labels change.
 */
export function IndustryHeroFloatBadges({ industryId, className }: IndustryHeroFloatBadgesProps) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const prefix = `industries.pages.${industryId}.floats`;

  return (
    <div
      className={cn("caretip-industry-page__floats", className)}
      data-reduce-motion={reduceMotion ? "true" : "false"}
      aria-hidden
    >
      {([1, 2, 3] as const).map((n, index) => {
        const Icon = FLOAT_ICONS[index] ?? CheckCircle2;
        return (
          <div
            key={n}
            className={cn(
              "caretip-industry-page__float",
              `caretip-industry-page__float--${n}`,
            )}
          >
            <span className="caretip-industry-page__float-icon">
              <Icon strokeWidth={2.2} aria-hidden />
            </span>
            <div className="caretip-industry-page__float-copy">
              <p className="caretip-industry-page__float-title">{t(`${prefix}.f${n}Title`)}</p>
              <p className="caretip-industry-page__float-value">{t(`${prefix}.f${n}Value`)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
