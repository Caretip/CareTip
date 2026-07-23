import { EmployeeGoalStatus, type GoalPeriod, Prisma, TipStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { getCachedOrLoad, invalidateCacheKeyPrefix } from "../utils/shortLivedCache.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import type { TipForEmployee } from "./tips.service.js";
import { businessUtcRangeForTimeframe, sanitizeIanaTimezone } from "../utils/businessTime.js";
import { logDashboardPhase } from "../utils/dashboardTiming.js";
import {
  buildEmployeeChartSeries,
  queryEmployeeAnalyticsBundle,
  queryEmployeeDashboardSummaryMetrics,
  type EmployeeDashboardSqlSummary,
} from "../utils/tipChartBuckets.js";
import {
  buildActiveGoalWithProgress,
  effectivePeriodBounds,
  getMyGoalWithProgressForEmployee,
  type GoalWithProgress,
} from "./goal.service.js";

export type EmployeeDashboardTimeframe = "today" | "week" | "month";

/**
 * Charts + aggregates for `/api/tips/employee` period views.
 * All boundaries use business-local calendar (IANA timezone on Business).
 */

const EMPLOYEE_PERIOD_CACHE_TTL_MS = 30_000;
const EMPLOYEE_TIPS_CTX_TTL_MS = 60_000;
/** Per-timeframe tips SQL bundle — shared by summary + analytics scopes. */
const EMPLOYEE_SQL_BUNDLE_CACHE_TTL_MS = 90_000;
const RECENT_TIPS_TAKE = 30;

export type EmployeeActiveGoalContext = {
  id: string;
  employeeId: string;
  name: string;
  goalAmount: number;
  goalPeriod: GoalPeriod;
  startDate: Date;
  status: EmployeeGoalStatus;
};

export type EmployeeTipsContext = {
  id: string;
  businessId: string;
  monthlyGoal: number | null;
  businessTimezone: string;
  activeGoal: EmployeeActiveGoalContext | null;
};

type EmployeeSqlBundleSlice = {
  summary: EmployeeDashboardSqlSummary;
  analytics: Awaited<ReturnType<typeof queryEmployeeAnalyticsBundle>>;
  rangeStart: Date;
  rangeEnd: Date;
  timeframe: EmployeeDashboardTimeframe;
};

function runEmployeeDashboardDb<T>(employeeId: string, fn: () => Promise<T>): Promise<T> {
  return runSerializedByKey(`emp-dash-db:${employeeId}`, fn);
}

function emptyEmployeeSqlBundleSlice(
  timeframe: EmployeeDashboardTimeframe,
): EmployeeSqlBundleSlice {
  const now = new Date();
  return {
    summary: { periodAmount: 0, periodCount: 0, monthAmount: 0, periodAvgRating: null, periodRatingCount: 0 },
    analytics: { recentTips: [], dailyByYmd: new Map(), hourlyByHour: new Map() },
    rangeStart: now,
    rangeEnd: now,
    timeframe,
  };
}

async function loadEmployeeSqlBundleSlice(
  employeeId: string,
  timeframe: EmployeeDashboardTimeframe,
  tz: string,
): Promise<EmployeeSqlBundleSlice> {
  const periodRange = businessUtcRangeForTimeframe(timeframe, tz);
  const monthRange = businessUtcRangeForTimeframe("month", tz);
  if (!periodRange || !monthRange) {
    return emptyEmployeeSqlBundleSlice(timeframe);
  }

  const scanStart =
    periodRange.startUtc.getTime() < monthRange.startUtc.getTime()
      ? periodRange.startUtc
      : monthRange.startUtc;
  const scanEnd =
    periodRange.endUtc.getTime() > monthRange.endUtc.getTime()
      ? periodRange.endUtc
      : monthRange.endUtc;

  const label = `employee.${timeframe}`;

  const summary = await logDashboardPhase(label, "summarySql", () =>
    queryEmployeeDashboardSummaryMetrics({
      employeeId,
      periodStart: periodRange.startUtc,
      periodEnd: periodRange.endUtc,
      monthStart: monthRange.startUtc,
      monthEnd: monthRange.endUtc,
      scanStart,
      scanEnd,
    }),
  );

  const analytics = await logDashboardPhase(label, "sqlBundle", () =>
    queryEmployeeAnalyticsBundle({
      employeeId,
      startUtc: periodRange.startUtc,
      endUtc: periodRange.endUtc,
      timezone: tz,
      timeframe,
      recentTake: RECENT_TIPS_TAKE,
    }),
  );

  return {
    summary,
    analytics,
    rangeStart: periodRange.startUtc,
    rangeEnd: periodRange.endUtc,
    timeframe,
  };
}

function loadEmployeeSqlBundleSliceCached(
  employeeId: string,
  timeframe: EmployeeDashboardTimeframe,
  businessTimezone: string,
): Promise<EmployeeSqlBundleSlice> {
  const tz = sanitizeIanaTimezone(businessTimezone);
  return getCachedOrLoad(
    `emp-dash-sql:${employeeId}:${timeframe}:${tz}`,
    EMPLOYEE_SQL_BUNDLE_CACHE_TTL_MS,
    () =>
      runEmployeeDashboardDb(employeeId, () =>
        loadEmployeeSqlBundleSlice(employeeId, timeframe, tz),
      ),
  );
}

function mapAnalyticsBundleToResponse(
  analytics: EmployeeSqlBundleSlice["analytics"],
  timeframe: EmployeeDashboardTimeframe,
  tz: string,
): {
  tips: TipForEmployee[];
  chartSeries: Array<{ label: string; amount: number }>;
} {
  const tips: TipForEmployee[] = analytics.recentTips.map((t) => ({
    id: t.id,
    amount: t.amount,
    status: t.status as TipForEmployee["status"],
    createdAt: t.createdAt.toISOString(),
  }));

  const chartSeries = buildEmployeeChartSeries(
    timeframe,
    tz,
    analytics.dailyByYmd,
    analytics.hourlyByHour,
  );

  return { tips, chartSeries };
}

async function resolveGoalForSummaryBundle(opts: {
  employeeId: string;
  userId: string;
  businessTimezone: string;
  timeframe: EmployeeDashboardTimeframe;
  activeGoal: EmployeeActiveGoalContext | null;
  periodRange: { startUtc: Date; endUtc: Date };
  monthRange: { startUtc: Date; endUtc: Date };
  periodAmountEur: number;
}): Promise<GoalWithProgress | null> {
  const activeGoal = opts.activeGoal;
  if (!activeGoal) return null;

  const tz = sanitizeIanaTimezone(opts.businessTimezone);
  const now = new Date();
  const goalBounds = effectivePeriodBounds(
    activeGoal.goalPeriod,
    activeGoal.startDate,
    now,
    tz,
  );

  const label = `employee.summary.${opts.timeframe}`;

  if (opts.timeframe === "month") {
    const rows = await logDashboardPhase(label, "goalSqlMonth", () =>
      prisma.$queryRaw<Array<{ goal_amount: number }>>(Prisma.sql`
        SELECT COALESCE(SUM(amount) FILTER (
          WHERE created_at >= ${goalBounds.start} AND created_at <= ${goalBounds.end}
        ), 0)::float AS goal_amount
        FROM tips
        WHERE employee_id = ${opts.employeeId}
          AND status = 'success'
          AND created_at >= ${opts.monthRange.startUtc}
          AND created_at <= ${opts.monthRange.endUtc}
      `),
    );
    return buildActiveGoalWithProgress(activeGoal, Number(rows[0]?.goal_amount ?? 0), now, tz);
  }

  const goalFitsPeriod =
    goalBounds.start.getTime() >= opts.periodRange.startUtc.getTime() &&
    goalBounds.end.getTime() <= opts.periodRange.endUtc.getTime();

  if (goalFitsPeriod) {
    const rows = await logDashboardPhase(label, "goalSqlPeriod", () =>
      prisma.$queryRaw<Array<{ goal_amount: number }>>(Prisma.sql`
        SELECT COALESCE(SUM(amount) FILTER (
          WHERE created_at >= ${goalBounds.start} AND created_at <= ${goalBounds.end}
        ), 0)::float AS goal_amount
        FROM tips
        WHERE employee_id = ${opts.employeeId}
          AND status = 'success'
          AND created_at >= ${opts.periodRange.startUtc}
          AND created_at <= ${opts.periodRange.endUtc}
      `),
    );
    return buildActiveGoalWithProgress(activeGoal, Number(rows[0]?.goal_amount ?? 0), now, tz);
  }

  return logDashboardPhase(label, "goalProgress", () =>
    getMyGoalWithProgressForEmployee(opts.employeeId, opts.userId, tz).catch(() => null),
  );
}

function mapActiveGoal(
  employeeId: string,
  g:
    | {
        id: string;
        name: string;
        goalAmount: unknown;
        goalPeriod: GoalPeriod;
        startDate: Date;
        status: EmployeeGoalStatus;
      }
    | undefined,
): EmployeeActiveGoalContext | null {
  if (!g) return null;
  return {
    id: g.id,
    employeeId,
    name: g.name,
    goalAmount: Number(g.goalAmount),
    goalPeriod: g.goalPeriod,
    startDate: g.startDate,
    status: g.status,
  };
}

/** Cached employee, timezone, and active goal (avoids extra goal lookup per summary). */
export async function getEmployeeTipsContext(userId: string): Promise<EmployeeTipsContext | null> {
  return getCachedOrLoad(`emp-tips-ctx:${userId}`, EMPLOYEE_TIPS_CTX_TTL_MS, async () => {
    const goalSelect = {
      where: { status: EmployeeGoalStatus.active },
      orderBy: [{ updatedAt: "desc" as const }],
      take: 1,
      select: {
        id: true,
        name: true,
        goalAmount: true,
        goalPeriod: true,
        startDate: true,
        status: true,
      },
    };
    try {
      const row = await prisma.employee.findUnique({
        where: { userId },
        select: {
          id: true,
          monthlyGoal: true,
          business: { select: { id: true, timezone: true } },
          employeeGoals: goalSelect,
        },
      });
      if (!row?.business?.id) return null;
      return {
        id: row.id,
        businessId: row.business.id,
        monthlyGoal: row.monthlyGoal != null ? Number(row.monthlyGoal) : null,
        businessTimezone: sanitizeIanaTimezone(row.business?.timezone),
        activeGoal: mapActiveGoal(row.id, row.employeeGoals[0]),
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2022") {
        const row = await prisma.employee.findUnique({
          where: { userId },
          select: { id: true, business: { select: { id: true, timezone: true } } },
        });
        if (!row?.business?.id) return null;
        return {
          id: row.id,
          businessId: row.business.id,
          monthlyGoal: null,
          businessTimezone: sanitizeIanaTimezone(row.business?.timezone),
          activeGoal: null,
        };
      }
      throw e;
    }
  });
}

export function invalidateEmployeeTipsContext(userId: string): void {
  invalidateCacheKeyPrefix(`emp-tips-ctx:${userId}`);
}

export function invalidateEmployeeDashboardCache(employeeId: string): void {
  invalidateCacheKeyPrefix(`emp-dash-sql:${employeeId}:`);
  invalidateCacheKeyPrefix(`emp-period-summary:${employeeId}:`);
  invalidateCacheKeyPrefix(`emp-dash-summary:${employeeId}:`);
  invalidateCacheKeyPrefix(`emp-dash-summary-bundle:${employeeId}:`);
  invalidateCacheKeyPrefix(`emp-period-analytics:${employeeId}:`);
  invalidateCacheKeyPrefix(`emp-month-total:${employeeId}:`);
  invalidateCacheKeyPrefix(`emp-account:${employeeId}`);
}

/** Period metrics + current-month total (cached SQL bundle). */
export async function loadEmployeeDashboardSummary(opts: {
  employeeId: string;
  businessTimezone: string;
  timeframe: EmployeeDashboardTimeframe;
}): Promise<{
  periodAmountEur: number;
  periodTipCount: number;
  currentMonthTotal: number;
}> {
  const cacheKey = `emp-dash-summary:${opts.employeeId}:${opts.timeframe}:${opts.businessTimezone}`;
  return getCachedOrLoad(cacheKey, EMPLOYEE_PERIOD_CACHE_TTL_MS, async () => {
    const slice = await loadEmployeeSqlBundleSliceCached(
      opts.employeeId,
      opts.timeframe,
      opts.businessTimezone,
    );
    return {
      periodAmountEur: slice.summary.periodAmount,
      periodTipCount: slice.summary.periodCount,
      currentMonthTotal: slice.summary.monthAmount,
    };
  });
}

/** Summary metrics + goal (reuses cached SQL bundle; goal may add one narrow query). */
export async function loadEmployeeDashboardSummaryBundle(opts: {
  employeeId: string;
  userId: string;
  businessTimezone: string;
  timeframe: EmployeeDashboardTimeframe;
  activeGoal?: EmployeeActiveGoalContext | null;
}): Promise<{
  periodAmountEur: number;
  periodTipCount: number;
  currentMonthTotal: number;
  averageRating: number | null;
  ratingCount: number;
  goal: GoalWithProgress | null;
  tips: TipForEmployee[];
  chartSeries: Array<{ label: string; amount: number }>;
}> {
  const cacheKey = `emp-dash-summary-bundle:${opts.employeeId}:${opts.timeframe}:${opts.businessTimezone}`;
  return getCachedOrLoad(cacheKey, EMPLOYEE_PERIOD_CACHE_TTL_MS, async () => {
    const tz = sanitizeIanaTimezone(opts.businessTimezone);
    const slice = await loadEmployeeSqlBundleSliceCached(opts.employeeId, opts.timeframe, tz);
    const periodRange = businessUtcRangeForTimeframe(opts.timeframe, tz);
    const monthRange = businessUtcRangeForTimeframe("month", tz);

    const periodAmountEur = slice.summary.periodAmount;
    const periodTipCount = slice.summary.periodCount;
    const currentMonthTotal = slice.summary.monthAmount;
    const { tips, chartSeries } = mapAnalyticsBundleToResponse(slice.analytics, opts.timeframe, tz);

    let goal: GoalWithProgress | null = null;
    if (periodRange && monthRange) {
      goal = await resolveGoalForSummaryBundle({
        employeeId: opts.employeeId,
        userId: opts.userId,
        businessTimezone: tz,
        timeframe: opts.timeframe,
        activeGoal: opts.activeGoal ?? null,
        periodRange,
        monthRange,
        periodAmountEur,
      });
    }

    return {
      periodAmountEur,
      periodTipCount,
      currentMonthTotal,
      averageRating: slice.summary.periodAvgRating,
      ratingCount: slice.summary.periodRatingCount,
      goal,
      tips,
      chartSeries,
    };
  });
}

/** Fast period totals for metric cards — from cached SQL bundle (no duplicate aggregate). */
export async function loadEmployeePeriodSummary(opts: {
  employeeId: string;
  businessTimezone: string;
  timeframe: EmployeeDashboardTimeframe;
}): Promise<{ periodAmountEur: number; periodTipCount: number }> {
  const summary = await loadEmployeeDashboardSummary(opts);
  return {
    periodAmountEur: summary.periodAmountEur,
    periodTipCount: summary.periodTipCount,
  };
}

/** Charts + recent tips for period analytics (cached SQL bundle). */
export async function loadEmployeePeriodAnalytics(opts: {
  employeeId: string;
  businessTimezone: string;
  timeframe: EmployeeDashboardTimeframe;
}): Promise<{
  tips: TipForEmployee[];
  chartSeries: Array<{ label: string; amount: number }>;
}> {
  const cacheKey = `emp-period-analytics:${opts.employeeId}:${opts.timeframe}:${opts.businessTimezone}`;
  return getCachedOrLoad(cacheKey, EMPLOYEE_PERIOD_CACHE_TTL_MS, async () => {
    const tz = sanitizeIanaTimezone(opts.businessTimezone);
    const slice = await loadEmployeeSqlBundleSliceCached(opts.employeeId, opts.timeframe, tz);
    return mapAnalyticsBundleToResponse(slice.analytics, opts.timeframe, tz);
  });
}

export async function loadEmployeeTipsDashboardForTimeframe(opts: {
  employeeId: string;
  businessTimezone: string;
  timeframe: EmployeeDashboardTimeframe | null;
}): Promise<{
  tips: TipForEmployee[];
  periodAmountEur: number;
  periodTipCount: number;
  chartSeries: Array<{ label: string; amount: number }>;
}> {
  const tf = opts.timeframe ?? null;
  if (tf == null) {
    return { tips: [], periodAmountEur: 0, periodTipCount: 0, chartSeries: [] };
  }

  return runSerializedByKey(`emp-stats-full:${opts.employeeId}:${tf}`, async () => {
    const tz = sanitizeIanaTimezone(opts.businessTimezone);
    const slice = await loadEmployeeSqlBundleSliceCached(opts.employeeId, tf, tz);
    const { tips, chartSeries } = mapAnalyticsBundleToResponse(slice.analytics, tf, tz);
    return {
      tips,
      periodAmountEur: slice.summary.periodAmount,
      periodTipCount: slice.summary.periodCount,
      chartSeries,
    };
  });
}

export async function loadEmployeeCurrentMonthTotal(
  employeeId: string,
  businessTimezone: string,
): Promise<number> {
  const cacheKey = `emp-month-total:${employeeId}:${businessTimezone}`;
  return getCachedOrLoad(cacheKey, EMPLOYEE_PERIOD_CACHE_TTL_MS, async () => {
    const summary = await loadEmployeeDashboardSummary({
      employeeId,
      businessTimezone,
      timeframe: "month",
    });
    return summary.currentMonthTotal;
  });
}

/** Lifetime account summary for employee dashboard hero (not period-scoped). */
export async function loadEmployeeAccountSummary(employeeId: string): Promise<{
  totalEarningsEur: number;
  /** @deprecated Prefer paidOutEur — same value (sum of tips with payout_status=paid). */
  availableBalanceEur: number;
  /** Authoritative: successful tips with payout_status = paid. */
  paidOutEur: number;
  totalSupporters: number;
}> {
  return getCachedOrLoad(`emp-account:${employeeId}`, EMPLOYEE_PERIOD_CACHE_TTL_MS, async () => {
    const rows = await logDashboardPhase("employee.account", "sql", () =>
      prisma.$queryRaw<
        Array<{
          total_earnings: number;
          paid_total: number;
          tip_count: number;
        }>
      >(Prisma.sql`
        SELECT
          COALESCE(SUM(amount), 0)::float AS total_earnings,
          COALESCE(SUM(amount) FILTER (WHERE payout_status = 'paid'), 0)::float AS paid_total,
          COUNT(*)::int AS tip_count
        FROM tips
        WHERE employee_id = ${employeeId}
          AND status = 'success'
      `),
    );
    const row = rows[0];
    const paidOutEur = Number(row?.paid_total ?? 0);
    return {
      totalEarningsEur: Number(row?.total_earnings ?? 0),
      availableBalanceEur: paidOutEur,
      paidOutEur,
      /** Each successful tip counts as one supporter interaction (guests are anonymous). */
      totalSupporters: Number(row?.tip_count ?? 0),
    };
  });
}
