import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { prefetchPublicRoute } from "@/app/lib/prefetchPublicRoutes";
import {
  ALL_INDUSTRY_PAGE_IDS,
  industryPath,
  type IndustryPageId,
} from "@/app/data/industryPages";
import { INDUSTRY_MEDIA } from "@/app/data/industryMedia";
import { warmIndustryHero } from "@/lib/industryHeroAssets";
import type { ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Loader2 } from "lucide-react";
import { useNavigation } from "react-router";

type IndustryPhotoGridProps = {
  className?: string;
};

type IndustrySnippetKey = "tipsUp" | "tipsToday";

type IndustryCardData = {
  id: IndustryPageId;
  title: string;
  teaser: string;
  href: string;
  webp: string;
  avif: string;
  snippetKey?: IndustrySnippetKey;
};

const INDUSTRY_SNIPPETS: Partial<Record<IndustryPageId, IndustrySnippetKey>> = {
  gastronomy: "tipsUp",
};

/**
 * Homepage industries — all six cards visible in the PDF order.
 */
export function IndustryPhotoGrid({ className }: IndustryPhotoGridProps) {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const prefix = "landing.industriesTeaser";
  const learnMore = t(`${prefix}.learnMore`);

  const cards = useMemo(
    () =>
      ALL_INDUSTRY_PAGE_IDS.map((id) => ({
        id,
        title: t(`${prefix}.cards.${id}.title`),
        teaser: t(`${prefix}.cards.${id}.teaser`),
        href: industryPath(id),
        webp: INDUSTRY_MEDIA[id].hero.webp,
        avif: INDUSTRY_MEDIA[id].hero.avif,
        snippetKey: INDUSTRY_SNIPPETS[id],
      })),
    [t],
  );

  useEffect(() => {
    for (const id of ALL_INDUSTRY_PAGE_IDS) {
      void warmIndustryHero(id, { priority: "low" });
    }
    /*
     * The grid mounts only when scrolled near. Fetch the (shared, small) industry page code now so
     * "Learn more" opens instantly; before, a tap waited for it (about 1s on slow 4G, no feedback).
     * Code only: hero images keep their own low-priority warm above. Skipped under Save-Data.
     */
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;
    const warmCode = () => prefetchPublicRoute(industryPath(ALL_INDUSTRY_PAGE_IDS[0]), { warmImages: false });
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warmCode, { timeout: 1500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warmCode, 400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className={cn("caretip-industry-second-section", className)}>
      <div
        className="caretip-industry-photo-grid caretip-industry-photo-grid--all-six"
        role="list"
        aria-label={t(`${prefix}.teasersAria`)}
      >
        {cards.map((card, index) => (
          <IndustryPhotoCard
            key={card.id}
            card={card}
            ctaLabel={learnMore}
            index={index}
            animate={!reduceMotion}
            snippet={
              card.snippetKey
                ? t(`${prefix}.snippets.${card.snippetKey}`)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function isAvifSrc(src: string): boolean {
  return src.toLowerCase().includes(".avif");
}

function isWebpSrc(src: string): boolean {
  return src.toLowerCase().includes(".webp");
}

function IndustryPhotoCard({
  card,
  ctaLabel,
  index,
  animate,
  snippet,
}: {
  card: IndustryCardData;
  ctaLabel: string;
  index: number;
  animate: boolean;
  snippet?: string;
}) {
  // Instant feedback while React Router is still fetching this card's page.
  const navigation = useNavigation();
  const pending = navigation.state === "loading" && navigation.location?.pathname === card.href;
  return (
    <article
      role="listitem"
      className={cn(
        "caretip-industry-photo-card",
        animate && "caretip-industry-photo-card--animate",
        pending && "caretip-industry-photo-card--pending",
      )}
      data-industry={card.id}
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      <div className="caretip-industry-photo-card__media">
        <picture>
          {isAvifSrc(card.avif) ? <source type="image/avif" srcSet={card.avif} /> : null}
          {isWebpSrc(card.webp) ? <source type="image/webp" srcSet={card.webp} /> : null}
          <img
            src={card.webp}
            alt=""
            className="caretip-industry-photo-card__img"
            loading={index < 6 ? "eager" : "lazy"}
            {...(index < 3
              ? ({ fetchpriority: "high" } as ImgHTMLAttributes<HTMLImageElement>)
              : index < 6
                ? ({ fetchpriority: "auto" } as ImgHTMLAttributes<HTMLImageElement>)
                : {})}
            decoding="async"
            onError={(event) => {
              const img = event.currentTarget;
              const picture = img.parentElement;
              if (picture?.tagName === "PICTURE") {
                picture
                  .querySelectorAll('source[type="image/avif"]')
                  .forEach((source) => source.remove());
              }
              if (img.getAttribute("src") !== card.webp) {
                img.src = card.webp;
              }
            }}
          />
        </picture>
      </div>

      <div className="caretip-industry-photo-card__overlay" aria-hidden />

      {snippet ? <p className="caretip-industry-photo-card__snippet">{snippet}</p> : null}

      <div className="caretip-industry-photo-card__label">
        <small>{card.title}</small>
        <strong>{card.teaser}</strong>
        <PrefetchLink
          to={card.href}
          className="caretip-industry-photo-card__cta no-underline"
          aria-busy={pending || undefined}
        >
          <span className="caretip-industry-photo-card__cta-text">{ctaLabel}</span>
          <span className="caretip-industry-photo-card__cta-icon" aria-hidden>
            {pending ? (
              <Loader2 size={16} strokeWidth={2.4} className="caretip-industry-photo-card__cta-spin" />
            ) : (
              <ArrowRight size={16} strokeWidth={2.4} />
            )}
          </span>
        </PrefetchLink>
      </div>
    </article>
  );
}
