import { useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchMyProductReview } from "@/app/lib/api";
import { logClientError } from "@/app/lib/clientLog";
import { useProductFeedbackModal } from "./ProductFeedbackModalContext";
import { cn } from "@/lib/utils";

type ProductFeedbackDashboardEntryProps = {
  className?: string;
  enabled?: boolean;
};

export function ProductFeedbackDashboardEntry({
  className,
  enabled = true,
}: ProductFeedbackDashboardEntryProps) {
  const { t } = useTranslation();
  const { open, openProductFeedback } = useProductFeedbackModal();
  const [hasSubmission, setHasSubmission] = useState(false);

  useEffect(() => {
    if (!enabled || open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchMyProductReview();
        if (!cancelled) setHasSubmission(Boolean(res.latest));
      } catch (err) {
        logClientError("ProductFeedbackDashboardEntry.peek", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, open]);

  if (!enabled) return null;

  return (
    <section
      className={cn("business-dashboard-block business-dashboard-block--secondary", className)}
      aria-labelledby="product-feedback-entry-heading"
    >
      <button
        type="button"
        onClick={openProductFeedback}
        className="product-feedback-entry group w-full text-left"
      >
        <div className="product-feedback-entry__glow" aria-hidden />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary transition-colors group-hover:bg-primary/15"
              aria-hidden
            >
              <MessageSquarePlus className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2
                id="product-feedback-entry-heading"
                className="text-base font-semibold tracking-tight text-foreground"
              >
                {t("productReview.entry.title")}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t("productReview.entry.subtitle")}
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-[border-color,box-shadow] group-hover:border-primary/30 group-hover:shadow-md sm:ml-4">
            {hasSubmission ? t("productReview.entry.ctaSubmitted") : t("productReview.entry.cta")}
          </span>
        </div>
      </button>
    </section>
  );
}
