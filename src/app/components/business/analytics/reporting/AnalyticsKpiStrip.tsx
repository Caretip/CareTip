import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { businessUi } from "../../businessDashboardUi";

export type AnalyticsKpiItem = {
  id: string;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  trend?: ReactNode;
  trendDirection?: "up" | "down" | "neutral";
};

type AnalyticsKpiStripProps = {
  items: AnalyticsKpiItem[];
  loading?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function AnalyticsKpiStrip({ items, loading, className, ariaLabel }: AnalyticsKpiStripProps) {
  return (
    <section
      className={cn("business-analytics-kpi-strip", className)}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5 sm:px-3.5 sm:py-3"
          >
            <p className={cn(businessUi.atAGlanceStatLabel, "mb-1 line-clamp-2")}>{item.label}</p>
            <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground sm:text-xl">
              {item.value}
            </p>
            {item.trend ? (
              <p
                className={cn(
                  "mt-0.5 text-[11px] leading-snug tabular-nums",
                  item.trendDirection === "up" && "text-emerald-600 dark:text-emerald-400",
                  item.trendDirection === "down" && "text-amber-700 dark:text-amber-400",
                  (!item.trendDirection || item.trendDirection === "neutral") && "text-muted-foreground",
                )}
              >
                {item.trend}
              </p>
            ) : item.hint ? (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.hint}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
