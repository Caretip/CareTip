import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type CustomerFeedbackRatingDisplayProps = {
  averageRating: number | null | undefined;
  reviewCount?: number;
  ratingCount?: number;
  size?: "md" | "lg";
  className?: string;
};

function StarRow({ rating, size }: { rating: number; size: "md" | "lg" }) {
  const rounded = Math.max(1, Math.min(5, Math.round(rating)));
  const starClass = size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <div className="mt-1 flex items-center gap-0.5" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            "shrink-0",
            starClass,
            i < rounded ? "fill-primary text-primary" : "text-muted-foreground/25",
          )}
        />
      ))}
    </div>
  );
}

export function CustomerFeedbackRatingDisplay({
  averageRating,
  reviewCount,
  ratingCount,
  size = "md",
  className,
}: CustomerFeedbackRatingDisplayProps) {
  const { t } = useTranslation();
  const count = reviewCount ?? ratingCount ?? 0;
  const hasRating = averageRating != null && Number.isFinite(averageRating);

  return (
    <div className={cn("caretip-feedback-rating-display", `caretip-feedback-rating-display--${size}`, className)}>
      <p className="caretip-feedback-rating-display__value tabular-nums">
        {hasRating ? averageRating!.toFixed(1) : "—"}
      </p>
      {hasRating ? <StarRow rating={averageRating!} size={size} /> : null}
      {count > 0 ? (
        <p className="caretip-feedback-rating-display__meta">
          {t("business.customerFeedback.basedOnReviews", { count })}
        </p>
      ) : null}
    </div>
  );
}
