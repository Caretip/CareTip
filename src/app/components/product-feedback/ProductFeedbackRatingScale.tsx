import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  PRODUCT_FEEDBACK_RATINGS,
  ratingLabelKey,
  type ProductFeedbackRatingValue,
} from "./productFeedbackPresentation";

type ProductFeedbackRatingScaleProps = {
  value: number;
  onChange: (rating: ProductFeedbackRatingValue) => void;
  disabled?: boolean;
  "aria-label"?: string;
};

export function ProductFeedbackRatingScale({
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: ProductFeedbackRatingScaleProps) {
  const { t } = useTranslation();

  return (
    <div
      className="grid grid-cols-5 gap-2 sm:gap-3"
      role="radiogroup"
      aria-label={ariaLabel ?? t("productReview.form.ratingGroupAria")}
    >
      {PRODUCT_FEEDBACK_RATINGS.map((rating) => {
        const selected = value === rating;
        return (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            data-selected={selected ? "true" : "false"}
            className={cn("product-feedback-rating-tile", disabled && "opacity-60")}
            onClick={() => onChange(rating)}
          >
            <span
              className={cn(
                "text-lg font-semibold tabular-nums sm:text-xl",
                selected ? "text-primary" : "text-foreground",
              )}
            >
              {rating}
            </span>
            <span className="text-[0.65rem] font-medium leading-tight text-muted-foreground sm:text-[0.7rem]">
              {t(ratingLabelKey(rating))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
