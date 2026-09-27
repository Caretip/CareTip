import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { businessUi } from "../../businessDashboardUi";
import {
  BUSINESS_CHART_AXIS,
  BUSINESS_CHART_GRID,
  getBusinessChartTooltipStyle,
} from "../../businessDashboardChartTheme";
import { LIGHTWEIGHT_BAR } from "../../../../lib/lightweightChartProps";
import { buildEmployeePerformanceChartRows } from "../../../../lib/businessDashboardChartData";
import { formatEur } from "../../../../lib/formatEur";
import { cn } from "@/lib/utils";
import type { BusinessIntelligenceInput } from "../../../../lib/businessIntelligence";

type EmployeePerformanceRankingProps = {
  data: BusinessIntelligenceInput;
  loading?: boolean;
  className?: string;
};

export const EmployeePerformanceRanking = memo(function EmployeePerformanceRanking({
  data,
  loading,
  className,
}: EmployeePerformanceRankingProps) {
  const { t } = useTranslation();

  const chartRows = useMemo(
    () => buildEmployeePerformanceChartRows(data.employees, 6),
    [data.employees],
  );

  const chartHeight = Math.min(280, Math.max(120, chartRows.length * 34 + 20));

  return (
    <div className={cn(businessUi.cardStatic, "p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={businessUi.cardTitle}>{t("business.tips.analytics.sections.employees")}</h3>
        <Link
          to="/dashboard/team/performance?tab=leaderboard"
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          {t("business.team.nav.topPerformers")}
        </Link>
      </div>
      {loading ? (
        <div className="mt-4 h-28 animate-pulse rounded-md bg-muted/40" aria-busy="true" />
      ) : chartRows.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("business.dashboard.topPerformersEmptyHint")}
        </p>
      ) : (
        <div className="mt-3 w-full min-w-0" style={{ height: chartHeight }} role="img">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              data={chartRows}
              layout="vertical"
              margin={{ top: 4, right: 8, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="4 6" stroke={BUSINESS_CHART_GRID} horizontal={false} />
              <XAxis
                type="number"
                hide
                domain={[0, "dataMax"]}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={88}
                stroke={BUSINESS_CHART_AXIS}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                contentStyle={getBusinessChartTooltipStyle()}
                formatter={(value: number) => [formatEur(value), t("business.tips.analytics.reporting.tips")]}
              />
              <Bar dataKey="tips" radius={[0, 4, 4, 0]} {...LIGHTWEIGHT_BAR}>
                {chartRows.map((row) => (
                  <Cell key={row.name} fill={row.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
});
