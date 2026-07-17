import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PublicPageHeroCardProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  /** `fullBleed` = edge-to-edge orange band (Features/Pricing/FAQ). `inset` = rounded card with side margins. */
  variant?: "inset" | "fullBleed";
};

/**
 * Shared hero shell — visual shell only.
 * Wrap existing hero content; does not alter typography or text placement.
 */
export function PublicPageHeroCard({
  children,
  className,
  innerClassName,
  variant = "inset",
}: PublicPageHeroCardProps) {
  return (
    <div
      className={cn(
        "caretip-public-page-hero-card",
        variant === "inset" ? "caretip-wise-inset-band" : "caretip-wise-full-bleed-band",
        className,
      )}
    >
      <div className={cn("caretip-public-page-hero-card__inner", innerClassName)}>{children}</div>
    </div>
  );
}
