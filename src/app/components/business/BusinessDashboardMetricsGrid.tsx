import { memo, type ReactNode } from "react";
import { CareIcon } from "@/components/icons";
import { useTranslation } from "react-i18next";
import { BusinessStatCard } from "./BusinessStatCard";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { formatEur } from "../../lib/formatEur";
import { businessUi } from "./businessDashboardUi";
import { DASHBOARD_PERIOD_METRICS_GRID } from "../dashboard/dashboardPeriodUi";
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
  const cardsRefreshing = isPeriodRefreshing && !cardsLoading;
  const totalTips = metrics?.totalTips ?? 0;
  const tipCount = metrics?.tipCount ?? 0;
  const employeeCount = metrics?.employeeCount ?? 0;

  return (
    <div
      className={cn(
        businessUi.statsGrid,
        DASHBOARD_PERIOD_METRICS_GRID,
        "business-dashboard-stats-grid--period relative transition-opacity duration-300",
        isPeriodRefreshing && "opacity-[0.94]",
      )}
    >
      <BusinessStatCard
        featured
        loading={cardsLoading}
        refreshing={cardsRefreshing}
        refreshingLabel={refreshingLabel}
        loadingVariant="currency"
        label={
          analyticsTimeframe === "week"
            ? t("business.dashboard.statsTotalTipsWeek")
            : analyticsTimeframe === "month"
              ? t("business.dashboard.statsTotalTipsMonth")
              : t("business.dashboard.statsTotalTipsYear")
        }
        value={<CountUpMetric value={totalTips} kind="eur" />}
        change={
          hasTipActivityInPeriod
            ? t("business.dashboard.statsLiveTotals", { count: tipCount })
            : t("format.metricZeroTips")
        }
        icon={<CareIcon name="earnings" size="nav" className="dashboard-metric-stat-card__icon-glyph" />}
      />
      <BusinessStatCard
        loading={cardsLoading}
        refreshing={cardsRefreshing}
        refreshingLabel={refreshingLabel}
        label={t("business.dashboard.activeEmployees")}
        value={<CountUpMetric value={employeeCount} kind="integer" />}
        change={
          topPerformersCount > 0
            ? t("business.dashboard.activeEmployeesTopHint", { count: topPerformersCount })
            : undefined
        }
        icon={<CareIcon name="team" size="nav" className="dashboard-metric-stat-card__icon-glyph" />}
      />
      <BusinessStatCard
        loading={cardsLoading}
        refreshing={cardsRefreshing}
        refreshingLabel={refreshingLabel}
        label={t("business.dashboard.avgTipPerEmployee")}
        value={
          <CountUpMetric
            value={employeeCount > 0 ? totalTips / employeeCount : 0}
            kind="eur-whole"
          />
        }
        change={hasTipActivityInPeriod && employeeCount > 0 ? undefined : t("format.metricZeroTips")}
        icon={<CareIcon name="analytics" size="nav" className="dashboard-metric-stat-card__icon-glyph" />}
      />
    </div>
  );
}

export const BusinessDashboardMetricsGrid = memo(BusinessDashboardMetricsGridInner);
