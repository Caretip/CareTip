import { useId, useState, type ReactNode } from "react";
import { MarketingPicture } from "@/lib/marketingPicture";
import { splitLandingCopySentences } from "@/lib/landingCopyLayout";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { caretipBtnPrimary, caretipBtnSecondary } from "@/lib/caretipButtonSystem";

function ExpandableInfoDetailBullet({ text }: { text: string }) {
  const colonIndex = text.indexOf(":");
  if (colonIndex === -1) return <>{text}</>;

  const label = text.slice(0, colonIndex).trim();
  const body = text.slice(colonIndex + 1).trim();

  return (
    <>
      <strong className="caretip-expandable-info-card__detail-label font-semibold">{label}:</strong>
      {body ? ` ${body}` : null}
    </>
  );
}
export type ExpandableInfoCardProps = {
  imageSrc: string;
  imageWebpSrc?: string;
  imageAvifSrc?: string;
  imageAlt: string;
  title: string;
  summary: ReactNode;
  detail: string;
  tag?: string;
  learnMoreLabel: string;
  learnLessLabel: string;
  className?: string;
  imageClassName?: string;
  /** Extra classes on the media frame (aspect ratio, crop hooks). */
  imageMediaClassName?: string;
  /** `contain` keeps the full image visible inside the media frame (inset padding). */
  imageFit?: "cover" | "contain";
  /** CSS object-position for cover crops, e.g. `50% 28%`. */
  imagePosition?: string;
  titleClassName?: string;
};

/**
 * Landing-style card with image, short summary, and expandable detail (Learn more).
 * Adapted from shadcn demo pattern — uses CareTip tokens (no external fonts).
 */
export function ExpandableInfoCard({
  imageSrc,
  imageWebpSrc,
  imageAvifSrc,
  imageAlt,
  title,
  summary,
  detail,
  tag,
  learnMoreLabel,
  learnLessLabel,
  className,
  imageClassName,
  imageMediaClassName,
  imageFit = "cover",
  imagePosition,
  titleClassName,
}: ExpandableInfoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const detailSentences = splitLandingCopySentences(detail);

  return (
    <article
      className={cn(
        "caretip-expandable-info-card group flex w-full flex-col overflow-hidden rounded-2xl border border-neutral-200/90 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] transition-[box-shadow,border-color] duration-300 hover:border-neutral-200 hover:shadow-[0_12px_36px_-8px_rgba(15,23,42,0.08)] dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-none dark:hover:border-neutral-700",
        className,
      )}
    >
      {tag ? (
        <div className="caretip-expandable-info-card__tag-slot px-5 pt-4 sm:px-6 sm:pt-5">
          <span className="caretip-expandable-info-card__image-label">{tag}</span>
        </div>
      ) : null}
      <div
        className={cn(
          "caretip-expandable-info-card__media relative w-full overflow-hidden",
          imageMediaClassName ?? "aspect-[16/10]",
          imageFit === "contain" &&
            "caretip-expandable-info-card__media--contain bg-neutral-100/80 px-4 pt-4 sm:px-5 sm:pt-5 dark:bg-neutral-900/50",
          imageFit !== "contain" && "caretip-image-card-frame",
          tag ? "mt-0" : undefined,
          imageClassName,
        )}
      >
        <MarketingPicture
          src={imageSrc}
          webpSrc={imageWebpSrc ?? imageSrc}
          avifSrc={imageAvifSrc}
          alt={imageAlt}
          className={cn(
            "h-full w-full",
            imageFit === "contain"
              ? "rounded-xl object-contain object-center"
              : "object-cover transition-[transform,opacity] duration-700 ease-out group-hover:scale-[1.01]",
          )}
          style={imageFit === "cover" && imagePosition ? { objectPosition: imagePosition } : undefined}
          loading="lazy"
          decoding="async"
        />
      </div>

      <div className="caretip-expandable-info-card__body flex flex-col px-5 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
        <h3
          className={cn(
            "font-sans text-card-title font-semibold tracking-tight text-foreground",
            titleClassName,
          )}
        >
          {title}
        </h3>
        <p className="caretip-expandable-info-card__summary mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
          {summary}
        </p>

        <div
          id={detailId}
          role="region"
          aria-label={title}
          aria-hidden={!expanded}
          className={cn(
            "caretip-expandable-info-card__detail",
            expanded && "caretip-expandable-info-card__detail--open",
          )}
        >
          <div className="caretip-expandable-info-card__detail-inner">
            {detailSentences.length > 1 ? (
              <ul
                className={cn(
                  "caretip-landing-copy-scan-list caretip-expandable-info-card__detail-list",
                )}
                role="list"
              >
                {detailSentences.map((sentence, index) => (
                  <li
                    key={index}
                    className={cn(
                      "caretip-landing-copy-scan-list__item caretip-expandable-info-card__detail-list-item",
                    )}
                    role="listitem"
                  >
                    <ExpandableInfoDetailBullet text={sentence} />
                  </li>
                ))}
              </ul>
            ) : (              <p className="mt-3 border-t border-neutral-100/90 pt-3 text-sm leading-[1.65] text-neutral-600 text-pretty dark:border-neutral-800 dark:text-neutral-400">
                {detail}
              </p>
            )}
          </div>
        </div>

        <Button
          type="button"
          variant={expanded ? "outline" : "default"}
          className={cn(
            "caretip-expandable-info-card__cta mt-5 w-full sm:mt-6 sm:w-auto",
            expanded ? caretipBtnSecondary : caretipBtnPrimary,
          )}
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? learnLessLabel : learnMoreLabel}
        </Button>
      </div>
    </article>
  );
}
