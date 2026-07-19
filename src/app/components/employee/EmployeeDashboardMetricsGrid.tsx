import { memo } from "react";
import type { ReactNode } from "react";
import { Flame, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CareIcon } from "@/components/icons";
import { EmployeeStatCard } from "./EmployeeStatCard";
import { computeEmployeeTipStreakDays } from "../../lib/employeeFormat";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { formatEur } from "../../lib/formatEur";
import { employeeUi } from "./employeeDashboardUi";
import { DASHBOARD_PERIOD_METRICS_GRID } from "../dashboard/dashboardPeriodUi";
import { useDashboardKpiProfile } from "../../hooks/useDashboardRuntimeProfile";
import { cn } from "@/lib/utils";

export type EmployeePeriodMetrics = {
  periodTipCount: number;
  periodAmountEur: number;
  goalPct: number | null;
  rating: number | null;
  ratingCount: number;
  tipStreakDays: number;
};

type EmployeeDashboardMetricsGridProps = {
  loading: boolean;
  isPeriodRefreshing: boolean;
  refreshingLabel: ReactNode;
  /** True only after the active period fetch finished (avoids empty-state flash). */
  metricsSettledForPeriod: boolean;
  metrics: EmployeePeriodMetrics;
  kpiReady?: boolean;
};

function EmployeeDashboardMetricsGridInner({
  loading,
  isPeriodRefreshing,
  refreshingLabel,
  metricsSettledForPeriod,
  metrics,
  kpiReady = false,
}: EmployeeDashboardMetricsGridProps) {
  useDashboardKpiProfile("employee", kpiReady);
  const { t } = useTranslation();
  const { periodTipCount, periodAmountEur, goalPct, rating, ratingCount, tipStreakDays } = metrics;
  const cardsLoading = loading;
  const cardsRefreshing = isPeriodRefreshing && !cardsLoading;
  const showEmptyTipsState =
    metricsSettledForPeriod && !cardsLoading && periodTipCount === 0;
  const cardsSettled = metricsSettledForPeriod && !cardsLoading;
  const showRatingValue = cardsSettled && rating != null;
  const showGoalValue = cardsSettled && goalPct != null;

  return (
    <div
      className={cn(
        employeeUi.statsGrid,
        DASHBOARD_PERIOD_METRICS_GRID,
        "employee-dashboard-stats-grid--period relative transition-opacity duration-300",
        isPeriodRefreshing && "opacity-[0.94]",
      )}
    >
      <EmployeeStatCard
        featured
        loading={cardsLoading}
        refreshing={cardsRefreshing}
        refreshingLabel={refreshingLabel}
        label={t("employee.dashboard.statTotalTips")}
        value={<CountUpMetric value={periodTipCount} kind="integer" />}
        change={
          showEmptyTipsState
            ? t("format.metricZeroTips")
            : t("employee.dashboard.statChangeEarned", {
                amount: formatEur(periodAmountEur),
              })
        }
        icon={<CareIcon name="tips" size="md" />}
      />
      <EmployeeStatCard
        loading={cardsLoading}
        refreshing={cardsRefreshing}
        refreshingLabel={refreshingLabel}
        label={
          showRatingValue
            ? t("employee.dashboard.statAvgRating")
            : t("employee.dashboard.statRatings")
        }
        value={
          showRatingValue ? (
            <CountUpMetric value={rating} format={(n) => n.toFixed(1)} />
          ) : cardsSettled ? (
            t("format.notAvailable")
          ) : null
        }
        change={
          loading
            ? undefined
            : showRatingValue
              ? t("employee.dashboard.statRatingsCount", { count: ratingCount })
              : cardsSettled
                ? t("format.metricZeroRatings")
                : undefined
        }
        icon={<Star className="h-5 w-5" aria-hidden />}
      />
      <EmployeeStatCard
        loading={cardsLoading}
        refreshing={cardsRefreshing}
        refreshingLabel={refreshingLabel}
        label={t("employee.dashboard.statMonthlyGoal")}
        value={
          showGoalValue ? (
            <CountUpMetric value={goalPct} kind="percent" />
          ) : cardsSettled ? (
            t("format.notAvailable")
          ) : null
        }
        change={
          loading
            ? undefined
            : showGoalValue
              ? t("employee.dashboard.statGoalProgressShort")
              : cardsSettled
                ? t("employee.dashboard.statGoalSetHintShort")
                : undefined
        }
        icon={<CareIcon name="goals" size="md" />}
      />
      <EmployeeStatCard
        loading={cardsLoading}
        refreshing={cardsRefreshing}
        refreshingLabel={refreshingLabel}
        label={t("employee.performance.streak")}
        value={
          cardsSettled ? t("employee.performance.streakDays", { count: tipStreakDays }) : null
        }
        change={cardsSettled ? t("employee.performance.streakHint") : undefined}
        icon={<Flame className="h-5 w-5 text-amber-600" aria-hidden />}
      />
    </div>
  );
}

export const EmployeeDashboardMetricsGrid = memo(EmployeeDashboardMetricsGridInner);
