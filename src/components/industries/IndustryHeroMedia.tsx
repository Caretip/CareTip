import { useEffect, useState } from "react";
import { INDUSTRY_MEDIA } from "@/app/data/industryMedia";
import type { IndustryPageId } from "@/app/data/industryPages";
import {
  ensureIndustryHeroPreloadLink,
  isIndustryHeroWarm,
  markIndustryHeroSrcWarm,
  warmIndustryHero,
} from "@/lib/industryHeroAssets";
import { cn } from "@/lib/utils";

type IndustryHeroMediaProps = {
  industryId: IndustryPageId;
  alt: string;
};

/**
 * Industry LCP hero — keyed remount + readiness gate.
 * Prevents the previous industry's decoded bitmap from lingering when
 * React Router reuses the same page component across `:industryId` changes.
 */
export function IndustryHeroMedia({ industryId, alt }: IndustryHeroMediaProps) {
  const media = INDUSTRY_MEDIA[industryId];
  const [ready, setReady] = useState(() => isIndustryHeroWarm(industryId));

  useEffect(() => {
    let cancelled = false;
    ensureIndustryHeroPreloadLink(industryId);

    const alreadyWarm = isIndustryHeroWarm(industryId);
    setReady(alreadyWarm);

    void warmIndustryHero(industryId, { priority: "high" }).then(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [industryId]);

  return (
    <picture key={industryId} data-industry-hero={industryId}>
      <source srcSet={media.hero.avif} type="image/avif" />
      <source srcSet={media.hero.webp} type="image/webp" />
      <img
        key={industryId}
        src={media.hero.webp}
        alt={alt}
        width={720}
        height={540}
        loading="eager"
        fetchPriority="high"
        decoding="async"
        className={cn(
          "caretip-industry-page__hero-img",
          ready && "caretip-industry-page__hero-img--ready",
        )}
        onLoad={(event) => {
          const img = event.currentTarget;
          markIndustryHeroSrcWarm(media.hero.webp, img);
          markIndustryHeroSrcWarm(media.hero.avif, img);
          setReady(true);
        }}
      />
    </picture>
  );
}
