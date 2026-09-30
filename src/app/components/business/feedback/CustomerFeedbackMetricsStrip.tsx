import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DashboardHeroMetricSkeleton } from "@/app/components/dashboard/DashboardAnalyticsLoader";

export type CustomerFeedbackMetricItem = {
  id: string;
  label: string;
  value: ReactNode;
  hint?: string;
  featured?: boolean;
};

export function CustomerFeedbackMetricsStrip({
  items,
  loading,
  className,
}: {
  items: CustomerFeedbackMetricItem[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("caretip-feedback-metric-strip", className)}
      aria-busy={loading === true}
      role="group"
      aria-label="Feedback metrics"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "caretip-feedback-metric",
            item.featured && "caretip-feedback-metric--featured",
          )}
        >
          <p className="caretip-feedback-metric__label">{item.label}</p>
          <div className="caretip-feedback-metric__value">
            {loading ? <DashboardHeroMetricSkeleton variant="currency" /> : item.value}
          </div>
          {item.hint ? <p className="caretip-feedback-metric__hint">{item.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
