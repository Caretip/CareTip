import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BUSINESS_CHART_AXIS,
  BUSINESS_CHART_GRID,
  getBusinessChartTooltipStyle,
} from "../businessDashboardChartTheme";
import { DASHBOARD_CHART_AREA_STROKE } from "../../dashboard/dashboardChartTheme";
import { LIGHTWEIGHT_AREA } from "../../../lib/lightweightChartProps";
import { BusinessDashboardAnalyticsEmpty } from "../BusinessDashboardAnalyticsEmpty";
import { DashboardChartSkeleton } from "../../dashboard/DashboardAnalyticsLoader";
import { CareIcon } from "@/components/icons";

type ExecutiveHealthTrendsProps = {
  tipVolume: Array<{ label: string; tips: number }>;
  loading: boolean;
};

/**
 * Daily tip volume (€) from `dailyTipDistribution` — not employee participation %.
 */
export function ExecutiveHealthTrends({ tipVolume, loading }: ExecutiveHealthTrendsProps) {
  const { t } = useTranslation();
  const hasData = tipVolume.some((r) => r.tips > 0);

  if (loading && !hasData) {
    return (
      <DashboardChartSkeleton variant="trend" minHeightClass="h-[220px] sm:h-[260px]" className="w-full" />
    );
  }

  if (!hasData) {
    return (
      <BusinessDashboardAnalyticsEmpty
        icon={<CareIcon name="analytics" size="lg" className="text-muted-foreground" />}
        title={t("emptyState.chart.title")}
        description={t("emptyState.chart.description")}
      />
    );
  }

  return (
    <div
      className="business-dashboard-chart-frame flex h-[220px] w-full min-w-0 items-center justify-center sm:h-[260px]"
      role="img"
      aria-label={t("business.team.performance.executive.tipVolumeTrendTitle")}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={tipVolume} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
          <CartesianGrid strokeDasharray="4 6" stroke={BUSINESS_CHART_GRID} vertical={false} />
          <XAxis
            dataKey="label"
            stroke={BUSINESS_CHART_AXIS}
            tickLine={false}
            axisLine={{ stroke: BUSINESS_CHART_GRID }}
            tick={{ fontSize: 11 }}
            tickMargin={8}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            stroke={BUSINESS_CHART_AXIS}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            width={40}
          />
          <Tooltip contentStyle={getBusinessChartTooltipStyle()} />
          <Area
            dataKey="tips"
            stroke={DASHBOARD_CHART_AREA_STROKE}
            fill={DASHBOARD_CHART_AREA_STROKE}
            fillOpacity={0.12}
            {...LIGHTWEIGHT_AREA}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
