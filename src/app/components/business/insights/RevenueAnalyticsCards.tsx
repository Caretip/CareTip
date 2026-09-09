import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Coins, TrendingUp } from "lucide-react";
import { BusinessStatCard } from "../BusinessStatCard";
import { CountUpMetric } from "../../dashboard/CountUpMetric";
import { businessUi } from "../businessDashboardUi";
import { cn } from "@/lib/utils";
import {
  computeRevenueAnalytics,
  type BusinessIntelligenceInput,
} from "../../../lib/businessIntelligence";
import { shouldShowCurrentWeekContext } from "../../../lib/businessAnalytics/analyticsPeriodMetrics";
import type { AnalyticsTimeframe } from "../../../hooks/useBusinessDashboardStats";

type RevenueAnalyticsCardsProps = {
  data: BusinessIntelligenceInput;
  timeframe?: AnalyticsTimeframe;
  variant?: "full" | "detail";
  loading: boolean;
  refreshing?: boolean;
  refreshingLabel?: string;
  showHeading?: boolean;
};

function growthHintKey(timeframe: AnalyticsTimeframe): string {
  if (timeframe === "week") return "business.team.performance.bi.growthVsPreviousWeek";
  if (timeframe === "year") return "business.team.performance.bi.growthVsPreviousYear";
  return "business.team.performance.bi.growthVsPreviousMonth";
}

function PeriodMetric({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 text-foreground/80">
          {icon}
        </span>
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

export function RevenueAnalyticsCards({
  data,
  timeframe = "month",
  variant = "full",
  loading,
  refreshing = false,
  refreshingLabel,
  showHeading = true,
}: RevenueAnalyticsCardsProps) {
  const { t } = useTranslation();
  const revenue = useMemo(() => computeRevenueAnalytics(data), [data]);
  const showWeekContext = shouldShowCurrentWeekContext({
    timeframe,
    periodTotal: revenue.periodRevenue,
    periodCount: revenue.tipCount,
    weekTotal: revenue.weeklyRevenue,
    weekCount: data.week.tipCount,
  });
  const tipCountHint =
    timeframe === "week"
      ? t("business.tips.analytics.cards.tipCountThisWeek", { count: revenue.tipCount })
      : timeframe === "year"
        ? t("business.tips.analytics.cards.tipCountThisYear", { count: revenue.tipCount })
        : t("business.tips.analytics.cards.tipCountThisMonth", { count: revenue.tipCount });
  const growthHint = revenue.growthComparable
    ? t(growthHintKey(timeframe))
    : t("business.team.performance.bi.noPriorPeriod");

  if (variant === "detail") {
    return (
      <section className="space-y-3">
        {showHeading ? (
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("business.team.performance.bi.revenueTitle")}
          </h2>
        ) : null}
        <div
          className={cn(
            "grid gap-8 sm:grid-cols-2",
            showWeekContext ? "lg:grid-cols-3" : "lg:grid-cols-2",
          )}
        >
          <PeriodMetric
            label={t("business.team.performance.bi.tipGrowth")}
            icon={<TrendingUp className="h-4 w-4" aria-hidden />}
            value={
              loading && !refreshing ? (
                "—"
              ) : revenue.growthComparable ? (
                <CountUpMetric value={revenue.growthPercent} kind="percent" />
              ) : (
                "—"
              )
            }
            hint={growthHint}
          />
          <PeriodMetric
            label={t("business.team.performance.bi.avgTip")}
            icon={<Coins className="h-4 w-4" aria-hidden />}
            value={
              loading && !refreshing ? "—" : <CountUpMetric value={revenue.averageTip} kind="eur" />
            }
            hint={tipCountHint}
          />
          {showWeekContext ? (
            <PeriodMetric
              label={t("business.team.performance.bi.currentCalendarWeek")}
              icon={<CalendarDays className="h-4 w-4" aria-hidden />}
              value={
                loading && !refreshing ? (
                  "—"
                ) : (
                  <CountUpMetric value={revenue.weeklyRevenue} kind="eur" />
                )
              }
              hint={t("business.team.performance.bi.currentWeekContextHint", {
                count: data.week.tipCount,
              })}
            />
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {showHeading ? (
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("business.team.performance.bi.revenueTitle")}
        </h2>
      ) : null}
      <div className={cn(businessUi.statsGrid, "lg:grid-cols-3")}>
        <BusinessStatCard
          featured
          loading={loading}
          refreshing={refreshing}
          refreshingLabel={refreshingLabel}
          loadingVariant="currency"
          label={t("business.team.performance.bi.totalTips")}
          value={<CountUpMetric value={revenue.totalTips} kind="eur" />}
          change={tipCountHint}
          icon={<Coins className="h-5 w-5" aria-hidden />}
        />
        <BusinessStatCard
          loading={loading}
          refreshing={refreshing}
          refreshingLabel={refreshingLabel}
          label={t("business.team.performance.bi.tipGrowth")}
          value={
            revenue.growthComparable ? (
              <CountUpMetric value={revenue.growthPercent} kind="percent" />
            ) : (
              "—"
            )
          }
          change={growthHint}
          icon={<TrendingUp className="h-5 w-5" aria-hidden />}
        />
        <BusinessStatCard
          loading={loading}
          refreshing={refreshing}
          refreshingLabel={refreshingLabel}
          label={t("business.team.performance.bi.avgTip")}
          value={<CountUpMetric value={revenue.averageTip} kind="eur" />}
          icon={<Coins className="h-5 w-5" aria-hidden />}
        />
      </div>
    </section>
  );
}
