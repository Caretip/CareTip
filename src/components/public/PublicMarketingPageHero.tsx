import type { ReactNode } from "react";
import { PublicPageBackLink } from "@/components/public/PublicPageBackLink";
import { PublicPageHeroCard } from "@/components/public/PublicPageHeroCard";
import { cn } from "@/lib/utils";

export type PublicMarketingPageHeroProps = {
  /** ID of the page h1 — used for `aria-labelledby` on the hero section. */
  labelledBy: string;
  /** Page inner utility for back-link alignment and band content width (e.g. `caretip-pricing-page__inner`). */
  pageInnerClassName: string;
  /** Optional extra classes on the hero card inner wrapper. */
  innerClassName?: string;
  className?: string;
  children: ReactNode;
};

/** Back link + shared hero card shell for public marketing pages. */
export function PublicMarketingPageHero({
  labelledBy,
  pageInnerClassName,
  innerClassName,
  className,
  children,
}: PublicMarketingPageHeroProps) {
  return (
    <section
      className={cn("caretip-public-marketing-hero-wise", className)}
      aria-labelledby={labelledBy}
    >
      <PublicPageBackLink
        className={cn("caretip-public-marketing-hero-wise__back", pageInnerClassName)}
      />

      <PublicPageHeroCard
        variant="fullBleed"
        innerClassName={cn(pageInnerClassName, innerClassName)}
      >
        {children}
      </PublicPageHeroCard>
    </section>
  );
}
