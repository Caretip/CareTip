import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { businessUi } from "../../businessDashboardUi";
import {
  BUSINESS_CHART_AXIS,
  BUSINESS_CHART_GRID,
  businessChartBarFill,
  getBusinessChartTooltipStyle,
} from "../../businessDashboardChartTheme";
import { LIGHTWEIGHT_BAR } from "../../../../lib/lightweightChartProps";
import { formatEur } from "../../../../lib/formatEur";
import { cn } from "@/lib/utils";

export type LocationComparisonRow = {
  label: string;
  tips: number;
  count: number;
  share: number;
};

type LocationComparisonChartProps = {
  title: string;
  rows: LocationComparisonRow[];
  emptyKey: string;
  loading?: boolean;
  className?: string;
  maxBars?: number;
};

export const LocationComparisonChart = memo(function LocationComparisonChart({
  title,
  rows,
  emptyKey,
  loading,
  className,
  maxBars = 8,
}: LocationComparisonChartProps) {
  const { t } = useTranslation();

  const chartRows = useMemo(() => {
    const top = rows.slice(0, maxBars);
    return top.map((row, index, arr) => ({
      name: row.label,
      tips: row.tips,
      count: row.count,
      share: row.share,
      fill: businessChartBarFill(index, arr.length),
    }));
  }, [rows, maxBars]);

  const chartHeight = Math.min(320, Math.max(140, chartRows.length * 36 + 24));

  return (
    <div className={cn(businessUi.cardStatic, "p-4 sm:p-5", className)}>
      <h3 className={businessUi.cardTitle}>{title}</h3>
      {loading ? (
        <div className="mt-4 h-32 animate-pulse rounded-md bg-muted/40" aria-busy="true" />
      ) : rows.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">{t(emptyKey)}</p>
      ) : (
        <div
          className="mt-3 w-full min-w-0"
          style={{ height: chartHeight }}
          role="img"
          aria-label={title}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              data={chartRows}
              layout="vertical"
              margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="4 6" stroke={BUSINESS_CHART_GRID} horizontal={false} />
              <XAxis
                type="number"
                stroke={BUSINESS_CHART_AXIS}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => (v >= 1000 ? `€${(v / 1000).toFixed(1)}k` : `€${v}`)}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={96}
                stroke={BUSINESS_CHART_AXIS}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                contentStyle={getBusinessChartTooltipStyle()}
                formatter={(value: number, _name, item) => {
                  const payload = item?.payload as { count?: number; share?: number };
                  return [
                    `${formatEur(value)} · ${t("business.tips.analytics.reporting.count")} ${payload?.count ?? "—"} · ${payload?.share ?? 0}%`,
                    t("business.tips.analytics.reporting.tips"),
                  ];
                }}
              />
              <Bar dataKey="tips" radius={[0, 4, 4, 0]} {...LIGHTWEIGHT_BAR}>
                {chartRows.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ul className="sr-only">
            {chartRows.map((row) => (
              <li key={row.name}>
                {row.name}: {formatEur(row.tips)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});
