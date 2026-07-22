import { INDUSTRY_MEDIA } from "@/app/data/industryMedia";
import type { IndustryPageId } from "@/app/data/industryPages";
import { cn } from "@/lib/utils";

type IndustryBackgroundProps = {
  activeId: IndustryPageId;
  className?: string;
};

/**
 * Full-bleed industry hero stack — cross-fades via opacity only.
 */
export function IndustryBackground({ activeId, className }: IndustryBackgroundProps) {
  return (
    <div className={cn("caretip-industry-showcase__bg", className)} aria-hidden>
      {(Object.keys(INDUSTRY_MEDIA) as IndustryPageId[]).map((id) => {
        const hero = INDUSTRY_MEDIA[id].hero;
        const active = id === activeId;
        return (
          <picture
            key={id}
            className={cn(
              "caretip-industry-showcase__bg-layer",
              active && "caretip-industry-showcase__bg-layer--active",
            )}
          >
            <source srcSet={hero.avif} type="image/avif" />
            <source srcSet={hero.webp} type="image/webp" />
            <img
              src={hero.webp}
              alt=""
              decoding="async"
              loading={active ? "eager" : "lazy"}
              fetchPriority={active ? "high" : "low"}
              className="caretip-industry-showcase__bg-img h-full w-full object-cover"
              sizes="(max-width: 1023px) 100vw, min(80rem, 100vw)"
              draggable={false}
            />
          </picture>
        );
      })}
      <div className="caretip-industry-showcase__bg-overlay" />
      <div className="caretip-industry-showcase__bg-vignette" />
    </div>
  );
}
