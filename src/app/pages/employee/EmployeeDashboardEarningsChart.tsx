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
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { DashboardChartSkeleton } from "../../components/dashboard/DashboardAnalyticsLoader";
import { DashboardStableChartSlot } from "../../components/dashboard/DashboardSectionLoading";
import { EmployeeEmptyState } from "../../components/employee/EmployeeEmptyState";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
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
      <Card className={cn(employeeUi.cardStatic, employeeUi.chartCard, "dashboard-chart-card w-full")}>
        <CardHeader className={employeeUi.cardHeader}>
          <CardTitle className={employeeUi.cardTitle}>{t("employee.dashboard.earningsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 overflow-x-auto overflow-y-visible pb-2">
          <DashboardStableChartSlot
            loading={showChartLoading}
            minHeightClass="min-h-[220px] sm:min-h-[260px] lg:min-h-[280px]"
            skeleton={
              <DashboardChartSkeleton variant="trend" minHeightClass="h-full min-h-0" className="h-full" />
            }
          >
            {chartData.length === 0 ? (
              <div className={cn(employeeUi.cardPad, employeeUi.chartEmpty)}>
                <EmployeeEmptyState
                  icon={<TrendingUp className="h-6 w-6" aria-hidden />}
                  title={t("emptyState.chart.title")}
                  description={t("emptyState.chart.description")}
                  className="relative z-[1] !py-10"
                />
              </div>
            ) : (
              <div
                className={cn(
                  employeeUi.chartFrame,
                  "dashboard-hero-metric-value--live flex h-[220px] w-full min-w-0 items-center justify-center sm:h-[260px] lg:h-[280px]",
                )}
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0} key={chartRenderKey}>
                  <AreaChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
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
                      width={48}
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
        </CardContent>
      </Card>
    </motion.div>
  );
});
