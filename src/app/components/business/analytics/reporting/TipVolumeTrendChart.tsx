import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardChartSkeleton } from "../../../dashboard/DashboardAnalyticsLoader";
import { DashboardStableChartSlot } from "../../../dashboard/DashboardSectionLoading";
import { BusinessDashboardAnalyticsEmpty } from "../../BusinessDashboardAnalyticsEmpty";
import { businessUi } from "../../businessDashboardUi";
import {
  BUSINESS_CHART_AXIS,
  BUSINESS_CHART_GRID,
  getBusinessChartTooltipStyle,
} from "../../businessDashboardChartTheme";
import { DASHBOARD_CHART_AREA_STROKE } from "../../../dashboard/dashboardChartTheme";
import { LIGHTWEIGHT_AREA } from "../../../../lib/lightweightChartProps";
import {
  hasTipPerformanceChartActivity,
  resolveTipPerformanceChartRows,
  type TipPerformanceChartRow,
} from "../../../../lib/businessDashboardChartData";
import { formatEur } from "../../../../lib/formatEur";
import { resolveBusinessTimezone, venueLocalTodayKey } from "../../../../lib/businessVenueTime";
import type { AnalyticsTimeframe } from "../../../../hooks/useBusinessDashboardStats";
import { cn } from "@/lib/utils";
import { CareIcon } from "@/components/icons";

const CHART_MIN = "min-h-[220px] sm:min-h-[260px]";

type TipVolumeTrendChartProps = {
  rows: Array<{ day: string; amount: number }>;
  timeframe: AnalyticsTimeframe;
  periodTotalTips: number;
  loading?: boolean;
  title: string;
  className?: string;
};

export const TipVolumeTrendChart = memo(function TipVolumeTrendChart({
  rows,
  timeframe,
  periodTotalTips,
  loading,
  title,
  className,
}: TipVolumeTrendChartProps) {
  const { t } = useTranslation();

  const chartData = useMemo((): TipPerformanceChartRow[] | null => {
    const venueDayOfMonth = Number(venueLocalTodayKey(resolveBusinessTimezone()).slice(8, 10)) || undefined;
    return resolveTipPerformanceChartRows({
      rows,
      timeframe,
      t,
      periodTotalTips,
      venueDayOfMonth,
    });
  }, [rows, timeframe, t, periodTotalTips]);

  const series = chartData ?? [];
  const empty = !hasTipPerformanceChartActivity(series, periodTotalTips);

  const tipAxisMinTickGap = timeframe === "year" ? 36 : timeframe === "month" ? 24 : 16;

  return (
    <section className={cn("business-period-chart business-dashboard-chart-card w-full min-w-0", className)}>
      <h2 className="business-period-chart__title">{title}</h2>
      <DashboardStableChartSlot
        loading={Boolean(loading)}
        minHeightClass={CHART_MIN}
        contentMinHeightClass={empty ? "min-h-0" : CHART_MIN}
        skeleton={<DashboardChartSkeleton minHeightClass="h-full min-h-0" className="h-full" />}
      >
        {empty ? (
          <BusinessDashboardAnalyticsEmpty
            icon={<CareIcon name="analytics" size="lg" className="text-muted-foreground" />}
            title={t("emptyState.chart.title")}
            description={t("emptyState.chart.description")}
          />
        ) : (
          <div
            className="business-dashboard-chart-frame flex h-[220px] w-full min-w-0 items-center justify-center sm:h-[260px]"
            role="img"
            aria-label={title}
          >
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={series} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
                <CartesianGrid strokeDasharray="4 6" stroke={BUSINESS_CHART_GRID} vertical={false} />
                <XAxis
                  dataKey="dayLabel"
                  stroke={BUSINESS_CHART_AXIS}
                  tickLine={false}
                  axisLine={{ stroke: BUSINESS_CHART_GRID }}
                  tick={{ fontSize: 11 }}
                  tickMargin={8}
                  interval="preserveStartEnd"
                  minTickGap={tipAxisMinTickGap}
                />
                <YAxis
                  stroke={BUSINESS_CHART_AXIS}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  width={48}
                  tickFormatter={(v) => (v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v}`)}
                />
                <Tooltip
                  contentStyle={getBusinessChartTooltipStyle()}
                  formatter={(value: number) => [formatEur(value), t("business.tips.analytics.cards.tipVolume")]}
                  labelFormatter={(label) => String(label)}
                />
                <Area
                  dataKey="amount"
                  stroke={DASHBOARD_CHART_AREA_STROKE}
                  fill={DASHBOARD_CHART_AREA_STROKE}
                  fillOpacity={0.12}
                  {...LIGHTWEIGHT_AREA}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </DashboardStableChartSlot>
      <p className="sr-only">
        {t("business.tips.analytics.cards.tipVolume")}: {formatEur(periodTotalTips)}
      </p>
    </section>
  );
});
