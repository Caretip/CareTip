import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { platformUi } from "./platformDashboardUi";

export type PlatformOverviewMetric = {
  label: string;
  value: string;
};

type PlatformOverviewTeaserCardProps = {
  title: string;
  description?: string;
  metrics: PlatformOverviewMetric[];
  viewAllHref: string;
  viewAllLabel: string;
  children?: React.ReactNode;
  className?: string;
  compact?: boolean;
  /** Section-level loading — metrics pulse independently of other overview stages. */
  loading?: boolean;
};

export function PlatformOverviewTeaserCard({
  title,
  description,
  metrics,
  viewAllHref,
  viewAllLabel,
  children,
  className,
  compact = true,
  loading = false,
}: PlatformOverviewTeaserCardProps) {
  const showMetricPlaceholders = loading && metrics.length === 0;
  const metricItems = showMetricPlaceholders
    ? [
        { label: "…", value: "—" },
        { label: "…", value: "—" },
        { label: "…", value: "—" },
      ]
    : metrics;

  return (
    <section className={cn(platformUi.overviewTeaserCard, "flex h-full min-h-[12rem] flex-col", className)}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">{title}</h2>
          {!compact && description ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">{description}</p>
          ) : null}
        </div>
        <Link to={viewAllHref} className="dashboard-view-all-link">
          <span>{viewAllLabel}</span>
          <ArrowRight className="dashboard-view-all-link__icon" strokeWidth={2} aria-hidden />
        </Link>
      </div>

      {metricItems.length > 0 ? (
        <div
          className={cn(
            "grid gap-3 sm:gap-4",
            metricItems.length <= 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3",
            children || loading ? "mb-5" : "",
          )}
        >
          {metricItems.map((metric, i) => (
            <div
              key={`${metric.label}-${i}`}
              className={cn(
                "platform-overview-teaser-metric rounded-lg border border-border/80 bg-muted/15",
                loading && "animate-pulse",
              )}
            >
              <p className="platform-overview-teaser-metric__label">{metric.label}</p>
              <p className="platform-overview-teaser-metric__value tabular-nums text-foreground">
                {loading && !showMetricPlaceholders ? "—" : metric.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {children ? (
        <div className={cn("min-w-0 flex-1 border-t border-border/60 pt-4", loading && "animate-pulse opacity-70")}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
