import type { BusinessTimeframe } from "@/types/business";

export type TipPerformanceChartRow = {
  day: string;
  dayLabel: string;
  amount: number;
};

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

function normalizeMonthDistributionRows(
  rows: Array<{ day: string; amount: number }>,
): Array<{ day: string; amount: number }> {
  const todayDom = new Date().getDate();
  const monthDomRows = rows.filter((row) => isMonthDayOfMonthLabel(row.day));
  if (monthDomRows.length === 0) return rows;
  return monthDomRows.filter((row) => Number.parseInt(row.day, 10) <= todayDom);
}

/** Map API `dailyTipDistribution` → chart rows (web `buildTipPerformanceChartData` parity). */
export function buildTipPerformanceChartData(
  rows: Array<{ day: string; amount: number }> | undefined | null,
  timeframe: BusinessTimeframe,
): TipPerformanceChartRow[] {
  const source = rows ?? [];
  const scopedRows = timeframe === "month" ? normalizeMonthDistributionRows(source) : source;

  if (scopedRows.length === 0) {
    if (timeframe === "week") {
      return WEEKDAY_LABELS.map((day) => ({ day, dayLabel: day, amount: 0 }));
    }
    if (timeframe === "year") {
      return YEAR_CHART_LABELS.map((day) => ({ day, dayLabel: day, amount: 0 }));
    }
    const todayDom = new Date().getDate();
    return Array.from({ length: todayDom }, (_, index) => {
      const day = String(index + 1);
      return { day, dayLabel: day, amount: 0 };
    });
  }

  return scopedRows.map((row) => ({
    ...row,
    dayLabel: row.day,
    amount: Number(row.amount) || 0,
  }));
}

export function sumTipPerformanceTotal(rows: Array<{ amount: number }>): number {
  return rows.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
}

/**
 * SSOT gate (web `resolveTipPerformanceChartRows`): reject all-zero series when KPI > 0.
 */
export function resolveTipPerformanceChartRows(opts: {
  rows: Array<{ day: string; amount: number }> | undefined | null;
  timeframe: BusinessTimeframe;
  periodTotalTips?: number | null;
}): TipPerformanceChartRow[] | null {
  const built = buildTipPerformanceChartData(opts.rows, opts.timeframe);
  const periodTotal = Number(opts.periodTotalTips) || 0;
  const chartSum = sumTipPerformanceTotal(built);

  if (built.length === 0) {
    return periodTotal > 0 ? null : built;
  }
  if (periodTotal > 0 && chartSum === 0) {
    return null;
  }
  return built;
}

export function mapEmployeeChartSeries(
  series: Array<{ label: string; amount: number }> | undefined | null,
): Array<{ label: string; amount: number }> {
  return (series ?? []).map((row) => ({
    label: row.label,
    amount: Number(row.amount) || 0,
  }));
}
