import type { EmployeeGoalProgress } from "./api";
import type { TipItem } from "./api";

export type EmployeeTimeframe = "today" | "week" | "month";

/**
 * DEV-only preview when the employee account has no real tip history yet.
 * Uses lifetime summary (not the active period tab) so a quiet “today” does not
 * mask real week/month data.
 */
export function shouldUseEmployeeDashboardDevDemo(opts: {
  isDev: boolean;
  /** Only seeded walkthrough demo accounts — never real fresh sign-ups. */
  isWalkthroughDemoAccount: boolean;
  hasError: boolean;
  accountSummaryLoaded: boolean;
  accountSummaryLoading: boolean;
  analyticsLoading: boolean;
  totalEarningsEur: number;
  totalSupporters: number;
}): boolean {
  if (!opts.isDev || !opts.isWalkthroughDemoAccount || opts.hasError) return false;
  if (!opts.accountSummaryLoaded || opts.accountSummaryLoading || opts.analyticsLoading) return false;
  return opts.totalEarningsEur <= 0 && opts.totalSupporters <= 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

/** Monday-first weekday labels used across charts. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Realistic but deterministic “shape” for a week: builds toward weekend. */
const BASE_WEEK_AMOUNTS = [20, 35, 18, 50, 70, 90, 65] as const;

/**
 * Business Dashboard must never silently replace financial KPIs with client mocks.
 * Walkthrough/demo tips belong in an explicit Demo Mode (URL flag / feature flag /
 * seeded DB), not in `BusinessDashboard` render paths.
 */

export function devMockEmployeeEarningsTimeline(
  timeframe: EmployeeTimeframe,
): Array<{ time: string; amount: number }> {
  if (timeframe === "today") {
    // Sparse hours with a lunch + dinner rush.
    const hours = [9, 11, 12, 13, 18, 19, 20, 21];
    const amounts = [0, 12, 24, 18, 35, 48, 41, 22];
    const byHour = new Array(24).fill(0);
    for (let i = 0; i < hours.length; i++) byHour[hours[i]] = amounts[i];
    return byHour.map((amount, hour) => ({ time: `${hour}:00`, amount }));
  }

  if (timeframe === "week") {
    const amounts = BASE_WEEK_AMOUNTS.map((v) => Math.round(v * 0.75));
    return WEEKDAYS.map((d, i) => ({ time: d, amount: amounts[i] }));
  }

  // month → 5 week-buckets like EmployeeDashboard already expects
  const buckets = [
    { time: "3/12", amount: 140 },
    { time: "3/18", amount: 220 },
    { time: "3/24", amount: 185 },
    { time: "3/30", amount: 265 },
    { time: "4/5", amount: 240 },
  ];
  return buckets;
}

export function devMockEmployeeSummary(timeframe: EmployeeTimeframe): {
  amount: number;
  tips: number;
  avgTip: number;
} {
  const series = devMockEmployeeEarningsTimeline(timeframe).map((p) => p.amount);
  const total = sum(series);
  // Reasonable “count” approximation for preview purposes only.
  const tips = timeframe === "today" ? 7 : timeframe === "week" ? 18 : 42;
  const avgTip = tips > 0 ? total / tips : 0;
  return { amount: total, tips, avgTip };
}

/** Lifetime hero metrics — not period-scoped. */
export function devMockEmployeeAccountSummary(): {
  totalEarningsEur: number;
  totalSupporters: number;
} {
  return {
    totalEarningsEur: 1_248.5,
    totalSupporters: 47,
  };
}

export function devMockEmployeeChartSeries(
  timeframe: EmployeeTimeframe,
): Array<{ label: string; amount: number }> {
  if (timeframe === "today") {
    return Array.from({ length: 24 }, (_, h) => ({
      label: `${h}:00`,
      amount: [0, 0, 0, 0, 8, 12, 18, 22, 15, 10, 14, 28, 32, 24, 18, 12, 8, 35, 48, 41, 22, 14, 6, 0][h] ?? 0,
    }));
  }
  if (timeframe === "week") {
    return WEEKDAYS.map((label, i) => ({
      label,
      amount: Math.round(BASE_WEEK_AMOUNTS[i] * 0.75),
    }));
  }
  const days = 30;
  const points: Array<{ label: string; amount: number }> = [];
  for (let d = 1; d <= days; d += 1) {
    const weekendBoost = d % 7 === 6 || d % 7 === 0 ? 1.35 : 1.0;
    const mid = 1 + Math.sin(((d - 8) / days) * Math.PI) * 0.35;
    const amt = Math.round(clamp(42 * mid * weekendBoost + (d % 5) * 2, 8, 120));
    points.push({ label: String(d), amount: amt });
  }
  return points;
}

function buildDevPreviewTips(count: number): TipItem[] {
  const amounts = [18.5, 12, 24, 9.5, 15, 21, 14, 8, 16.5, 11, 19, 7.5];
  const now = Date.now();
  return amounts.slice(0, count).map((amount, i) => ({
    id: `dev-preview-tip-${i + 1}`,
    amount,
    status: "success" as const,
    createdAt: new Date(now - i * 3 * 3_600_000 - (i % 2) * 1_800_000).toISOString(),
  }));
}

export function devMockEmployeeRecentTips(): TipItem[] {
  return buildDevPreviewTips(8);
}

/** Notifications page + header badge sync in DEV when account has no real tips. */
export function devMockEmployeeNotificationTips(): TipItem[] {
  return buildDevPreviewTips(10);
}

/** Tips list for notification UI; uses DEV preview when lifetime earnings are empty. */
export function resolveEmployeeTipsWithDevPreview(
  apiTips: TipItem[],
  accountSummary: { totalEarningsEur?: number; totalSupporters?: number },
  isWalkthroughDemoAccount = false,
): TipItem[] {
  const usePreview = shouldUseEmployeeDashboardDevDemo({
    isDev: import.meta.env.DEV,
    isWalkthroughDemoAccount,
    hasError: false,
    accountSummaryLoaded: true,
    accountSummaryLoading: false,
    analyticsLoading: false,
    totalEarningsEur: accountSummary.totalEarningsEur ?? 0,
    totalSupporters: accountSummary.totalSupporters ?? 0,
  });
  if (usePreview) {
    return devMockEmployeeNotificationTips();
  }
  return apiTips;
}

export function devMockEmployeeGoalBundle(): {
  monthlyGoal: number;
  currentMonthTotal: number;
  goal: EmployeeGoalProgress;
} {
  const monthlyGoal = 650;
  const currentAmount = 442.5;
  const percent = Math.min(100, Math.round((currentAmount / monthlyGoal) * 100));
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12, 0, 0, 0))
    .toISOString()
    .slice(0, 10);
  return {
    monthlyGoal,
    currentMonthTotal: currentAmount,
    goal: {
      id: "dev-preview-goal",
      employeeId: "dev-preview-employee",
      name: "Monthly tip goal",
      lifecycleStatus: "active",
      goalAmount: monthlyGoal,
      goalPeriod: "monthly",
      startDate,
      currentAmount,
      percent,
      status: percent >= 100 ? "achieved" : percent >= 55 ? "on_track" : "below_target",
    },
  };
}

/** Shown on the ratings stat card in DEV preview only. */
export function devMockEmployeeRating(): number {
  return 4.8;
}

