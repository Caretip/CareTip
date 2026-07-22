import type { LucideIcon } from "lucide-react";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { caretipBtnPrimary } from "@/lib/caretipButtonSystem";
import { cn } from "@/lib/utils";

export type IndustryGlassCardProps = {
  title: string;
  teaser: string;
  ctaLabel: string;
  href: string;
  Icon: LucideIcon;
  className?: string;
};

/**
 * Centered glass panel — name → icon → teaser → CTA.
 */
export function IndustryGlassCard({
  title,
  teaser,
  ctaLabel,
  href,
  Icon,
  className,
}: IndustryGlassCardProps) {
  return (
    <article className={cn("caretip-industry-glass", className)}>
      <h3 className="caretip-industry-glass__title">{title}</h3>

      <span className="caretip-industry-glass__icon" aria-hidden>
        <Icon strokeWidth={1.6} />
      </span>

      <p className="caretip-industry-glass__teaser">{teaser}</p>

      <PrefetchLink
        to={href}
        className={cn(
          caretipBtnPrimary,
          "caretip-industry-glass__cta no-underline touch-manipulation",
        )}
      >
        {ctaLabel}
      </PrefetchLink>
    </article>
  );
}
