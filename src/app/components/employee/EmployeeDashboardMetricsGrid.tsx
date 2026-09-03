import { memo, type ReactNode } from "react";
import { Flame } from "lucide-react";
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
    tipStreakDays,
  } = metrics;
  const cardsLoading = loading;
  const cardsSettled = metricsSettledForPeriod && !cardsLoading;
  const hasGoal = cardsSettled && goalTarget != null && goalTarget > 0;
  const goalProgressAmount = hasGoal ? Math.max(0, goalCurrent ?? 0) : 0;
  const goalHasProgress = hasGoal && goalProgressAmount > 0.005;
  const displayGoalPct = hasGoal
    ? Math.min(
        100,
        Math.max(0, goalPct ?? Math.round((goalProgressAmount / (goalTarget ?? 1)) * 100)),
      )
    : null;
  const showShortGoalBar = goalHasProgress && displayGoalPct != null && displayGoalPct > 0;
  const goalHint = hasGoal
    ? goalHasProgress
      ? `${formatEur(goalProgressAmount)} / ${formatEur(goalTarget ?? 0)}`
      : t("employee.dashboard.goalAmountCaption", { amount: formatEur(goalTarget ?? 0) })
    : null;

  return (
    <div
      className={cn(
        "employee-dashboard-stats-grid employee-period-summary relative w-full min-w-0 transition-opacity duration-300",
        isPeriodRefreshing && "opacity-[0.94]",
      )}
      aria-busy={cardsLoading || isPeriodRefreshing || undefined}
    >
      {isPeriodRefreshing && !cardsLoading ? (
        <p className="sr-only">{refreshingLabel}</p>
      ) : null}

      <div className="employee-period-summary__row">
        <div className="employee-period-summary__metric">
          <p className="employee-period-summary__label">{t("employee.dashboard.statTotalTips")}</p>
          <p className="employee-period-summary__value">
            {cardsLoading ? (
              <DashboardHeroMetricSkeleton variant="currency" />
            ) : (
              <CountUpMetric value={periodAmountEur} kind="eur" />
            )}
          </p>
          <p className="employee-period-summary__hint">
            {cardsLoading ? null : t("employee.dashboard.periodTipsHint", { count: periodTipCount })}
          </p>
        </div>

        <div className="employee-period-summary__metric">
          <p className="employee-period-summary__label">{t("employee.dashboard.statRatings")}</p>
          <p className="employee-period-summary__value">
            {cardsLoading ? (
              <DashboardHeroMetricSkeleton variant="count" />
            ) : cardsSettled && rating != null ? (
              <CountUpMetric value={rating} format={(n) => n.toFixed(1)} />
            ) : cardsSettled ? (
              t("format.notAvailable")
            ) : null}
          </p>
          <p className="employee-period-summary__hint">
            {cardsLoading
              ? null
              : cardsSettled
                ? t("employee.dashboard.periodRatingsHint", { count: ratingCount })
                : null}
          </p>
        </div>

        <div className="employee-period-summary__metric">
          <p className="employee-period-summary__label">{t("employee.dashboard.statMonthlyGoal")}</p>
          <p className="employee-period-summary__value">
            {cardsLoading ? (
              <DashboardHeroMetricSkeleton variant="count" />
            ) : hasGoal ? (
              <CountUpMetric value={displayGoalPct ?? 0} kind="percent" />
            ) : cardsSettled ? (
              t("format.notAvailable")
            ) : null}
          </p>
          <p className="employee-period-summary__hint">
            {cardsLoading ? null : hasGoal ? goalHint : cardsSettled ? t("employee.dashboard.noMonthlyGoal") : null}
          </p>
          {showShortGoalBar ? (
            <div
              className="employee-period-summary__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={displayGoalPct ?? 0}
              aria-label={t("employee.dashboard.statMonthlyGoal")}
            >
              <div
                className="employee-period-summary__bar-fill"
                style={{ width: `${displayGoalPct ?? 0}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {cardsSettled ? (
        <div className="employee-period-summary__streak">
          <p className="employee-period-summary__streak-line">
            <Flame className="employee-period-summary__streak-icon" aria-hidden />
            <span>
              <strong>{t("employee.performance.streakDays", { count: tipStreakDays })}</strong>
              <span className="employee-period-summary__streak-label">
                {t("employee.dashboard.streakLabel")}
              </span>
            </span>
          </p>
          <p className="employee-period-summary__streak-hint">{t("employee.performance.streakHint")}</p>
        </div>
      ) : cardsLoading ? (
        <div className="employee-period-summary__streak" aria-hidden>
          <span className="dashboard-hero-metric-skeleton__sub" />
        </div>
      ) : null}
    </div>
  );
}

export const EmployeeDashboardMetricsGrid = memo(EmployeeDashboardMetricsGridInner);
