import { memo, useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { businessUi } from "../../businessDashboardUi";
import { businessChartBarFill, getBusinessChartTooltipStyle } from "../../businessDashboardChartTheme";
import { CHART_ANIMATION_OFF } from "../../../../lib/lightweightChartProps";
import { cn } from "@/lib/utils";

export type DonutSlice = {
  id: string;
  label: string;
  value: number;
};

type AnalyticsDonutChartProps = {
  title: string;
  slices: DonutSlice[];
  emptyLabel: string;
  valueFormatter?: (value: number) => string;
  centerLabel?: string;
  className?: string;
  loading?: boolean;
};

export const AnalyticsDonutChart = memo(function AnalyticsDonutChart({
  title,
  slices,
  emptyLabel,
  valueFormatter = (v) => String(v),
  centerLabel,
  className,
  loading,
}: AnalyticsDonutChartProps) {
  const total = useMemo(() => slices.reduce((s, x) => s + x.value, 0), [slices]);
  const data = useMemo(
    () =>
      slices
        .filter((s) => s.value > 0)
        .map((slice, index, arr) => ({
          ...slice,
          fill: businessChartBarFill(index, arr.length),
        })),
    [slices],
  );

  return (
    <div className={cn(businessUi.cardStatic, "p-4 sm:p-5", className)}>
      <h3 className={businessUi.cardTitle}>{title}</h3>
      {loading ? (
        <div className="mx-auto mt-4 h-40 w-40 animate-pulse rounded-full bg-muted/40" aria-busy="true" />
      ) : data.length === 0 || total <= 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div
            className="relative mx-auto h-[180px] w-full max-w-[200px] shrink-0"
            role="img"
            aria-label={title}
          >
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="58%"
                  outerRadius="82%"
                  paddingAngle={1}
                  {...CHART_ANIMATION_OFF}
                >
                  {data.map((entry) => (
                    <Cell key={entry.id} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={getBusinessChartTooltipStyle()}
                  formatter={(value: number, _name, item) => {
                    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                    const label = (item?.payload as DonutSlice)?.label ?? "";
                    return [`${valueFormatter(value)} (${pct}%)`, label];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {centerLabel ? (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {centerLabel}
                </span>
                <span className="text-sm font-semibold tabular-nums">{valueFormatter(total)}</span>
              </div>
            ) : null}
          </div>
          <ul className="flex min-w-0 flex-1 flex-col gap-2 text-sm" aria-hidden={false}>
            {data.map((slice) => {
              const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0;
              return (
                <li key={slice.id} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: slice.fill }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">{slice.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {pct}% · {valueFormatter(slice.value)}
                  </span>
                </li>
              );
            })}
          </ul>
          <ul className="sr-only">
            {data.map((slice) => (
              <li key={slice.id}>
                {slice.label}: {valueFormatter(slice.value)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

/** Presentation-only slices from financial period metrics (no new calculations). */
export function tipRoutingDonutSlices(
  directEur: number | null | undefined,
  distributionEur: number | null | undefined,
  labels: { direct: string; distribution: string },
): DonutSlice[] {
  return [
    { id: "direct", label: labels.direct, value: Math.max(0, directEur ?? 0) },
    { id: "distribution", label: labels.distribution, value: Math.max(0, distributionEur ?? 0) },
  ];
}

export function qrDeviceDonutSlices(
  rows: Array<{ deviceType: string; count: number }> | undefined,
  labelFor: (deviceType: string) => string,
): DonutSlice[] {
  return (rows ?? []).map((row) => ({
    id: row.deviceType,
    label: labelFor(row.deviceType),
    value: row.count,
  }));
}
