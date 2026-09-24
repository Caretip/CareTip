import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { caretipType } from "@/lib/typography/caretipType";
import { dashboardWorkspaceUi } from "./dashboardWorkspaceUi";
import { DashboardHeroMetricSkeleton } from "./DashboardAnalyticsLoader";

export type DashboardWorkspaceSummaryMetric = {
  label: string;
  value: ReactNode;
  trend?: ReactNode;
  trendDirection?: "up" | "down" | "neutral";
};

export type DashboardWorkspaceSummaryCardProps = {
  title?: string;
  eyebrow?: ReactNode;
  periodLabel?: string;
  metrics: DashboardWorkspaceSummaryMetric[];
  footer?: ReactNode;
  className?: string;
  variant?: "banner" | "health";
  loading?: boolean;
};

function TrendIcon({ direction }: { direction?: "up" | "down" | "neutral" }) {
  if (direction === "up") return <TrendingUp className="mr-1 inline h-3.5 w-3.5" aria-hidden />;
  if (direction === "down") return <TrendingDown className="mr-1 inline h-3.5 w-3.5" aria-hidden />;
  return null;
}

/** Compact analytics / health summary — workspace card system. */
export function DashboardWorkspaceSummaryCard({
  title,
  eyebrow,
  periodLabel,
  metrics,
  footer,
  className,
  variant = "banner",
  loading = false,
}: DashboardWorkspaceSummaryCardProps) {
  return (
    <section
      className={cn(dashboardWorkspaceUi.card, dashboardWorkspaceUi.cardPad, className)}
      aria-label={title}
    >
      {(title || eyebrow || periodLabel) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {eyebrow ? <div className="text-sm text-muted-foreground">{eyebrow}</div> : null}
            {title ? <h2 className={dashboardWorkspaceUi.sectionTitle}>{title}</h2> : null}
          </div>
          {periodLabel ? <span className={dashboardWorkspaceUi.eyebrow}>{periodLabel}</span> : null}
        </div>
      )}

      <div
        className={cn(
          "grid gap-3",
          variant === "health" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 sm:px-3.5 sm:py-3"
          >
            <p className={cn(caretipType.kpiLabel, "line-clamp-2")}>{metric.label}</p>
            <div className={cn(caretipType.kpiValue, "mt-1 tabular-nums")}>
              {loading ? <DashboardHeroMetricSkeleton variant="currency" /> : metric.value}
            </div>
            {metric.trend ? (
              <p
                className={cn(
                  "mt-1 line-clamp-2 text-xs text-muted-foreground",
                  metric.trendDirection === "up" && "text-emerald-700 dark:text-emerald-400",
                  metric.trendDirection === "down" && "text-amber-800 dark:text-amber-300",
                )}
              >
                <TrendIcon direction={metric.trendDirection} />
                {metric.trend}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {footer ? (
        <div className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">{footer}</div>
      ) : null}
    </section>
  );
}
