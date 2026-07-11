import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PublicPageHeroCardProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
};

/**
 * Shared rounded inset hero card — visual shell only.
 * Wrap existing hero content; does not alter typography or text placement.
 */
export function PublicPageHeroCard({ children, className, innerClassName }: PublicPageHeroCardProps) {
  return (
    <div className={cn("caretip-public-page-hero-card caretip-wise-inset-band", className)}>
      <div className={cn("caretip-public-page-hero-card__inner", innerClassName)}>{children}</div>
    </div>
  );
}
