import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { DashboardHeroMetricSkeleton } from "../dashboard/DashboardAnalyticsLoader";
import { cn } from "@/lib/utils";
import type { AnalyticsTimeframe } from "../../hooks/useBusinessDashboardStats";
import { useDashboardKpiProfile } from "../../hooks/useDashboardRuntimeProfile";

export type BusinessDashboardMetrics = {
  totalTips: number;
  tipCount: number;
  employeeCount: number;
};

type BusinessDashboardMetricsGridProps = {
  analyticsTimeframe: AnalyticsTimeframe;
  metrics: BusinessDashboardMetrics | null;
  loading: boolean;
  isPeriodRefreshing: boolean;
  refreshingLabel: ReactNode;
  hasTipActivityInPeriod: boolean;
  topPerformersCount: number;
  /** When true, records first_kpi + KpiSurface probe for this memoized surface only. */
  kpiReady?: boolean;
};

function BusinessDashboardMetricsGridInner({
  analyticsTimeframe,
  metrics,
  loading,
  isPeriodRefreshing,
  refreshingLabel,
  hasTipActivityInPeriod,
  topPerformersCount,
  kpiReady = false,
}: BusinessDashboardMetricsGridProps) {
  useDashboardKpiProfile("business", kpiReady);
  const { t } = useTranslation();
  const cardsLoading = loading || metrics == null;
  const totalTips = metrics?.totalTips ?? 0;
  const tipCount = metrics?.tipCount ?? 0;
  const employeeCount = metrics?.employeeCount ?? 0;

  const totalLabel =
    analyticsTimeframe === "week"
      ? t("business.dashboard.statsTotalTipsWeek")
      : analyticsTimeframe === "month"
        ? t("business.dashboard.statsTotalTipsMonth")
        : t("business.dashboard.statsTotalTipsYear");

  return (
    <div
      className={cn(
        "business-period-summary business-dashboard-stats-grid--period relative w-full min-w-0 transition-opacity duration-300",
        isPeriodRefreshing && "opacity-[0.94]",
      )}
      aria-busy={cardsLoading || isPeriodRefreshing || undefined}
    >
      {isPeriodRefreshing && !cardsLoading ? (
        <p className="sr-only">{refreshingLabel}</p>
      ) : null}

      <div className="business-period-summary__row">
        <div className="business-period-summary__metric business-period-summary__metric--primary">
          <p className="business-period-summary__label">{totalLabel}</p>
          <p className="business-period-summary__value">
            {cardsLoading ? (
              <DashboardHeroMetricSkeleton variant="currency" />
            ) : (
              <CountUpMetric value={totalTips} kind="eur" />
            )}
          </p>
          <p className="business-period-summary__hint">
            {cardsLoading
              ? null
              : hasTipActivityInPeriod
                ? t("business.dashboard.statsLiveTotals", { count: tipCount })
                : t("format.metricZeroTips")}
          </p>
        </div>

        <div className="business-period-summary__metric">
          <p className="business-period-summary__label">{t("business.dashboard.activeEmployees")}</p>
          <p className="business-period-summary__value">
            {cardsLoading ? (
              <DashboardHeroMetricSkeleton variant="count" />
            ) : (
              <CountUpMetric value={employeeCount} kind="integer" />
            )}
          </p>
          <p className="business-period-summary__hint">
            {cardsLoading
              ? null
              : topPerformersCount > 0
                ? t("business.dashboard.activeEmployeesTopHint", { count: topPerformersCount })
                : null}
          </p>
        </div>

        <div className="business-period-summary__metric">
          <p className="business-period-summary__label">{t("business.dashboard.avgTipPerEmployee")}</p>
          <p className="business-period-summary__value">
            {cardsLoading ? (
              <DashboardHeroMetricSkeleton variant="currency" />
            ) : (
              <CountUpMetric
                value={employeeCount > 0 ? totalTips / employeeCount : 0}
                kind="eur-whole"
              />
            )}
          </p>
          <p className="business-period-summary__hint">
            {cardsLoading || (hasTipActivityInPeriod && employeeCount > 0)
              ? null
              : t("format.metricZeroTips")}
          </p>
        </div>
      </div>
    </div>
  );
}

export const BusinessDashboardMetricsGrid = memo(BusinessDashboardMetricsGridInner);
