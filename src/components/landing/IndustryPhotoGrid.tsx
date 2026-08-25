import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import {
  ALL_INDUSTRY_PAGE_IDS,
  industryPath,
  type IndustryPageId,
} from "@/app/data/industryPages";
import { INDUSTRY_MEDIA } from "@/app/data/industryMedia";
import { warmIndustryHero } from "@/lib/industryHeroAssets";
import { cn } from "@/lib/utils";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";

type IndustryPhotoGridProps = {
  className?: string;
  /** When true, show industries beyond the three teaser cards. */
  showAll?: boolean;
  morePanelId?: string;
};

type IndustryCardData = {
  id: IndustryPageId;
  title: string;
  teaser: string;
  href: string;
  webp: string;
  avif: string;
};

/** Three teaser industries matching second-section layout (middle card tall). */
const TEASER_IDS: readonly IndustryPageId[] = ["gastronomy", "hotels", "logistics"];

/**
 * Second-section layout: three static photo cards + Learn more on each.
 * Expanded industries are controlled by the section header “View all” nav.
 */
export function IndustryPhotoGrid({
  className,
  showAll = false,
  morePanelId,
}: IndustryPhotoGridProps) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const prefix = "landing.industriesTeaser";
  const learnMore = t(`${prefix}.learnMore`);

  const moreIds = useMemo(
    () => ALL_INDUSTRY_PAGE_IDS.filter((id) => !TEASER_IDS.includes(id)),
    [],
  );

  const teaserCards = useMemo(
    () =>
      TEASER_IDS.map((id) => ({
        id,
        title: t(`${prefix}.cards.${id}.title`),
        teaser: t(`${prefix}.cards.${id}.teaser`),
        href: industryPath(id),
        webp: INDUSTRY_MEDIA[id].hero.webp,
        avif: INDUSTRY_MEDIA[id].hero.avif,
      })),
    [t],
  );

  const moreCards = useMemo(
    () =>
      moreIds.map((id) => ({
        id,
        title: t(`${prefix}.cards.${id}.title`),
        teaser: t(`${prefix}.cards.${id}.teaser`),
        href: industryPath(id),
        webp: INDUSTRY_MEDIA[id].hero.webp,
        avif: INDUSTRY_MEDIA[id].hero.avif,
      })),
    [t, moreIds],
  );

  useEffect(() => {
    for (const id of ALL_INDUSTRY_PAGE_IDS) {
      void warmIndustryHero(id, { priority: "low" });
    }
  }, []);

  return (
    <div className={cn("caretip-industry-second-section", className)}>
      <div
        className="caretip-industry-photo-grid"
        role="list"
        aria-label={t(`${prefix}.teasersAria`)}
      >
        {teaserCards.map((card, index) => (
          <IndustryPhotoCard
            key={card.id}
            card={card}
            ctaLabel={learnMore}
            tall={index === 1}
            index={index}
            animate={!reduceMotion}
          />
        ))}
      </div>

      <div
        id={morePanelId}
        className={cn(
          "caretip-industry-photo-grid caretip-industry-photo-grid--more",
          showAll && "caretip-industry-photo-grid--more-open",
        )}
        role="list"
        hidden={!showAll}
        aria-hidden={!showAll}
      >
        {moreCards.map((card, index) => (
          <IndustryPhotoCard
            key={card.id}
            card={card}
            ctaLabel={learnMore}
            tall={index === 1}
            index={index + 3}
            animate={!reduceMotion}
          />
        ))}
      </div>
    </div>
  );
}

function IndustryPhotoCard({
  card,
  ctaLabel,
  tall,
  index,
  animate,
}: {
  card: IndustryCardData;
  ctaLabel: string;
  tall: boolean;
  index: number;
  animate: boolean;
}) {
  return (
    <article
      role="listitem"
      className={cn(
        "caretip-industry-photo-card",
        tall && "caretip-industry-photo-card--tall",
        animate && "caretip-industry-photo-card--animate",
      )}
      data-industry={card.id}
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      <div className="caretip-industry-photo-card__media">
        <picture>
          <source type="image/avif" srcSet={card.avif} />
          <source type="image/webp" srcSet={card.webp} />
          <img
            src={card.webp}
            alt=""
            className="caretip-industry-photo-card__img"
            loading={index < 3 ? "eager" : "lazy"}
            decoding="async"
          />
        </picture>
      </div>

      <div className="caretip-industry-photo-card__overlay" aria-hidden />

      <div className="caretip-industry-photo-card__label">
        <small>{card.title}</small>
        <strong>{card.teaser}</strong>
        <PrefetchLink to={card.href} className="caretip-industry-photo-card__cta no-underline">
          {ctaLabel}
          <ArrowUpRight size={15} strokeWidth={2.3} aria-hidden />
        </PrefetchLink>
      </div>
    </article>
  );
}
