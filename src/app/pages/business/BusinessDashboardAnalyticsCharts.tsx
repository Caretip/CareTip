import { memo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { DashboardViewAllLink } from "../../components/dashboard/DashboardViewAllLink";
import { TOP_PERFORMERS_PAGE_PATH } from "../../components/business/insights/TopPerformersTeaser";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CareIcon } from "@/components/icons";
import { useDashboardBlockMotion } from "@/lib/motionPerf";
import { formatEur } from "../../lib/formatEur";
import { cn } from "@/lib/utils";
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
  getBusinessChartTooltipStyle,
} from "../../components/business/businessDashboardChartTheme";
import { DASHBOARD_CHART_AREA_STROKE } from "../../components/dashboard/dashboardChartTheme";
import { LIGHTWEIGHT_AREA } from "../../lib/lightweightChartProps";
import { EmployeeProfilePhoto } from "../../components/ui/profile-avatar";
import type { OverviewLeaderboardPreviewRow, TipPerformanceChartRow } from "../../lib/businessDashboardChartData";

export type BusinessDashboardAnalyticsChartsProps = {
  showChartsLoading: boolean;
  hasTipActivityInPeriod: boolean;
  tipDistributionChartData: TipPerformanceChartRow[];
  tipDistributionTotal: number;
  leaderboardPreview: OverviewLeaderboardPreviewRow[];
  analyticsTimeframe: "week" | "month" | "year";
  chartRenderKey?: string | number;
};

const CHART_SLOT_MIN_HEIGHT = "min-h-0";
const CHART_SLOT_EMPTY_MIN_HEIGHT = "min-h-0";

export const BusinessDashboardAnalyticsCharts = memo(function BusinessDashboardAnalyticsCharts({
  showChartsLoading,
  hasTipActivityInPeriod,
  tipDistributionChartData,
  leaderboardPreview,
  analyticsTimeframe,
  chartRenderKey = "business-analytics",
}: BusinessDashboardAnalyticsChartsProps) {
  const { t } = useTranslation();
  const tipsChartMotion = useDashboardBlockMotion(0.12);
  const leaderboardMotion = useDashboardBlockMotion(0.18);

  /** Let Recharts drop overlapping ticks by width (year months / dense month days). */
  const tipAxisMinTickGap =
    analyticsTimeframe === "year" ? 36 : analyticsTimeframe === "month" ? 24 : 16;

  const periodLabel =
    analyticsTimeframe === "week"
      ? t("dashboard.filter_week")
      : analyticsTimeframe === "year"
        ? t("dashboard.filter_year")
        : t("dashboard.filter_month");

  const tipsChartEmpty = !hasTipActivityInPeriod;
  const leaderboardEmpty = leaderboardPreview.length === 0;

  return (
    <div className={businessUi.analyticsChartsGrid}>
      <motion.div {...tipsChartMotion} className="flex h-auto min-h-0 w-full min-w-0 self-start">
        <section className="business-period-chart business-dashboard-chart-card w-full min-w-0">
          <h2 className="business-period-chart__title">{t("business.dashboard.tipsPerformanceTitle")}</h2>
          <div className="min-w-0 flex-1 overflow-hidden transition-opacity duration-300">
            <DashboardStableChartSlot
              className="!h-auto"
              loading={showChartsLoading}
              minHeightClass={CHART_SLOT_MIN_HEIGHT}
              contentMinHeightClass={tipsChartEmpty ? CHART_SLOT_EMPTY_MIN_HEIGHT : CHART_SLOT_MIN_HEIGHT}
              skeleton={<DashboardChartSkeleton variant="trend" minHeightClass="business-overview-analytics__plot" className="h-auto" />}
            >
              {tipsChartEmpty ? (
                <BusinessDashboardAnalyticsEmpty
                  icon={<CareIcon name="analytics" size="lg" className="text-muted-foreground" />}
                  title={t("emptyState.chart.title")}
                  description={t("emptyState.chart.description")}
                />
              ) : (
                <DeferredContentFade show={!showChartsLoading}>
                  <div className="business-dashboard-chart-frame business-overview-analytics__plot flex w-full min-w-0 items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} key={`${chartRenderKey}-tips`}>
                      <AreaChart data={tipDistributionChartData} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="4 6" stroke={BUSINESS_CHART_GRID} vertical={false} />
                        <XAxis
                          dataKey="dayLabel"
                          stroke={BUSINESS_CHART_AXIS}
                          tickLine={false}
                          axisLine={{ stroke: BUSINESS_CHART_GRID }}
                          tick={{ fontSize: 11, fill: BUSINESS_CHART_AXIS }}
                          tickMargin={8}
                          interval="preserveStartEnd"
                          minTickGap={tipAxisMinTickGap}
                          padding={{ left: 4, right: 4 }}
                        />
                        <YAxis
                          stroke={BUSINESS_CHART_AXIS}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: BUSINESS_CHART_AXIS }}
                          tickMargin={4}
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
          </div>
        </section>
      </motion.div>

      <motion.div {...leaderboardMotion} className="flex h-auto min-h-0 w-full min-w-0 self-start">
        <section
          className="business-period-chart business-dashboard-chart-card business-overview-leaderboard w-full min-w-0"
          aria-label={t("business.dashboard.overviewLeaderboardAria", { period: periodLabel })}
        >
          <div className="business-overview-leaderboard__head">
            <div className="min-w-0">
              <h2 className="business-period-chart__title business-overview-leaderboard__title">
                {t("business.dashboard.overviewLeaderboardTitle")}
              </h2>
              <p className="business-overview-leaderboard__period">{periodLabel}</p>
            </div>
            <DashboardViewAllLink to={TOP_PERFORMERS_PAGE_PATH} className="business-overview-leaderboard__link">
              {t("business.dashboard.overviewLeaderboardView")}
            </DashboardViewAllLink>
          </div>
          <DashboardStableChartSlot
            className="!h-auto"
            loading={showChartsLoading}
            minHeightClass="min-h-0"
            contentMinHeightClass="min-h-0"
            skeleton={<OverviewLeaderboardSkeleton />}
          >
            {leaderboardEmpty ? (
              <p className="business-overview-leaderboard__empty">{t("business.dashboard.overviewLeaderboardEmpty")}</p>
            ) : (
              <DeferredContentFade show={!showChartsLoading}>
                <ol className="business-overview-leaderboard__list">
                  {leaderboardPreview.map((row, index) => {
                    const rank = index + 1;
                    const amount = formatEur(row.tips);
                    return (
                      <li
                        key={row.id}
                        className={cn(
                          "business-overview-leaderboard__row",
                          rank === 1 && "business-overview-leaderboard__row--lead",
                        )}
                      >
                        <span className="business-overview-leaderboard__rank" aria-hidden>
                          {rank}
                        </span>
                        <EmployeeProfilePhoto src={row.avatar} displayName={row.name} className="h-8 w-8" />
                        <span className="business-overview-leaderboard__name">{row.name}</span>
                        <span className="business-overview-leaderboard__amount">{amount}</span>
                        <span className="sr-only">
                          {t("business.dashboard.overviewLeaderboardRank", {
                            name: row.name,
                            rank,
                            amount,
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </DeferredContentFade>
            )}
          </DashboardStableChartSlot>
        </section>
      </motion.div>
    </div>
  );
});

function OverviewLeaderboardSkeleton() {
  return (
    <div className="business-overview-leaderboard__list" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="business-overview-leaderboard__row">
          <span className="h-3 w-3 rounded-sm bg-muted/70" />
          <span className="h-8 w-8 rounded-md bg-muted/70" />
          <span className="h-3 w-24 max-w-full rounded-sm bg-muted/70" />
          <span className="h-3 w-12 rounded-sm bg-muted/70" />
        </div>
      ))}
    </div>
  );
}
