import { memo, type ReactNode } from "react";
import { Coins, Star, Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { DashboardHeroMetricSkeleton } from "../dashboard/DashboardAnalyticsLoader";
import { formatEur } from "../../lib/formatEur";
import { useDashboardKpiProfile } from "../../hooks/useDashboardRuntimeProfile";
import { cn } from "@/lib/utils";

export type EmployeePeriodMetrics = {
  periodTipCount: number;
  periodAmountEur: number;
  goalPct: number | null;
  goalCurrent: number | null;
  goalTarget: number | null;
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
  const {
    periodTipCount,
    periodAmountEur,
    goalPct,
    goalCurrent,
    goalTarget,
    rating,
    ratingCount,
  } = metrics;
  const cardsLoading = loading;
  const cardsSettled = metricsSettledForPeriod && !cardsLoading;
  const hasGoal = cardsSettled && goalTarget != null && goalTarget > 0;
  const goalProgressAmount = hasGoal ? Math.max(0, goalCurrent ?? 0) : 0;
  const displayGoalPct = hasGoal
    ? Math.min(
        100,
        Math.max(0, goalPct ?? Math.round((goalProgressAmount / (goalTarget ?? 1)) * 100)),
      )
    : null;
  const goalRemaining = hasGoal ? Math.max(0, (goalTarget ?? 0) - goalProgressAmount) : 0;

  return (
    <div
      className={cn(
        "employee-period-summary relative w-full min-w-0 transition-opacity duration-300",
        isPeriodRefreshing && "opacity-[0.94]",
      )}
      aria-busy={cardsLoading || isPeriodRefreshing || undefined}
    >
      {isPeriodRefreshing && !cardsLoading ? (
        <p className="sr-only">{refreshingLabel}</p>
      ) : null}

      <article className="employee-period-card employee-period-card--wide">
        <p className="employee-period-card__label">
          <Coins className="employee-period-card__icon" aria-hidden />
          {t("employee.dashboard.statTotalTips")}
        </p>
        <p className="employee-period-card__value">
          {cardsLoading ? (
            <DashboardHeroMetricSkeleton variant="currency" />
          ) : (
            <CountUpMetric value={periodAmountEur} kind="eur" />
          )}
        </p>
        <p className="employee-period-card__hint">
          {cardsLoading ? null : t("employee.dashboard.periodTipsHint", { count: periodTipCount })}
        </p>
      </article>

      <article className="employee-period-card">
        <p className="employee-period-card__label">
          <Star className="employee-period-card__icon" aria-hidden />
          {t("employee.dashboard.statRatings")}
        </p>
        <p className="employee-period-card__value">
          {cardsLoading ? (
            <DashboardHeroMetricSkeleton variant="count" />
          ) : cardsSettled && rating != null ? (
            <CountUpMetric value={rating} format={(n) => n.toFixed(1)} />
          ) : cardsSettled ? (
            t("format.notAvailable")
          ) : null}
        </p>
        <p className="employee-period-card__hint">
          {cardsLoading
            ? null
            : cardsSettled
              ? t("employee.dashboard.periodRatingsHint", { count: ratingCount })
              : null}
        </p>
      </article>

      <article className="employee-period-card">
        <p className="employee-period-card__label">
          <Target className="employee-period-card__icon" aria-hidden />
          {t("employee.dashboard.statMonthlyGoal")}
        </p>
        <p className="employee-period-card__value">
          {cardsLoading ? (
            <DashboardHeroMetricSkeleton variant="count" />
          ) : hasGoal ? (
            <CountUpMetric value={displayGoalPct ?? 0} kind="percent" />
          ) : cardsSettled ? (
            t("format.notAvailable")
          ) : null}
        </p>
        <p className="employee-period-card__hint">
          {cardsLoading ? null : hasGoal ? (
            <>
              {t("employee.dashboard.goalEarned", { amount: formatEur(goalProgressAmount) })}
              <span aria-hidden>{" · "}</span>
              {t("employee.dashboard.goalRemaining", { amount: formatEur(goalRemaining) })}
            </>
          ) : cardsSettled ? (
            t("employee.dashboard.noMonthlyGoal")
          ) : null}
        </p>
      </article>
    </div>
  );
}

export const EmployeeDashboardMetricsGrid = memo(EmployeeDashboardMetricsGridInner);
