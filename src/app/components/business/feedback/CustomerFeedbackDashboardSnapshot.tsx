import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CustomerFeedbackRow, CustomerFeedbackSummary } from "@/app/lib/api";
import {
  dominantFeedbackTagFromItems,
  feedbackCommentRateFromItems,
} from "@/app/lib/customerFeedbackDashboardInsights";
import { localizeFeedbackTag } from "@/app/lib/feedbackTagLabels";
import { cn } from "@/lib/utils";

type CustomerFeedbackDashboardSnapshotProps = {
  summary: CustomerFeedbackSummary;
  items: CustomerFeedbackRow[];
  className?: string;
};

export function CustomerFeedbackDashboardSnapshot({
  summary,
  items,
  className,
}: CustomerFeedbackDashboardSnapshotProps) {
  const { t } = useTranslation();
  const count = summary.feedbackCount ?? 0;
  const hasRating = summary.averageRating != null && Number.isFinite(summary.averageRating);
  if (count <= 0 || !hasRating) return null;

  const topTag = dominantFeedbackTagFromItems(items);
  const commentRate = feedbackCommentRateFromItems(items);

  return (
    <div
      className={cn("caretip-feedback-dashboard-snapshot", className)}
      aria-label={t("business.customerFeedback.dashboardSnapshotAria")}
    >
      <div className="caretip-feedback-dashboard-snapshot__item">
        <span className="caretip-feedback-dashboard-snapshot__value tabular-nums">
          {summary.averageRating!.toFixed(1)}
        </span>
        <Star className="caretip-feedback-dashboard-snapshot__star size-3.5 shrink-0 fill-primary text-primary" aria-hidden />
      </div>
      <span className="caretip-feedback-dashboard-snapshot__sep" aria-hidden />
      <p className="caretip-feedback-dashboard-snapshot__item caretip-feedback-dashboard-snapshot__meta">
        {t("business.customerFeedback.basedOnReviews", { count })}
      </p>
      {topTag ? (
        <>
          <span className="caretip-feedback-dashboard-snapshot__sep" aria-hidden />
          <p className="caretip-feedback-dashboard-snapshot__item caretip-feedback-dashboard-snapshot__meta min-w-0">
            {t("business.customerFeedback.dashboardSnapshotMostMentioned", {
              tag: localizeFeedbackTag(topTag, t),
            })}
          </p>
        </>
      ) : commentRate != null ? (
        <>
          <span className="caretip-feedback-dashboard-snapshot__sep" aria-hidden />
          <p className="caretip-feedback-dashboard-snapshot__item caretip-feedback-dashboard-snapshot__meta">
            {t("business.customerFeedback.dashboardSnapshotCommentRate", { rate: commentRate })}
          </p>
        </>
      ) : null}
    </div>
  );
}
