import type { BusinessTimeframe } from "@/types/business";
import type { ColorPalette } from "@/theme/colors";
import { dashboardChartBarFill } from "@/theme/dashboardChartTheme";
import { translateChartMonthLabel, translateChartWeekdayLabel } from "@/utils/chartAxisLabels";

export type TipPerformanceChartRow = {
  day: string;
  dayLabel: string;
  amount: number;
};

export type EmployeePerformanceChartRow = {
  name: string;
  tips: number;
  rating: number;
  color: string;
};

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const YEAR_CHART_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function isMonthDayOfMonthLabel(day: string): boolean {
  return /^\d{1,2}$/.test(day.trim());
}

function venueDayOfMonth(timezone?: string | null): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone?.trim() || undefined,
      day: "numeric",
    }).formatToParts(new Date());
    const day = parts.find((p) => p.type === "day")?.value;
    const n = day ? Number.parseInt(day, 10) : NaN;
    if (Number.isFinite(n) && n >= 1 && n <= 31) return n;
  } catch {
    /* fall through */
  }
  return new Date().getDate();
}

function normalizeMonthDistributionRows(
  rows: Array<{ day: string; amount: number }>,
  venueDom?: number,
): Array<{ day: string; amount: number }> {
  const todayDom = venueDom ?? new Date().getDate();
  const monthDomRows = rows.filter((row) => isMonthDayOfMonthLabel(row.day));
  if (monthDomRows.length === 0) return rows;
  return monthDomRows.filter((row) => Number.parseInt(row.day, 10) <= todayDom);
}

export function buildFallbackTipPerformanceChartData(
  timeframe: BusinessTimeframe,
  t: TranslateFn,
  venueDom?: number,
): TipPerformanceChartRow[] {
  if (timeframe === "week") {
    return WEEKDAY_LABELS.map((day) => ({
      day,
      dayLabel: translateChartWeekdayLabel(day, t),
      amount: 0,
    }));
  }
  if (timeframe === "year") {
    return YEAR_CHART_LABELS.map((day) => ({
      day,
      dayLabel: translateChartMonthLabel(day, t),
      amount: 0,
    }));
  }
  const todayDom = venueDom ?? new Date().getDate();
  return Array.from({ length: todayDom }, (_, index) => {
    const day = String(index + 1);
    return { day, dayLabel: day, amount: 0 };
  });
}

export function buildTipPerformanceChartData(
  rows: Array<{ day: string; amount: number }>,
  timeframe: BusinessTimeframe,
  t: TranslateFn,
  opts?: { venueDayOfMonth?: number },
): TipPerformanceChartRow[] {
  const scopedRows =
    timeframe === "month" ? normalizeMonthDistributionRows(rows, opts?.venueDayOfMonth) : rows;

  return scopedRows.map((row) => ({
    ...row,
    dayLabel:
      timeframe === "week"
        ? translateChartWeekdayLabel(row.day, t)
        : timeframe === "year"
          ? translateChartMonthLabel(row.day, t)
          : row.day,
    amount: Number(row.amount) || 0,
  }));
}

export function sumTipPerformanceTotal(rows: Array<{ amount: number }>): number {
  return rows.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
}

/** SSOT gate (web `resolveTipPerformanceChartRows`). */
export function resolveTipPerformanceChartRows(opts: {
  rows: Array<{ day: string; amount: number }> | undefined | null;
  timeframe: BusinessTimeframe;
  t: TranslateFn;
  periodTotalTips?: number | null;
  venueDayOfMonth?: number;
  venueTimezone?: string | null;
}): TipPerformanceChartRow[] | null {
  const venueDom = opts.venueDayOfMonth ?? venueDayOfMonth(opts.venueTimezone);
  const source = opts.rows ?? [];
  const built =
    source.length === 0
      ? buildFallbackTipPerformanceChartData(opts.timeframe, opts.t, venueDom)
      : buildTipPerformanceChartData(source, opts.timeframe, opts.t, { venueDayOfMonth: venueDom });

  const periodTotal = Number(opts.periodTotalTips) || 0;
  const chartSum = sumTipPerformanceTotal(built);

  if (built.length === 0) {
    return periodTotal > 0 ? null : built;
  }
  if (periodTotal > 0 && chartSum === 0) {
    return null;
  }
  if (periodTotal > 0 && Math.abs(chartSum - periodTotal) > 0.05) {
    return null;
  }
  return built;
}

export function hasTipPerformanceChartActivity(
  rows: Array<{ amount: number }>,
  periodTotalTips?: number | null,
): boolean {
  if (sumTipPerformanceTotal(rows) > 0) return true;
  return (periodTotalTips ?? 0) > 0;
}

type DashboardEmployeeRow = {
  name: string;
  tipsTotal: number;
  isActive?: boolean;
  activationStatus?: string;
  emailVerified?: boolean;
};

/** Top earners for team performance bar chart (web parity). */
export function buildEmployeePerformanceChartRows(
  employees: DashboardEmployeeRow[] | undefined,
  limit: number,
  colors: ColorPalette,
): EmployeePerformanceChartRow[] {
  const ranked = (employees ?? [])
    .filter(
      (e) =>
        e.isActive === true &&
        e.activationStatus === "active" &&
        e.emailVerified === true &&
        e.tipsTotal > 0,
    )
    .sort((a, b) => b.tipsTotal - a.tipsTotal)
    .slice(0, limit);

  return ranked.map((e, index, arr) => ({
    name: e.name,
    tips: e.tipsTotal,
    rating: 0,
    color: dashboardChartBarFill(index, arr.length, colors),
  }));
}

export function mapEmployeeChartSeries(
  series: Array<{ label: string; amount: number }> | undefined | null,
): Array<{ label: string; amount: number }> {
  return (series ?? []).map((row) => ({
    label: row.label,
    amount: Number(row.amount) || 0,
  }));
}
