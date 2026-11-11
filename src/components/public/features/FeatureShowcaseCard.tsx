import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { publicPageUi } from "@/components/public/publicPageUi";
import { FeatureProductVisual } from "@/components/public/features/FeatureProductVisual";
import type { FeatureVisualVariant } from "@/components/public/features/featuresPageConfig";
import { usePublicScrollReveal } from "@/lib/usePublicScrollReveal";

type FeatureShowcaseCardProps = {
  title: string;
  description: string;
  tag: string;
  Icon: LucideIcon;
  visual: FeatureVisualVariant;
  featured?: boolean;
  brandAccent?: boolean;
  index: number;
};

export function FeatureShowcaseCard({
  title,
  description,
  tag,
  Icon,
  visual,
  featured = false,
  brandAccent = false,
  index,
}: FeatureShowcaseCardProps) {
  const reveal = usePublicScrollReveal(featured ? 0 : index * 0.05);

  return (
    <article
      ref={featured ? undefined : reveal.ref}
      className={cn(
        "caretip-feature-showcase-card group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-[0_2px_8px_rgba(15,23,42,0.04),0_14px_40px_-18px_rgba(15,23,42,0.12)] transition-[box-shadow,border-color,transform] duration-300",
        !brandAccent &&
          "hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-[0_8px_32px_-12px_rgba(235,153,44,0.18)]",
        featured && "lg:min-h-[22rem]",
        brandAccent && "caretip-feature-showcase-card--brand",
        !featured && reveal.className,
      )}
      style={featured ? undefined : reveal.style}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(235,153,44,0.12),transparent_70%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <FeatureProductVisual variant={visual} featured={featured} className="m-3 mb-0 sm:m-4 sm:mb-0" />

      <div className={cn("flex flex-1 flex-col p-4 sm:p-5", featured && "sm:p-6")}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="caretip-feature-showcase-card__tag inline-flex items-center gap-1.5 rounded-full border border-border/90 bg-muted/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Icon className="h-3 w-3 text-primary transition-transform duration-300 group-hover:scale-110" aria-hidden />
            {tag}
          </span>
        </div>
        <h2
          className={cn(
            "caretip-feature-showcase-card__title font-semibold tracking-[-0.02em] text-foreground",
            featured ? "text-xl sm:text-2xl" : "text-lg",
          )}
        >
          {title}
        </h2>
        <p
          className={cn(
            "caretip-feature-showcase-card__desc mt-2 leading-relaxed text-muted-foreground",
            featured ? "text-[0.9375rem] sm:text-base" : "text-sm",
          )}
        >
          {description}
        </p>
      </div>
    </article>
  );
}
