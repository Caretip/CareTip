import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CountUpMetric } from "../../../dashboard/CountUpMetric";
import { businessUi } from "../../businessDashboardUi";
import {
  computeRevenueAnalytics,
  type BusinessIntelligenceInput,
} from "../../../../lib/businessIntelligence";
import { shouldShowCurrentWeekContext } from "../../../../lib/businessAnalytics/analyticsPeriodMetrics";
import type { AnalyticsTimeframe } from "../../../../hooks/useBusinessDashboardStats";
import { cn } from "@/lib/utils";

type PeriodInsightMetricsProps = {
  data: BusinessIntelligenceInput;
  timeframe: AnalyticsTimeframe;
  loading?: boolean;
  refreshing?: boolean;
  className?: string;
};

function growthHintKey(timeframe: AnalyticsTimeframe): string {
  if (timeframe === "week") return "business.team.performance.bi.growthVsPreviousWeek";
  if (timeframe === "year") return "business.team.performance.bi.growthVsPreviousYear";
  return "business.team.performance.bi.growthVsPreviousMonth";
}

/** Compact secondary KPIs — growth, average tip, optional week context. */
export const PeriodInsightMetrics = memo(function PeriodInsightMetrics({
  data,
  timeframe,
  loading,
  refreshing = false,
  className,
}: PeriodInsightMetricsProps) {
  const { t } = useTranslation();
  const revenue = useMemo(() => computeRevenueAnalytics(data), [data]);
  const showWeekContext = shouldShowCurrentWeekContext({
    timeframe,
    periodTotal: revenue.periodRevenue,
    periodCount: revenue.tipCount,
    weekTotal: revenue.weeklyRevenue,
    weekCount: data.week.tipCount,
  });
  const showPlaceholder = loading && !refreshing;

  const items = [
    {
      id: "growth",
      label: t("business.team.performance.bi.tipGrowth"),
      value: showPlaceholder
        ? "—"
        : revenue.growthComparable
          ? <CountUpMetric value={revenue.growthPercent} kind="percent" />
          : "—",
      hint: revenue.growthComparable ? t(growthHintKey(timeframe)) : t("business.team.performance.bi.noPriorPeriod"),
    },
    {
      id: "avg",
      label: t("business.team.performance.bi.avgTip"),
      value: showPlaceholder ? "—" : <CountUpMetric value={revenue.averageTip} kind="eur" />,
      hint:
        timeframe === "week"
          ? t("business.tips.analytics.cards.tipCountThisWeek", { count: revenue.tipCount })
          : timeframe === "year"
            ? t("business.tips.analytics.cards.tipCountThisYear", { count: revenue.tipCount })
            : t("business.tips.analytics.cards.tipCountThisMonth", { count: revenue.tipCount }),
    },
    ...(showWeekContext
      ? [
          {
            id: "week",
            label: t("business.team.performance.bi.currentCalendarWeek"),
            value: showPlaceholder ? (
              "—"
            ) : (
              <CountUpMetric value={revenue.weeklyRevenue} kind="eur" />
            ),
            hint: t("business.team.performance.bi.currentWeekContextHint", {
              count: data.week.tipCount,
            }),
          },
        ]
      : []),
  ];

  return (
    <div className={cn(businessUi.cardStatic, "p-4 sm:p-5", className)}>
      <h3 className={businessUi.cardTitle}>{t("business.tips.analytics.sections.periodDetail")}</h3>
      <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.id}>
            <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight">{item.value}</dd>
            <dd className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.hint}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
});
