import type { TFunction } from "i18next";
import { translateChartMonthLabel, translateChartWeekdayLabel } from "@/lib/chartAxisLabels";
import { dashboardChartBarFill } from "@/app/components/dashboard/dashboardChartTheme";
import type { AnalyticsTimeframe } from "@/app/hooks/useBusinessDashboardStats";
import type { BusinessDashboardStats } from "@/app/lib/api";
import { getBusinessAnalyticsBundle } from "@/app/lib/businessAnalytics/businessAnalyticsStore";
import { resolveBusinessTimezone, venueLocalTodayKey } from "@/app/lib/businessVenueTime";

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

/** Prefer stats aligned with the active period toggle (SWR cache during switches). */
export function resolveBusinessDashboardChartStats(
  analyticsTimeframe: AnalyticsTimeframe,
  displayStats: BusinessDashboardStats | null,
  statsTimeframe: AnalyticsTimeframe | null,
): BusinessDashboardStats | null {
  const cached = getBusinessAnalyticsBundle(analyticsTimeframe)?.periodStats ?? null;

  const chartUsable = (s: BusinessDashboardStats | null | undefined): boolean => {
    if (!s) return false;
    const dist = s.dailyTipDistribution ?? [];
    if (dist.length === 0) return false;
    const sum = dist.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
    const total = Number(s.totalTips) || 0;
    // Reject all-zero series while period KPI is non-zero (SSOT lie).
    if (total > 0 && sum === 0) return false;
    return true;
  };

  if (displayStats && statsTimeframe === analyticsTimeframe && chartUsable(displayStats)) {
    return displayStats;
  }

  if (cached && chartUsable(cached)) {
    return {
      ...(displayStats ?? {}),
      ...cached,
      totalTips: cached.totalTips ?? displayStats?.totalTips,
      tipCount: cached.tipCount ?? displayStats?.tipCount,
      employeeCount: cached.employeeCount ?? displayStats?.employeeCount,
      employees: cached.employees ?? displayStats?.employees,
      employeeGoals: cached.employeeGoals ?? displayStats?.employeeGoals,
      dailyTipDistribution: cached.dailyTipDistribution ?? [],
      operationalPulse: displayStats?.operationalPulse ?? cached.operationalPulse,
    } as BusinessDashboardStats;
  }

  if (displayStats && statsTimeframe === analyticsTimeframe) {
    return displayStats;
  }

  // Never paint a different period's analytics under the active toggle.
  return null;
}

function isMonthDayOfMonthLabel(day: string): boolean {
  return /^\d{1,2}$/.test(day.trim());
}

/**
 * Truncate month chart to venue-local day-of-month (not browser calendar).
 * @param venueDayOfMonth 1–31 from business timezone "now"
 */
function normalizeMonthDistributionRows(
  rows: Array<{ day: string; amount: number }>,
  venueDayOfMonth?: number,
): Array<{ day: string; amount: number }> {
  const todayDom =
    typeof venueDayOfMonth === "number" && venueDayOfMonth >= 1 && venueDayOfMonth <= 31
      ? venueDayOfMonth
      : Number(venueLocalTodayKey(resolveBusinessTimezone()).slice(8, 10)) || 1;
  const monthDomRows = rows.filter((row) => isMonthDayOfMonthLabel(row.day));
  if (monthDomRows.length === 0) return rows;
  return monthDomRows.filter((row) => Number.parseInt(row.day, 10) <= todayDom);
}

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

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Zero scaffold only when there is truly no period tip activity. */
export function buildFallbackTipPerformanceChartData(
  timeframe: AnalyticsTimeframe,
  t: TFunction,
  opts?: { venueDayOfMonth?: number },
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
  const todayDom =
    typeof opts?.venueDayOfMonth === "number" &&
    opts.venueDayOfMonth >= 1 &&
    opts.venueDayOfMonth <= 31
      ? opts.venueDayOfMonth
      : Number(venueLocalTodayKey(resolveBusinessTimezone()).slice(8, 10)) || 1;
  return Array.from({ length: todayDom }, (_, index) => {
    const day = String(index + 1);
    return { day, dayLabel: day, amount: 0 };
  });
}

/** Map API daily tip buckets to labeled chart rows for the active period toggle. */
export function buildTipPerformanceChartData(
  rows: Array<{ day: string; amount: number }>,
  timeframe: AnalyticsTimeframe,
  t: TFunction,
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
  }));
}

/**
 * SSOT gate: never return an all-zero series when period KPI € > 0.
 * Returns null → caller should keep loading / prior series instead of lying zeros.
 */
export function resolveTipPerformanceChartRows(opts: {
  rows: Array<{ day: string; amount: number }>;
  timeframe: AnalyticsTimeframe;
  t: TFunction;
  periodTotalTips?: number | null;
  venueDayOfMonth?: number;
}): TipPerformanceChartRow[] | null {
  const built = buildTipPerformanceChartData(opts.rows, opts.timeframe, opts.t, {
    venueDayOfMonth: opts.venueDayOfMonth,
  });
  const periodTotal = Number(opts.periodTotalTips) || 0;
  const chartSum = sumTipPerformanceTotal(built);

  if (built.length === 0) {
    if (periodTotal > 0) return null;
    return buildFallbackTipPerformanceChartData(opts.timeframe, opts.t, {
      venueDayOfMonth: opts.venueDayOfMonth,
    });
  }

  if (periodTotal > 0 && chartSum === 0) {
    return null;
  }

  // Reject series that cannot reconcile with the period KPI (SSOT).
  if (periodTotal > 0 && Math.abs(chartSum - periodTotal) > 0.05) {
    if (import.meta.env.DEV) {
      console.warn(
        `[SSOT] tip chart sum ≠ period KPI (${opts.timeframe}): chartSum=${chartSum} KPI=${periodTotal}`,
      );
    }
    return null;
  }

  return built;
}

export function sumTipPerformanceTotal(rows: Array<{ amount: number }>): number {
  return rows.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
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

/** Top earners for the team performance bar chart (dashboard overview). */
export function buildEmployeePerformanceChartRows(
  employees: DashboardEmployeeRow[] | undefined,
  limit = 8,
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
    color: dashboardChartBarFill(index, arr.length),
  }));
}
