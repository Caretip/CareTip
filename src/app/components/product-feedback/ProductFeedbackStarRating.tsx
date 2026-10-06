import { useState } from "react";
import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  PRODUCT_FEEDBACK_RATINGS,
  ratingLabelKey,
  type ProductFeedbackRatingValue,
} from "./productFeedbackPresentation";

type ProductFeedbackStarRatingProps = {
  value: number;
  onChange?: (rating: ProductFeedbackRatingValue) => void;
  disabled?: boolean;
  readOnly?: boolean;
  showLabel?: boolean;
  "aria-label"?: string;
};

export function ProductFeedbackStarRating({
  value,
  onChange,
  disabled,
  readOnly = false,
  showLabel = true,
  "aria-label": ariaLabel,
}: ProductFeedbackStarRatingProps) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(0);
  const interactive = !readOnly && !disabled && onChange;
  const highlight = interactive ? hover || value : value;

  return (
    <div className="product-feedback-stars-wrap">
      <div
        className="product-feedback-stars"
        role={readOnly ? "img" : "radiogroup"}
        aria-label={readOnly ? undefined : ariaLabel ?? t("productReview.form.ratingGroupAria")}
        aria-readonly={readOnly ? true : undefined}
        onMouseLeave={() => interactive && setHover(0)}
      >
        {PRODUCT_FEEDBACK_RATINGS.map((star) => {
          const filled = star <= highlight;
          if (readOnly) {
            return (
              <span key={star} className="product-feedback-star product-feedback-star--readonly" aria-hidden>
                <Star
                  className={cn("product-feedback-star__icon", filled && "product-feedback-star__icon--filled")}
                  strokeWidth={1.5}
                />
              </span>
            );
          }
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={value === star}
              disabled={disabled}
              className={cn(
                "product-feedback-star",
                filled && "product-feedback-star--active",
                disabled && "opacity-50",
              )}
              onClick={() => onChange?.(star)}
              onMouseEnter={() => interactive && setHover(star)}
              onFocus={() => interactive && setHover(star)}
              onBlur={() => interactive && setHover(0)}
            >
              <Star
                className={cn("product-feedback-star__icon", filled && "product-feedback-star__icon--filled")}
                strokeWidth={1.5}
              />
              <span className="sr-only">{t(ratingLabelKey(star))}</span>
            </button>
          );
        })}
      </div>
      {showLabel ? (
        <p className="product-feedback-stars-label" aria-live="polite">
          {highlight >= 1 && highlight <= 5 ? t(ratingLabelKey(highlight)) : "\u00a0"}
        </p>
      ) : null}
    </div>
  );
}
