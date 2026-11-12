import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from "recharts";
import type { PlatformAnalytics } from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/app/components/ui/chart";
import { DashboardChartSkeleton } from "../dashboard/DashboardAnalyticsLoader";
import { CHART_ANIMATION_OFF } from "../../lib/lightweightChartProps";
import { formatVenueDayBucketLabel } from "../../lib/businessVenueTime";
import { CONSOLE_CHART } from "./console/AdminConsole";

type PlatformOverviewSummaryChartsProps = {
  analytics: PlatformAnalytics | null;
  loading?: boolean;
  /** "volume" = € area (overview); "growth" = new businesses/tips bars. */
  variant?: "volume" | "growth";
};

function formatCompact(n: number): string {
  try {
    return new Intl.NumberFormat(undefined, { notation: "compact" }).format(n);
  } catch {
    return String(n);
  }
}

function formatShortDate(iso: string): string {
  return formatVenueDayBucketLabel(iso, undefined, "Europe/Berlin");
}

/** Lazy-loaded recharts body for the admin overview trend card. */
export function PlatformOverviewSummaryCharts({
  analytics,
  loading = false,
  variant = "volume",
}: PlatformOverviewSummaryChartsProps) {
  const { t } = useTranslation();

  const tipsData = useMemo(() => {
    const rows = [...(analytics?.tipVolume ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    return rows.slice(-30).map((row) => ({
      date: formatShortDate(row.date),
      tipsEur: row.tipsEur,
      tipCount: row.tipCount,
    }));
  }, [analytics?.tipVolume]);

  const growthData = useMemo(() => {
    const rows = [...(analytics?.growth ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    return rows.slice(-30).map((row) => ({
      date: formatShortDate(row.date),
      newBusinesses: row.newBusinesses,
      newUsers: row.newUsers,
    }));
  }, [analytics?.growth]);

  if (loading) return <DashboardChartSkeleton />;

  if (variant === "growth") {
    const config: ChartConfig = {
      newUsers: { label: t("admin.legendNewUsers"), color: CONSOLE_CHART.neutral },
      newBusinesses: { label: t("admin.legendNewVenues"), color: CONSOLE_CHART.brand },
    };
    if (growthData.every((r) => r.newBusinesses === 0 && r.newUsers === 0)) {
      return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("admin.overview.charts.empty")}</p>;
    }
    return (
      <ChartContainer config={config} className="aspect-auto h-full w-full min-h-0">
        <ComposedChart data={growthData} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickMargin={8} minTickGap={24} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} width={32} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <Bar dataKey="newUsers" fill="var(--color-newUsers)" radius={[3, 3, 0, 0]} maxBarSize={14} {...CHART_ANIMATION_OFF} />
          <Bar dataKey="newBusinesses" fill="var(--color-newBusinesses)" radius={[3, 3, 0, 0]} maxBarSize={14} {...CHART_ANIMATION_OFF} />
        </ComposedChart>
      </ChartContainer>
    );
  }

  const tipsConfig: ChartConfig = {
    tipsEur: { label: t("admin.overview.charts.tipsVolume"), color: CONSOLE_CHART.brand },
  };
  if (tipsData.every((row) => row.tipsEur === 0)) {
    return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("admin.overview.charts.empty")}</p>;
  }
  return (
    <ChartContainer config={tipsConfig} className="aspect-auto h-full w-full min-h-0">
      <AreaChart data={tipsData} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="ac-tips-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-tipsEur)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--color-tipsEur)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tickMargin={8} minTickGap={24} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={formatCompact} width={44} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={(value, name) => (name === "tipsEur" ? formatEur(Number(value)) : String(value))}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="tipsEur"
          stroke="var(--color-tipsEur)"
          fill="url(#ac-tips-fill)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          {...CHART_ANIMATION_OFF}
        />
      </AreaChart>
    </ChartContainer>
  );
}
