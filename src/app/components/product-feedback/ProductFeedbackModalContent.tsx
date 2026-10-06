import { useEffect, useState } from "react";
import { Check, Loader2, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  PLATFORM_PRODUCT_FEEDBACK_COMMENT_MAX,
  submitMyProductReview,
} from "@/app/lib/api";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { logClientError } from "@/app/lib/clientLog";
import { ProductFeedbackStarRating } from "./ProductFeedbackStarRating";
import {
  emptyProductFeedbackComposerState,
  type ProductFeedbackComposerState,
} from "./productFeedbackComposerState";
import { cn } from "@/lib/utils";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { DialogClose } from "@/app/components/ui/dialog";

type ProductFeedbackModalContentProps = {
  open: boolean;
};

export function ProductFeedbackModalContent({ open }: ProductFeedbackModalContentProps) {
  const { t } = useTranslation();
  const [composer, setComposer] = useState<ProductFeedbackComposerState>(emptyProductFeedbackComposerState);

  const resetComposer = () => {
    setComposer(emptyProductFeedbackComposerState());
  };

  useEffect(() => {
    if (!open) {
      resetComposer();
    }
  }, [open]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (composer.rating < 1 || composer.rating > 5) {
      toast.message(t("productReview.form.ratingRequired"));
      return;
    }
    if (composer.submitting) return;

    setComposer((s) => ({ ...s, submitting: true }));
    try {
      await submitMyProductReview({
        rating: composer.rating,
        comment: composer.comment.trim() ? composer.comment.trim() : null,
      });
      resetComposer();
      setComposer({ ...emptyProductFeedbackComposerState(), showSuccess: true });
      toast.success(t("productReview.success.toast"));
    } catch (err) {
      logClientError("ProductFeedbackModal.submit", err);
      toast.error(toUserFriendlyMessage(err));
      setComposer((s) => ({ ...s, submitting: false }));
    }
  };

  const commentLen = composer.comment.length;
  const canSubmit = composer.rating >= 1 && !composer.submitting;

  if (!open) return null;

  return (
    <div className="product-feedback-modal">
      <div className="product-feedback-modal__shell">
        {composer.showSuccess ? (
          <div className="product-feedback-modal__success" role="status">
            <div className="product-feedback-modal__success-icon" aria-hidden>
              <Check className="h-6 w-6" strokeWidth={2.25} />
            </div>
            <h3 className="product-feedback-modal__success-title">{t("productReview.success.title")}</h3>
            <p className="product-feedback-modal__success-body">{t("productReview.success.body")}</p>
            <DialogClose asChild>
              <button
                type="button"
                className="product-feedback-modal__submit"
                onClick={resetComposer}
              >
                {t("productReview.modal.done")}
              </button>
            </DialogClose>
          </div>
        ) : (
          <form className="product-feedback-modal__form" onSubmit={onSubmit}>
            <header className="product-feedback-modal__header">
              <div className="product-feedback-modal__title-row">
                <span className="product-feedback-modal__title-icon" aria-hidden>
                  <MessageCircle className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
                  <SparklesDot />
                </span>
                <h2 className="product-feedback-modal__title">{t("productReview.modal.composerHeadline")}</h2>
              </div>
              <p className="product-feedback-modal__subtitle">{t("productReview.modal.composerLead")}</p>
            </header>

            <section className="product-feedback-modal__rating" aria-labelledby="pfc-rating-heading">
              <h3 id="pfc-rating-heading" className="product-feedback-modal__rating-question">
                {t("productReview.form.ratingHeading")}
              </h3>
              <div className="product-feedback-modal__stars">
                <ProductFeedbackStarRating
                  value={composer.rating}
                  onChange={(r) => setComposer((s) => ({ ...s, rating: r }))}
                  disabled={composer.submitting}
                />
              </div>
            </section>

            <section className="product-feedback-modal__comment" aria-labelledby="pfc-comment-heading">
              <div className="product-feedback-modal__comment-head">
                <h3 id="pfc-comment-heading" className="product-feedback-modal__comment-title">
                  {t("productReview.form.commentHeading")}
                </h3>
                <span className="product-feedback-modal__comment-optional">
                  {t("productReview.form.commentOptional")}
                </span>
              </div>
              <div className="product-feedback-modal__textarea-wrap">
                <Label htmlFor="pfc-comment" className="sr-only">
                  {t("productReview.form.commentLabel")}
                </Label>
                <Textarea
                  id="pfc-comment"
                  value={composer.comment}
                  onChange={(e) => setComposer((s) => ({ ...s, comment: e.target.value }))}
                  placeholder={t("productReview.form.commentPlaceholder")}
                  maxLength={PLATFORM_PRODUCT_FEEDBACK_COMMENT_MAX}
                  disabled={composer.submitting}
                  rows={5}
                  className="product-feedback-modal__textarea"
                />
                <div className="product-feedback-modal__char-count" aria-live="polite">
                  {commentLen}/{PLATFORM_PRODUCT_FEEDBACK_COMMENT_MAX}
                </div>
              </div>
            </section>

            <button
              type="submit"
              disabled={!canSubmit}
              className={cn("product-feedback-modal__submit", !canSubmit && "product-feedback-modal__submit--disabled")}
              aria-busy={composer.submitting}
            >
              {composer.submitting ? (
                <>
                  <Loader2 className="h-[1.125rem] w-[1.125rem] animate-spin" aria-hidden />
                  {t("productReview.form.submitting")}
                </>
              ) : (
                t("productReview.form.submit")
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Small sparkle accent on the feedback icon (CareTip orange). */
function SparklesDot() {
  return (
    <svg
      className="product-feedback-modal__sparkle"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M5 0.5L5.6 3.4L8.5 5L5.6 6.6L5 9.5L4.4 6.6L1.5 5L4.4 3.4L5 0.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
