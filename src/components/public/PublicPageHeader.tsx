import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { publicPageUi } from "@/components/public/publicPageUi";
import { PublicPageBackLink } from "@/components/public/PublicPageBackLink";
import { PublicPageHeroCard } from "@/components/public/PublicPageHeroCard";
import { PublicTrustChips } from "@/components/public/PublicTrustChips";

type PublicPageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  afterSubtitle?: ReactNode;
  showTrustChips?: boolean;
  centered?: boolean;
  /**
   * When `centered`:
   * - `center` — centered title/subtitle; centered `afterSubtitle` wrapper
   * - `stack` — left-aligned column within the centered max-width
   * - `heroGroup` — centered title, subtitle, and feature block as one hero unit
   */
  introLayout?: "center" | "stack" | "heroGroup";
  className?: string;
};

export function PublicPageHeader({
  title,
  subtitle,
  afterSubtitle,
  showTrustChips = false,
  centered = false,
  introLayout = "center",
  className,
}: PublicPageHeaderProps) {
  const introClassName = cn(
    introLayout === "heroGroup"
      ? "caretip-public-page-hero caretip-public-marketing-hero space-y-0"
      : "space-y-4 sm:space-y-5",
    centered && "mx-auto w-full",
    centered && introLayout === "heroGroup" && "max-w-3xl",
    centered && introLayout !== "heroGroup" && "max-w-2xl",
    centered &&
      (introLayout === "center" || introLayout === "heroGroup") &&
      "flex flex-col items-center text-center",
    centered && introLayout === "stack" && "flex flex-col items-start text-left",
  );

  return (
    <header className={cn(publicPageUi.header, centered && "text-center", className)}>
      <PublicPageBackLink />

      <PublicPageHeroCard innerClassName="caretip-public-page-header-hero-card__inner">
        <div className={introClassName}>
          <h1 className={cn(publicPageUi.title, centered && "w-full")}>{title}</h1>
          {subtitle ? (
            <p
              className={cn(
                publicPageUi.subtitle,
                centered && "w-full max-w-none",
                centered && (introLayout === "center" || introLayout === "heroGroup") && "mx-auto",
              )}
            >
              {subtitle}
            </p>
          ) : null}
          {afterSubtitle ? (
            <div
              className={cn(
                "w-full",
                centered &&
                  (introLayout === "center" || introLayout === "heroGroup") &&
                  "flex justify-center pt-0.5 sm:pt-1",
              )}
            >
              {afterSubtitle}
            </div>
          ) : null}
          {showTrustChips ? (
            <PublicTrustChips className={cn("pt-1", centered && "justify-center")} />
          ) : null}
        </div>
      </PublicPageHeroCard>
    </header>
  );
}
