import { memo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Users, TrendingUp } from "lucide-react";
import { DashboardViewAllLink } from "../../components/dashboard/DashboardViewAllLink";
import { TOP_PERFORMERS_PAGE_PATH } from "../../components/business/insights/TopPerformersTeaser";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CareIcon } from "@/components/icons";
import { useDashboardBlockMotion } from "@/lib/motionPerf";
import { formatEur } from "../../lib/formatEur";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { DashboardChartSkeleton } from "../../components/dashboard/DashboardAnalyticsLoader";
import {
  DashboardStableChartSlot,
  DeferredContentFade,
} from "../../components/dashboard/DashboardSectionLoading";
import { BusinessDashboardAnalyticsEmpty } from "../../components/business/BusinessDashboardAnalyticsEmpty";
import { businessUi } from "../../components/business/businessDashboardUi";
import {
  BUSINESS_CHART_AXIS,
  BUSINESS_CHART_GRID,
  businessChartBarFill,
  getBusinessChartTooltipStyle,
} from "../../components/business/businessDashboardChartTheme";
import { DASHBOARD_CHART_AREA_STROKE } from "../../components/dashboard/dashboardChartTheme";
import { CHART_ANIMATION_OFF, LIGHTWEIGHT_AREA, LIGHTWEIGHT_BAR } from "../../lib/lightweightChartProps";
import type {
  EmployeePerformanceChartRow,
  TipPerformanceChartRow,
} from "../../lib/businessDashboardChartData";

export type BusinessDashboardAnalyticsChartsProps = {
  showChartsLoading: boolean;
  hasTipActivityInPeriod: boolean;
  tipDistributionChartData: TipPerformanceChartRow[];
  tipDistributionTotal: number;
  employeePerformance: EmployeePerformanceChartRow[];
  employeeCount: number;
  analyticsTimeframe: "week" | "month" | "year";
  chartRenderKey?: string | number;
};

const CHART_SLOT_MIN_HEIGHT = "min-h-[260px] sm:min-h-[290px]";
const CHART_SLOT_EMPTY_MIN_HEIGHT = "min-h-0";

export const BusinessDashboardAnalyticsCharts = memo(function BusinessDashboardAnalyticsCharts({
  showChartsLoading,
  hasTipActivityInPeriod,
  tipDistributionChartData,
  tipDistributionTotal,
  employeePerformance,
  employeeCount,
  analyticsTimeframe,
  chartRenderKey = "business-analytics",
}: BusinessDashboardAnalyticsChartsProps) {
  const { t } = useTranslation();
  const tipsChartMotion = useDashboardBlockMotion(0.12);
  const employeeChartMotion = useDashboardBlockMotion(0.18);

  /** Let Recharts drop overlapping ticks by width (year months / dense month days). */
  const tipAxisMinTickGap =
    analyticsTimeframe === "year" ? 36 : analyticsTimeframe === "month" ? 24 : 16;

  const tipsChartEmpty = !hasTipActivityInPeriod;
  const employeeChartEmpty =
    employeeCount === 0 || !hasTipActivityInPeriod || employeePerformance.length === 0;

  return (
    <div className={businessUi.analyticsChartsGrid}>
      <motion.div
        {...tipsChartMotion}
        className="flex h-full min-h-0 w-full"
      >
        <Card className={cn(businessUi.cardStatic, "business-dashboard-chart-card business-dashboard-panel-card w-full")}>
          <CardHeader className="business-dashboard-panel-card__header">
            <CardTitle className="text-lg leading-snug">{t("business.dashboard.tipsPerformanceTitle")}</CardTitle>
          </CardHeader>
          <CardContent
            className={cn(
              "business-dashboard-panel-card__content min-w-0 flex-1 overflow-x-auto overflow-y-visible transition-opacity duration-300",
            )}
          >
            <DashboardStableChartSlot
              loading={showChartsLoading}
              minHeightClass={CHART_SLOT_MIN_HEIGHT}
              contentMinHeightClass={tipsChartEmpty ? CHART_SLOT_EMPTY_MIN_HEIGHT : CHART_SLOT_MIN_HEIGHT}
              skeleton={<DashboardChartSkeleton minHeightClass="h-full min-h-0" className="h-full" />}
            >
              {tipsChartEmpty ? (
                <BusinessDashboardAnalyticsEmpty
                  icon={<CareIcon name="analytics" size="lg" className="text-muted-foreground" />}
                  title={t("emptyState.chart.title")}
                  description={t("emptyState.chart.description")}
                />
              ) : (
                <DeferredContentFade show={!showChartsLoading}>
                  <div className="business-dashboard-chart-frame flex h-[260px] w-full min-w-0 items-center justify-center sm:h-[290px]">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} key={`${chartRenderKey}-tips`}>
                      <AreaChart
                        data={tipDistributionChartData}
                        margin={{ top: 12, right: 12, left: 4, bottom: 8 }}
                      >
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
                          padding={{ left: 4, right: 4 }}
                        />
                        <YAxis
                          stroke={BUSINESS_CHART_AXIS}
                          tickLine={false}
                          axisLine={false}
                          style={{ fontSize: "11px" }}
                          tickMargin={8}
                          width={48}
                        />
                        <Tooltip
                          formatter={(value: number) => [formatEur(Number(value)), t("charts.tooltip.tips")]}
                          contentStyle={getBusinessChartTooltipStyle()}
                          cursor={{ stroke: "hsl(var(--primary) / 0.2)", strokeWidth: 1 }}
                        />
                        <Area
                          dataKey="amount"
                          stroke={DASHBOARD_CHART_AREA_STROKE}
                          fill="hsl(var(--primary) / 0.12)"
                          activeDot={{ r: 4, strokeWidth: 0 }}
                          {...LIGHTWEIGHT_AREA}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </DeferredContentFade>
              )}
            </DashboardStableChartSlot>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        {...employeeChartMotion}
        className="flex h-full min-h-0 w-full"
      >
        <Card className={cn(businessUi.cardStatic, "business-dashboard-chart-card business-dashboard-panel-card w-full")}>
          <CardHeader className="business-dashboard-panel-card__header">
            <div className="flex w-full min-w-0 items-start justify-between gap-3">
              <CardTitle className="text-lg leading-snug">{t("business.dashboard.employeePerformanceTitle")}</CardTitle>
              {!employeeChartEmpty ? (
                <DashboardViewAllLink to={TOP_PERFORMERS_PAGE_PATH}>
                  {t("business.dashboard.viewAllTopPerformers")}
                </DashboardViewAllLink>
              ) : null}
            </div>
          </CardHeader>
          <CardContent
            className={cn(
              "business-dashboard-panel-card__content min-w-0 flex-1 overflow-x-auto overflow-y-visible transition-opacity duration-300",
            )}
          >
            <DashboardStableChartSlot
              loading={showChartsLoading}
              minHeightClass={CHART_SLOT_MIN_HEIGHT}
              contentMinHeightClass={employeeChartEmpty ? CHART_SLOT_EMPTY_MIN_HEIGHT : CHART_SLOT_MIN_HEIGHT}
              skeleton={<DashboardChartSkeleton minHeightClass="h-full min-h-0" className="h-full" />}
            >
              {employeeCount === 0 ? (
                <BusinessDashboardAnalyticsEmpty
                  icon={<Users className="h-6 w-6 text-muted-foreground" aria-hidden />}
                  title={t("business.dashboard.noEmployees")}
                  description={t("business.dashboard.noEmployeesChartHint")}
                />
              ) : !hasTipActivityInPeriod ? (
                <BusinessDashboardAnalyticsEmpty
                  icon={<TrendingUp className="h-6 w-6 text-muted-foreground" aria-hidden />}
                  title={t("emptyState.chart.title")}
                  description={t("emptyState.chart.description")}
                />
              ) : employeePerformance.length === 0 ? (
                <BusinessDashboardAnalyticsEmpty
                  icon={<TrendingUp className="h-6 w-6 text-muted-foreground" aria-hidden />}
                  title={t("emptyState.chart.title")}
                  description={t("emptyState.chart.description")}
                />
              ) : (
                <DeferredContentFade show={!showChartsLoading}>
                  <div className="business-dashboard-chart-frame flex h-[260px] w-full min-w-0 items-center justify-center sm:h-[290px]">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} key={`${chartRenderKey}-team`}>
                      <BarChart
                        data={employeePerformance}
                        layout="vertical"
                        margin={{ top: 12, right: 16, left: 4, bottom: 4 }}
                        barCategoryGap="16%"
                      >
                        <CartesianGrid strokeDasharray="4 6" stroke={BUSINESS_CHART_GRID} horizontal={false} />
                        <XAxis
                          type="number"
                          stroke={BUSINESS_CHART_AXIS}
                          tickLine={false}
                          axisLine={{ stroke: BUSINESS_CHART_GRID }}
                          style={{ fontSize: "11px" }}
                          tickMargin={8}
                        />
                        <YAxis
                          dataKey="name"
                          type="category"
                          stroke={BUSINESS_CHART_AXIS}
                          tickLine={false}
                          axisLine={false}
                          style={{ fontSize: "11px" }}
                          width={100}
                          tickMargin={6}
                        />
                        <Tooltip
                          formatter={(value: number) => [formatEur(Number(value)), t("charts.tooltip.tips")]}
                          contentStyle={getBusinessChartTooltipStyle()}
                          cursor={{ fill: "rgba(25, 114, 120, 0.05)" }}
                        />
                        <Bar dataKey="tips" radius={[0, 6, 6, 0]} maxBarSize={22} minPointSize={4} {...LIGHTWEIGHT_BAR}>
                          {employeePerformance.map((entry, index) => (
                            <Cell
                              key={`cell-${entry.name}`}
                              fill={businessChartBarFill(index, employeePerformance.length)}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="business-dashboard-chart-insight">
                    {t("business.dashboard.chartPerformanceLeader", {
                      name: employeePerformance[0]?.name ?? "—",
                      amount: formatEur(employeePerformance[0]?.tips ?? 0),
                    })}
                  </p>
                </DeferredContentFade>
              )}
            </DashboardStableChartSlot>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
});
