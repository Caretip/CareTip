import { memo } from "react";
import { motion } from "motion/react";
import { TrendingUp } from "lucide-react";
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
import { dashboardBlockMotion } from "@/lib/motionPerf";
import { formatEur } from "../../lib/formatEur";
import { cn } from "@/lib/utils";
import { DashboardChartSkeleton } from "../../components/dashboard/DashboardAnalyticsLoader";
import { DashboardStableChartSlot } from "../../components/dashboard/DashboardSectionLoading";
import { EmployeeEmptyState } from "../../components/employee/EmployeeEmptyState";
import {
  DASHBOARD_CHART_AXIS,
  DASHBOARD_CHART_GRID,
  DASHBOARD_CHART_AREA_STROKE,
  getDashboardChartTooltipStyle,
} from "../../components/dashboard/dashboardChartTheme";
import { LIGHTWEIGHT_AREA } from "../../lib/lightweightChartProps";

export type EmployeeDashboardEarningsChartProps = {
  showChartLoading: boolean;
  chartData: Array<{ time: string; amount: number }>;
  analyticsPeriodRefreshing: boolean;
  chartRenderKey?: string | number;
};

export const EmployeeDashboardEarningsChart = memo(function EmployeeDashboardEarningsChart({
  showChartLoading,
  chartData,
  analyticsPeriodRefreshing,
  chartRenderKey = "employee-earnings",
}: EmployeeDashboardEarningsChartProps) {
  const { t } = useTranslation();

  return (
    <motion.div
      {...dashboardBlockMotion}
      className={cn(
        "dashboard-swr-swap",
        analyticsPeriodRefreshing && "dashboard-swr-swap--revalidating",
      )}
      transition={{ delay: 0.4 }}
    >
      <section
        className="employee-period-chart w-full min-w-0"
        aria-labelledby="employee-earnings-chart-heading"
      >
        <h3 id="employee-earnings-chart-heading" className="employee-period-chart__title">
          {t("employee.dashboard.earningsTitle")}
        </h3>
        <DashboardStableChartSlot
          loading={showChartLoading}
          minHeightClass="min-h-[200px] sm:min-h-[236px] lg:min-h-[248px]"
          skeleton={
            <DashboardChartSkeleton variant="trend" minHeightClass="h-full min-h-0" className="h-full" />
          }
        >
          {chartData.length === 0 ? (
            <div className="employee-period-chart__empty dashboard-chart-empty">
              <EmployeeEmptyState
                compact
                icon={<TrendingUp className="h-4 w-4" aria-hidden />}
                title={t("emptyState.chart.title")}
                description={t("emptyState.chart.description")}
                className="relative z-[1] !py-6 sm:!py-8"
              />
            </div>
          ) : (
            <div
              className={cn(
                "flex h-[200px] w-full min-w-0 items-center justify-center sm:h-[236px] lg:h-[248px]",
              )}
            >
              <ResponsiveContainer width="100%" height="100%" minWidth={0} key={chartRenderKey}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 6" stroke={DASHBOARD_CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="time"
                    stroke={DASHBOARD_CHART_AXIS}
                    tickLine={false}
                    axisLine={{ stroke: DASHBOARD_CHART_GRID }}
                    tick={{ fontSize: 11 }}
                    tickMargin={8}
                    interval="preserveStartEnd"
                    minTickGap={28}
                    padding={{ left: 4, right: 4 }}
                  />
                  <YAxis
                    stroke={DASHBOARD_CHART_AXIS}
                    tickLine={false}
                    axisLine={false}
                    style={{ fontSize: "11px" }}
                    tickMargin={8}
                    width={44}
                  />
                  <Tooltip
                    formatter={(value: number) => [formatEur(Number(value)), t("charts.tooltip.earnings")]}
                    contentStyle={getDashboardChartTooltipStyle()}
                  />
                  <Area
                    dataKey="amount"
                    stroke={DASHBOARD_CHART_AREA_STROKE}
                    fill="hsl(var(--primary) / 0.12)"
                    {...LIGHTWEIGHT_AREA}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </DashboardStableChartSlot>
      </section>
    </motion.div>
  );
});
