import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import {
  sanitizeGuestExternalReviews,
  type PublicGuestExternalReviews,
} from "../../lib/externalReviewLinks";
import { cn } from "@/lib/utils";

type Props = {
  reviews: PublicGuestExternalReviews | null | undefined;
  className?: string;
};

export function GuestExternalReviewLinks({ reviews, className }: Props) {
  const { t } = useTranslation();
  const safe = sanitizeGuestExternalReviews(reviews);
  if (!safe) return null;

  return (
    <section
      className={cn("customer-flow-external-reviews w-full min-w-0", className)}
      aria-labelledby="guest-external-reviews-heading"
    >
      <h2 id="guest-external-reviews-heading" className="customer-flow-external-reviews__title">
        {t("tipFlow.success.externalReviewsHeading")}
      </h2>
      <p className="customer-flow-external-reviews__hint">{t("tipFlow.success.externalReviewsHint")}</p>
      <div className="customer-flow-external-reviews__actions">
        {safe.googleWriteReviewUrl ? (
          <a
            className="customer-flow-external-review-btn"
            href={safe.googleWriteReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>{t("tipFlow.success.reviewOnGoogle")}</span>
            <ExternalLink className="size-4 shrink-0" aria-hidden />
            <span className="sr-only">{t("tipFlow.success.opensExternal")}</span>
          </a>
        ) : null}
        {safe.tripadvisorReviewUrl ? (
          <a
            className="customer-flow-external-review-btn"
            href={safe.tripadvisorReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>{t("tipFlow.success.reviewOnTripadvisor")}</span>
            <ExternalLink className="size-4 shrink-0" aria-hidden />
            <span className="sr-only">{t("tipFlow.success.opensExternal")}</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}
