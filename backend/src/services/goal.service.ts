import { EmployeeGoalStatus, GoalPeriod, Prisma, TipStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  effectiveGoalPeriodBounds,
  elapsedRatioInGoalPeriod,
  businessUtcRangeForGoalPeriod,
  sanitizeIanaTimezone,
  type GoalCalendarPeriod,
} from "../utils/businessTime.js";
import { getCachedOrLoad, invalidateCacheKey, invalidateCacheKeyPrefix } from "../utils/shortLivedCache.js";
import { emitGoalUpdatedCanonical } from "../socket/realtimeContracts.js";
import { selectMonthlyGoalMirrorAmount } from "./employeeMonthlyGoalMirror.js";

const BUSINESS_GOALS_CACHE_TTL_MS = 60_000;

function invalidateBusinessGoalsListCache(businessId: string): void {
  invalidateCacheKeyPrefix(`biz-employee-goals:${businessId}:`);
  invalidateCacheKey(`biz-dash-goals:${businessId}`);
}

function invalidateUserGoalProgressCache(userId: string): void {
  invalidateCacheKeyPrefix(`goal-progress:${userId}:`);
  invalidateCacheKeyPrefix(`emp-tips-ctx:${userId}`);
}

export { selectMonthlyGoalMirrorAmount } from "./employeeMonthlyGoalMirror.js";

export async function syncEmployeeMonthlyGoalMirror(employeeId: string): Promise<number | null> {
  const active = await prisma.employeeGoal.findMany({
    where: { employeeId, status: EmployeeGoalStatus.active },
    select: { goalAmount: true, goalPeriod: true, updatedAt: true },
  });
  const amount = selectMonthlyGoalMirrorAmount(active);
  await prisma.employee.update({
    where: { id: employeeId },
    data: { monthlyGoal: amount },
  });
  return amount;
}

/** Drop cached Overview / Business stats that embed goal progress. Never touches tip/account caches. */
export function invalidateEmployeeGoalReadCaches(opts: {
  userId?: string | null;
  employeeId: string;
  businessId: string;
}): void {
  if (opts.userId) invalidateUserGoalProgressCache(opts.userId);
  invalidateCacheKeyPrefix(`emp-period-summary:${opts.employeeId}:`);
  invalidateCacheKeyPrefix(`emp-dash-summary:${opts.employeeId}:`);
  invalidateCacheKeyPrefix(`emp-dash-summary-bundle:${opts.employeeId}:`);
  invalidateCacheKeyPrefix(`emp-period-analytics:${opts.employeeId}:`);
  invalidateBusinessGoalsListCache(opts.businessId);
  invalidateCacheKeyPrefix(`business-stats:${opts.businessId}:`);
  invalidateCacheKeyPrefix(`business-stats-summary:${opts.businessId}:`);
  invalidateCacheKeyPrefix(`business-stats-analytics:${opts.businessId}:`);
  invalidateCacheKeyPrefix(`biz-dash-summary:${opts.businessId}:`);
  invalidateCacheKeyPrefix(`biz-dash-extras:${opts.businessId}`);
  invalidateCacheKeyPrefix(`biz-dash-employees:${opts.businessId}:`);
}

async function afterEmployeeGoalMutation(opts: {
  employeeId: string;
  userId?: string | null;
  businessId: string;
  goalId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await syncEmployeeMonthlyGoalMirror(opts.employeeId);
  invalidateEmployeeGoalReadCaches(opts);
  emitGoalUpdatedCanonical(opts.businessId, opts.employeeId, opts.goalId, opts.payload);
}

function todayUtcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Settings / staff `monthlyGoal` writes must mutate `employee_goals`, not only the legacy column.
 * Clearing the monthly field archives monthly goals only (weekly/daily stay).
 */
export async function applyEmployeeMonthlyGoalFromColumn(
  employeeId: string,
  monthlyGoal: number | null,
  opts: { userId?: string | null; businessId: string },
): Promise<void> {
  if (monthlyGoal === null) {
    await prisma.employeeGoal.updateMany({
      where: {
        employeeId,
        status: EmployeeGoalStatus.active,
        goalPeriod: GoalPeriod.monthly,
      },
      data: { status: EmployeeGoalStatus.archived },
    });
  } else {
    const existing = await prisma.employeeGoal.findFirst({
      where: {
        employeeId,
        status: EmployeeGoalStatus.active,
        goalPeriod: GoalPeriod.monthly,
      },
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true },
    });
    const sd = new Date(`${todayUtcDateKey()}T12:00:00.000Z`);
    if (existing) {
      await prisma.employeeGoal.update({
        where: { id: existing.id },
        data: { goalAmount: monthlyGoal, startDate: sd, status: EmployeeGoalStatus.active },
      });
    } else {
      await prisma.employeeGoal.create({
        data: {
          employeeId,
          name: "Tip goal",
          goalAmount: monthlyGoal,
          goalPeriod: GoalPeriod.monthly,
          status: EmployeeGoalStatus.active,
          startDate: sd,
        },
      });
    }
  }
  const latest = await prisma.employeeGoal.findFirst({
    where: { employeeId, status: EmployeeGoalStatus.active },
    orderBy: [{ updatedAt: "desc" }],
    select: { id: true, goalAmount: true, status: true, updatedAt: true },
  });
  await afterEmployeeGoalMutation({
    employeeId,
    userId: opts.userId,
    businessId: opts.businessId,
    goalId: latest?.id ?? "monthly-cleared",
    payload: {
      goalAmount: latest != null ? Number(latest.goalAmount) : null,
      status: latest?.status ?? "deleted",
      updatedAt: (latest?.updatedAt ?? new Date()).toISOString(),
    },
  });
}

export type GoalProgressStatus = "achieved" | "on_track" | "below_target";

export interface GoalWithProgress {
  id: string;
  employeeId: string;
  name: string;
  goalAmount: number;
  goalPeriod: GoalPeriod;
  lifecycleStatus: "active" | "archived";
  startDate: string;
  currentAmount: number;
  percent: number;
  status: GoalProgressStatus;
}

function asGoalCalendarPeriod(period: GoalPeriod): GoalCalendarPeriod {
  return period as GoalCalendarPeriod;
}

async function resolveBusinessTimezoneForEmployee(employeeId: string): Promise<string> {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { business: { select: { timezone: true } } },
  });
  return sanitizeIanaTimezone(row?.business?.timezone);
}

async function resolveBusinessTimezoneForBusiness(businessId: string): Promise<string> {
  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  });
  return sanitizeIanaTimezone(row?.timezone);
}

/**
 * Effective window for progress: current business-local period intersected with [startDate, now].
 * Uses the same IANA timezone and boundaries as dashboard analytics (`businessTime.ts`).
 */
export function effectivePeriodBounds(
  period: GoalPeriod,
  startDate: Date,
  now = new Date(),
  businessTimezone: string,
): { start: Date; end: Date } {
  const { startUtc, endUtc } = effectiveGoalPeriodBounds(
    asGoalCalendarPeriod(period),
    startDate,
    businessTimezone,
    now,
  );
  return { start: startUtc, end: endUtc };
}

function computeStatus(
  current: number,
  goal: number,
  period: GoalPeriod,
  now: Date,
  businessTimezone: string,
): GoalProgressStatus {
  if (goal <= 0) return "below_target";
  if (current >= goal) return "achieved";
  const ratio = current / goal;
  const expected = elapsedRatioInGoalPeriod(
    asGoalCalendarPeriod(period),
    businessTimezone,
    now,
  );
  const threshold = Math.max(0.05, expected * 0.85);
  if (ratio >= threshold) return "on_track";
  return "below_target";
}

async function sumTips(employeeId: string, start: Date, end: Date): Promise<number> {
  const agg = await prisma.transaction.aggregate({
    where: {
      employeeId,
      status: TipStatus.success,
      createdAt: { gte: start, lte: end },
    },
    _sum: { amount: true },
  });
  return agg._sum.amount != null ? Number(agg._sum.amount) : 0;
}

type GoalProgressRow = {
  employeeId: string;
  goalAmount: unknown;
  goalPeriod: GoalPeriod;
  startDate: Date;
};

function goalWindowKey(
  period: GoalPeriod,
  startDate: Date,
  now: Date,
  businessTimezone: string,
): string {
  const { start, end } = effectivePeriodBounds(period, startDate, now, businessTimezone);
  return `${period}:${businessTimezone}:${start.getTime()}:${end.getTime()}`;
}

/** One tip fetch for all goal windows, then sum in memory (avoids N groupBy round-trips on connection_limit=1). */
async function batchTipTotalsForGoalRows(
  rows: GoalProgressRow[],
  now = new Date(),
  businessId?: string,
  businessTimezone?: string,
): Promise<Map<string, number>> {
  if (rows.length === 0) return new Map();

  const tz =
    businessTimezone ??
    (businessId ? await resolveBusinessTimezoneForBusiness(businessId) : sanitizeIanaTimezone(undefined));

  const windows = new Map<
    string,
    { employeeId: string; start: Date; end: Date }
  >();
  const employeeIds = new Set<string>();
  let scanStartMs = now.getTime();
  let scanEndMs = 0;

  for (const r of rows) {
    const { start, end } = effectivePeriodBounds(r.goalPeriod, r.startDate, now, tz);
    const wk = goalWindowKey(r.goalPeriod, r.startDate, now, tz);
    const key = `${r.employeeId}:${wk}`;
    if (!windows.has(key)) {
      windows.set(key, { employeeId: r.employeeId, start, end });
      employeeIds.add(r.employeeId);
      scanStartMs = Math.min(scanStartMs, start.getTime());
      scanEndMs = Math.max(scanEndMs, end.getTime());
    }
  }

  if (employeeIds.size === 0) return new Map();

  const tips = await prisma.transaction.findMany({
    where: {
      ...(businessId
        ? { businessId, employeeId: { in: [...employeeIds] } }
        : { employeeId: { in: [...employeeIds] } }),
      status: TipStatus.success,
      createdAt: {
        gte: new Date(scanStartMs),
        lte: new Date(scanEndMs),
      },
    },
    select: { employeeId: true, amount: true, createdAt: true },
  });

  const totals = new Map<string, number>();
  for (const [key, w] of windows) {
    const startMs = w.start.getTime();
    const endMs = w.end.getTime();
    let sum = 0;
    for (const t of tips) {
      if (t.employeeId !== w.employeeId) continue;
      const ts = t.createdAt.getTime();
      if (ts >= startMs && ts <= endMs) sum += Number(t.amount);
    }
    totals.set(key, sum);
  }
  return totals;
}

/** Build API goal payload from a precomputed tip sum (avoids extra DB round trip). */
export function buildActiveGoalWithProgress(
  g: {
    id: string;
    employeeId: string;
    name: string;
    goalAmount: unknown;
    goalPeriod: GoalPeriod;
    startDate: Date;
    status: EmployeeGoalStatus;
  },
  currentAmount: number,
  now = new Date(),
  businessTimezone: string,
): GoalWithProgress {
  const p = goalProgressFromAmount(
    {
      id: g.id,
      employeeId: g.employeeId,
      goalAmount: g.goalAmount,
      goalPeriod: g.goalPeriod,
      startDate: g.startDate,
    },
    currentAmount,
    now,
    businessTimezone,
  );
  return { ...p, name: g.name, lifecycleStatus: g.status };
}

function goalProgressFromAmount(
  row: GoalProgressRow & { id: string },
  currentAmount: number,
  now: Date,
  businessTimezone: string,
): Omit<GoalWithProgress, "status"> & { status: GoalProgressStatus } {
  const goalAmount = Number(row.goalAmount);
  const percent = goalAmount > 0 ? Math.min(100, Math.round((currentAmount / goalAmount) * 100)) : 0;
  const status = computeStatus(currentAmount, goalAmount, row.goalPeriod, now, businessTimezone);
  return {
    id: row.id,
    employeeId: row.employeeId,
    name: "Tip goal",
    lifecycleStatus: "active",
    goalAmount,
    goalPeriod: row.goalPeriod,
    startDate: row.startDate.toISOString().slice(0, 10),
    currentAmount,
    percent,
    status,
  };
}

export async function getGoalProgressForEmployee(
  employeeId: string,
  row: { id: string; goalAmount: unknown; goalPeriod: GoalPeriod; startDate: Date },
  now = new Date(),
  businessTimezone?: string,
): Promise<Omit<GoalWithProgress, "status"> & { status: GoalProgressStatus }> {
  const tz = businessTimezone ?? (await resolveBusinessTimezoneForEmployee(employeeId));
  const goalAmount = Number(row.goalAmount);
  const { start, end } = effectivePeriodBounds(row.goalPeriod, row.startDate, now, tz);
  const currentAmount = await sumTips(employeeId, start, end);
  const percent = goalAmount > 0 ? Math.min(100, Math.round((currentAmount / goalAmount) * 100)) : 0;
  const status = computeStatus(currentAmount, goalAmount, row.goalPeriod, now, tz);
  return {
    id: row.id,
    employeeId,
    name: "Tip goal",
    lifecycleStatus: "active",
    goalAmount,
    goalPeriod: row.goalPeriod,
    startDate: row.startDate.toISOString().slice(0, 10),
    currentAmount,
    percent,
    status,
  };
}

const GOAL_PROGRESS_CACHE_TTL_MS = 10_000;

export async function getMyGoalWithProgressForEmployee(
  employeeId: string,
  userId: string,
  businessTimezone?: string,
): Promise<GoalWithProgress | null> {
  const tz = businessTimezone ?? (await resolveBusinessTimezoneForEmployee(employeeId));
  return getCachedOrLoad(`goal-progress:${userId}:${tz}`, GOAL_PROGRESS_CACHE_TTL_MS, async () => {
    const g = await prisma.employeeGoal.findFirst({
      where: { employeeId, status: EmployeeGoalStatus.active },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (!g) return null;
    const p = await getGoalProgressForEmployee(
      employeeId,
      {
        id: g.id,
        goalAmount: g.goalAmount,
        goalPeriod: g.goalPeriod,
        startDate: g.startDate,
      },
      new Date(),
      tz,
    );
    return { ...p, name: g.name, lifecycleStatus: g.status };
  });
}

export async function getMyGoalWithProgress(userId: string): Promise<GoalWithProgress | null> {
  const emp = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!emp) return null;
  return getMyGoalWithProgressForEmployee(emp.id, userId);
}

export async function upsertMyGoal(
  userId: string,
  input: { goalAmount: number; goalPeriod: GoalPeriod; startDate: string }
): Promise<GoalWithProgress> {
  const emp = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!emp) throw new Error("Employee not found");

  if (input.goalAmount < 0 || !Number.isFinite(input.goalAmount)) {
    throw new Error("Goal amount must be a non-negative number");
  }

  const sd = new Date(input.startDate + "T12:00:00.000Z");
  if (Number.isNaN(sd.getTime())) throw new Error("Invalid start date");

  // Back-compat for old `/api/employees/me/goal` endpoint: update the most recent active goal,
  // otherwise create a new active goal.
  const existing = await prisma.employeeGoal.findFirst({
    where: { employeeId: emp.id, status: EmployeeGoalStatus.active },
    orderBy: [{ updatedAt: "desc" }],
    select: { id: true },
  });

  const row = existing
    ? await prisma.employeeGoal.update({
        where: { id: existing.id },
        data: {
          goalAmount: input.goalAmount,
          goalPeriod: input.goalPeriod,
          startDate: sd,
          status: EmployeeGoalStatus.active,
        },
      })
    : await prisma.employeeGoal.create({
        data: {
          employeeId: emp.id,
          name: "Tip goal",
          goalAmount: input.goalAmount,
          goalPeriod: input.goalPeriod,
          status: EmployeeGoalStatus.active,
          startDate: sd,
        },
      });

  const p = await getGoalProgressForEmployee(emp.id, {
    id: row.id,
    goalAmount: row.goalAmount,
    goalPeriod: row.goalPeriod,
    startDate: row.startDate,
  });
  const empBiz = await prisma.employee.findUnique({
    where: { id: emp.id },
    select: { businessId: true, userId: true },
  });
  if (empBiz?.businessId) {
    await afterEmployeeGoalMutation({
      employeeId: emp.id,
      userId: empBiz.userId ?? userId,
      businessId: empBiz.businessId,
      goalId: row.id,
      payload: {
        goalAmount: Number(row.goalAmount),
        status: row.status,
        updatedAt: row.updatedAt.toISOString(),
      },
    });
  }
  return { ...(p as GoalWithProgress), name: row.name, lifecycleStatus: row.status };
}

export async function deleteMyGoal(userId: string): Promise<void> {
  const emp = await prisma.employee.findUnique({
    where: { userId },
    select: { id: true, businessId: true },
  });
  if (!emp) throw new Error("Employee not found");
  // Back-compat: delete active goal rows only — never tips, payables, or payouts.
  await prisma.employeeGoal.deleteMany({ where: { employeeId: emp.id, status: EmployeeGoalStatus.active } });
  await afterEmployeeGoalMutation({
    employeeId: emp.id,
    userId,
    businessId: emp.businessId,
    goalId: "cleared",
    payload: { goalAmount: null, status: "deleted", updatedAt: new Date().toISOString() },
  });
}

export async function listEmployeeGoalsForBusiness(
  businessId: string,
  opts?: { maxGoals?: number },
): Promise<
  Array<{
    employeeId: string;
    name: string;
    goalAmount: number;
    goalPeriod: GoalPeriod;
    startDate: string;
    currentAmount: number;
    percent: number;
    status: GoalProgressStatus;
  }>
> {
  const maxGoals = opts?.maxGoals ?? 25;
  const cacheKey = `biz-employee-goals:${businessId}:${maxGoals}`;
  return getCachedOrLoad(cacheKey, BUSINESS_GOALS_CACHE_TTL_MS, () =>
    listEmployeeGoalsForBusinessImpl(businessId, maxGoals),
  );
}

async function listEmployeeGoalsForBusinessImpl(
  businessId: string,
  maxGoals: number,
): Promise<
  Array<{
    employeeId: string;
    name: string;
    goalAmount: number;
    goalPeriod: GoalPeriod;
    startDate: string;
    currentAmount: number;
    percent: number;
    status: GoalProgressStatus;
  }>
> {
  const limit = Math.max(1, maxGoals);
  const now = new Date();
  const tz = await resolveBusinessTimezoneForBusiness(businessId);
  const dayRange = businessUtcRangeForGoalPeriod("daily", tz);
  const weekRange = businessUtcRangeForGoalPeriod("weekly", tz);
  const monthRange = businessUtcRangeForGoalPeriod("monthly", tz);
  if (!dayRange || !weekRange || !monthRange) {
    return [];
  }
  const dayStart = dayRange.startUtc;
  const weekStart = weekRange.startUtc;
  const monthStart = monthRange.startUtc;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      employee_id: string;
      goal_amount: unknown;
      goal_period: GoalPeriod;
      start_date: Date;
      employee_name: string;
      current_amount: number;
    }>
  >(Prisma.sql`
    WITH goals AS (
      SELECT
        g.id,
        g.employee_id,
        g.goal_amount,
        g.goal_period,
        g.start_date,
        e.name AS employee_name,
        CASE g.goal_period
          WHEN 'daily' THEN ${dayStart}::timestamptz
          WHEN 'weekly' THEN ${weekStart}::timestamptz
          ELSE ${monthStart}::timestamptz
        END AS period_start
      FROM employee_goals g
      INNER JOIN employees e ON e.id = g.employee_id
      WHERE e.business_id = ${businessId}
        AND g.status = 'active'
      ORDER BY g.updated_at DESC
      LIMIT ${limit}
    )
    SELECT
      goals.id,
      goals.employee_id,
      goals.goal_amount,
      goals.goal_period,
      goals.start_date,
      goals.employee_name,
      COALESCE(SUM(t.amount), 0)::float AS current_amount
    FROM goals
    LEFT JOIN tips t
      ON t.business_id = ${businessId}
     AND t.employee_id = goals.employee_id
     AND t.status = 'success'
     AND t.created_at >= GREATEST(goals.start_date, goals.period_start)
     AND t.created_at <= ${now}
    GROUP BY
      goals.id,
      goals.employee_id,
      goals.goal_amount,
      goals.goal_period,
      goals.start_date,
      goals.employee_name
  `);

  const out: Array<{
    employeeId: string;
    name: string;
    goalAmount: number;
    goalPeriod: GoalPeriod;
    startDate: string;
    currentAmount: number;
    percent: number;
    status: GoalProgressStatus;
  }> = [];

  for (const r of rows) {
    try {
      const currentAmount = Number(r.current_amount ?? 0);
      const p = goalProgressFromAmount(
        {
          id: r.id,
          employeeId: r.employee_id,
          goalAmount: r.goal_amount,
          goalPeriod: r.goal_period,
          startDate: r.start_date,
        },
        currentAmount,
        now,
        tz,
      );
      out.push({
        employeeId: r.employee_id,
        name: r.employee_name,
        goalAmount: p.goalAmount,
        goalPeriod: p.goalPeriod,
        startDate: p.startDate,
        currentAmount: p.currentAmount,
        percent: p.percent,
        status: p.status,
      });
    } catch (err) {
      console.warn(
        "[listEmployeeGoalsForBusiness] skipped goal row",
        r.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type EmployeeGoalRow = {
  id: string;
  name: string;
  goalAmount: number;
  goalPeriod: GoalPeriod;
  status: EmployeeGoalStatus;
  startDate: string;
  createdAt: string;
  updatedAt: string;
};

export async function listMyGoals(userId: string): Promise<EmployeeGoalRow[]> {
  const emp = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!emp) throw new Error("Employee not found");
  const rows = await prisma.employeeGoal.findMany({
    where: { employeeId: emp.id },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    goalAmount: Number(r.goalAmount),
    goalPeriod: r.goalPeriod,
    status: r.status,
    startDate: r.startDate.toISOString().slice(0, 10),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createMyGoal(
  userId: string,
  input: { name: string; goalAmount: number; goalPeriod: GoalPeriod; startDate: string }
): Promise<EmployeeGoalRow> {
  const emp = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!emp) throw new Error("Employee not found");
  const sd = new Date(input.startDate + "T12:00:00.000Z");
  if (Number.isNaN(sd.getTime())) throw new Error("Invalid start date");
  const row = await prisma.employeeGoal.create({
    data: {
      employeeId: emp.id,
      name: input.name.trim() || "Tip goal",
      goalAmount: input.goalAmount,
      goalPeriod: input.goalPeriod,
      status: EmployeeGoalStatus.active,
      startDate: sd,
    },
  });
  const empBiz = await prisma.employee.findUnique({
    where: { id: emp.id },
    select: { businessId: true, userId: true },
  });
  if (empBiz?.businessId) {
    await afterEmployeeGoalMutation({
      employeeId: emp.id,
      userId: empBiz.userId ?? userId,
      businessId: empBiz.businessId,
      goalId: row.id,
      payload: {
        goalAmount: Number(row.goalAmount),
        status: row.status,
        updatedAt: row.updatedAt.toISOString(),
      },
    });
  }
  return {
    id: row.id,
    name: row.name,
    goalAmount: Number(row.goalAmount),
    goalPeriod: row.goalPeriod,
    status: row.status,
    startDate: row.startDate.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updateMyGoal(
  userId: string,
  goalId: string,
  input: Partial<{ name: string; goalAmount: number; goalPeriod: GoalPeriod; startDate: string }>
): Promise<EmployeeGoalRow> {
  const emp = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!emp) throw new Error("Employee not found");
  const row = await prisma.employeeGoal.findFirst({ where: { id: goalId, employeeId: emp.id } });
  if (!row) throw new Error("Goal not found");
  const sd =
    input.startDate !== undefined ? new Date(input.startDate + "T12:00:00.000Z") : undefined;
  if (sd && Number.isNaN(sd.getTime())) throw new Error("Invalid start date");
  const next = await prisma.employeeGoal.update({
    where: { id: row.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() || "Tip goal" } : {}),
      ...(input.goalAmount !== undefined ? { goalAmount: input.goalAmount } : {}),
      ...(input.goalPeriod !== undefined ? { goalPeriod: input.goalPeriod } : {}),
      ...(sd !== undefined ? { startDate: sd } : {}),
    },
  });
  const empBiz = await prisma.employee.findUnique({
    where: { id: emp.id },
    select: { businessId: true, userId: true },
  });
  if (empBiz?.businessId) {
    await afterEmployeeGoalMutation({
      employeeId: emp.id,
      userId: empBiz.userId ?? userId,
      businessId: empBiz.businessId,
      goalId: next.id,
      payload: {
        goalAmount: Number(next.goalAmount),
        status: next.status,
        updatedAt: next.updatedAt.toISOString(),
      },
    });
  }
  return {
    id: next.id,
    name: next.name,
    goalAmount: Number(next.goalAmount),
    goalPeriod: next.goalPeriod,
    status: next.status,
    startDate: next.startDate.toISOString().slice(0, 10),
    createdAt: next.createdAt.toISOString(),
    updatedAt: next.updatedAt.toISOString(),
  };
}

export async function archiveMyGoal(userId: string, goalId: string): Promise<EmployeeGoalRow> {
  const emp = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!emp) throw new Error("Employee not found");
  const row = await prisma.employeeGoal.findFirst({ where: { id: goalId, employeeId: emp.id } });
  if (!row) throw new Error("Goal not found");
  const next = await prisma.employeeGoal.update({
    where: { id: row.id },
    data: { status: EmployeeGoalStatus.archived },
  });
  const empBiz = await prisma.employee.findUnique({
    where: { id: emp.id },
    select: { businessId: true, userId: true },
  });
  if (empBiz?.businessId) {
    await afterEmployeeGoalMutation({
      employeeId: emp.id,
      userId: empBiz.userId ?? userId,
      businessId: empBiz.businessId,
      goalId: next.id,
      payload: {
        goalAmount: Number(next.goalAmount),
        status: next.status,
        updatedAt: next.updatedAt.toISOString(),
      },
    });
  }
  return {
    id: next.id,
    name: next.name,
    goalAmount: Number(next.goalAmount),
    goalPeriod: next.goalPeriod,
    status: next.status,
    startDate: next.startDate.toISOString().slice(0, 10),
    createdAt: next.createdAt.toISOString(),
    updatedAt: next.updatedAt.toISOString(),
  };
}

export async function deleteMyGoalById(userId: string, goalId: string): Promise<void> {
  const emp = await prisma.employee.findUnique({
    where: { userId },
    select: { id: true, businessId: true, userId: true },
  });
  if (!emp) throw new Error("Employee not found");
  const row = await prisma.employeeGoal.findFirst({ where: { id: goalId, employeeId: emp.id } });
  if (!row) throw new Error("Goal not found");
  await prisma.employeeGoal.delete({ where: { id: row.id } });
  await afterEmployeeGoalMutation({
    employeeId: emp.id,
    userId: emp.userId ?? userId,
    businessId: emp.businessId,
    goalId: row.id,
    payload: { goalAmount: null, status: "deleted", updatedAt: new Date().toISOString() },
  });
}
