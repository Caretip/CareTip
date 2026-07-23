import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../prisma.js";
import { runSerializedByKey } from "./serializedByKey.js";
import { businessDayKey, sanitizeIanaTimezone } from "./businessTime.js";
import { sqlCreatedAtLocal } from "./sqlNaiveUtcToLocal.js";
import { buildTipShiftAggregateFromHourly } from "../config/venueShiftWindows.js";

function mondayOfWeekContaining(localDay: DateTime): DateTime {
  const d = localDay.startOf("day");
  const luxonWd = d.weekday;
  return d.minus({ days: (luxonWd + 6) % 7 });
}

/** Daily tip totals keyed by business-local YYYY-MM-DD (SQL aggregation). */
export async function queryDailyTipBuckets(opts: {
  employeeId?: string;
  businessId?: string;
  startUtc: Date;
  endUtc: Date;
  timezone: string;
}): Promise<Map<string, number>> {
  const tz = sanitizeIanaTimezone(opts.timezone);
  const employeeFilter =
    opts.employeeId != null
      ? Prisma.sql`AND employee_id = ${opts.employeeId}`
      : Prisma.empty;
  const businessFilter =
    opts.businessId != null
      ? Prisma.sql`AND business_id = ${opts.businessId}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ d: string; total: number }>>(Prisma.sql`
    SELECT
      to_char(date_trunc('day', ${sqlCreatedAtLocal(tz)}), 'YYYY-MM-DD') AS d,
      COALESCE(SUM(amount), 0)::float AS total
    FROM tips
    WHERE status = 'success'
      AND created_at >= ${opts.startUtc}
      AND created_at <= ${opts.endUtc}
      ${employeeFilter}
      ${businessFilter}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(String(r.d).slice(0, 10), Number(r.total ?? 0));
  }
  return m;
}

/** Recent tips for employee period (index-friendly ORDER BY created_at DESC LIMIT n). */
export async function queryRecentEmployeeTips(opts: {
  employeeId: string;
  startUtc: Date;
  endUtc: Date;
  take: number;
}): Promise<
  Array<{
    id: string;
    amount: number;
    status: string;
    createdAt: Date;
  }>
> {
  const take = Math.max(1, Math.min(50, opts.take));
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      amount: number;
      status: string;
      created_at: Date;
    }>
  >(Prisma.sql`
    SELECT id, amount, status::text AS status, created_at
    FROM tips
    WHERE employee_id = ${opts.employeeId}
      AND status = 'success'
      AND created_at >= ${opts.startUtc}
      AND created_at <= ${opts.endUtc}
    ORDER BY created_at DESC
    LIMIT ${take}
  `);
  return rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    status: r.status,
    createdAt: r.created_at,
  }));
}

type RecentTipJsonRow = {
  id: string;
  amount: number;
  status: string;
  created_at: string | Date;
};

type BucketJsonRow = { h?: number; d?: string; total: number };

function parseRecentTipsJson(raw: unknown): Array<{
  id: string;
  amount: number;
  status: string;
  createdAt: Date;
}> {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const t = row as RecentTipJsonRow;
    return {
      id: String(t.id),
      amount: Number(t.amount ?? 0),
      status: String(t.status ?? "success"),
      createdAt: t.created_at instanceof Date ? t.created_at : new Date(t.created_at),
    };
  });
}

function parseHourlyBucketsJson(raw: unknown): Map<number, number> {
  const m = new Map<number, number>();
  if (!Array.isArray(raw)) return m;
  for (const row of raw as BucketJsonRow[]) {
    const h = Number(row.h);
    if (h >= 0 && h < 24) m.set(h, Number(row.total ?? 0));
  }
  return m;
}

function parseDailyBucketsJson(raw: unknown): Map<string, number> {
  const m = new Map<string, number>();
  if (!Array.isArray(raw)) return m;
  for (const row of raw as BucketJsonRow[]) {
    const d = String(row.d ?? "").slice(0, 10);
    if (d) m.set(d, Number(row.total ?? 0));
  }
  return m;
}

/**
 * Recent tips + chart buckets in one round trip (required when Prisma connection_limit=1).
 */
export async function queryEmployeeAnalyticsBundle(opts: {
  employeeId: string;
  startUtc: Date;
  endUtc: Date;
  timezone: string;
  timeframe: "today" | "week" | "month";
  recentTake: number;
}): Promise<{
  recentTips: Array<{ id: string; amount: number; status: string; createdAt: Date }>;
  dailyByYmd: Map<string, number>;
  hourlyByHour: Map<number, number>;
}> {
  const tz = sanitizeIanaTimezone(opts.timezone);
  const take = Math.max(1, Math.min(50, opts.recentTake));

  if (opts.timeframe === "today") {
    const rows = await prisma.$queryRaw<
      Array<{ recent_json: unknown; buckets_json: unknown }>
    >(Prisma.sql`
      SELECT
        (
          SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
          FROM (
            SELECT id, amount, status::text AS status, created_at
            FROM tips
            WHERE employee_id = ${opts.employeeId}
              AND status = 'success'
              AND created_at >= ${opts.startUtc}
              AND created_at <= ${opts.endUtc}
            ORDER BY created_at DESC
            LIMIT ${take}
          ) r
        ) AS recent_json,
        (
          SELECT COALESCE(json_agg(row_to_json(b)), '[]'::json)
          FROM (
            SELECT
              EXTRACT(HOUR FROM (${sqlCreatedAtLocal(tz)}))::int AS h,
              COALESCE(SUM(amount), 0)::float AS total
            FROM tips
            WHERE employee_id = ${opts.employeeId}
              AND status = 'success'
              AND created_at >= ${opts.startUtc}
              AND created_at <= ${opts.endUtc}
            GROUP BY 1
          ) b
        ) AS buckets_json
    `);
    const row = rows[0];
    return {
      recentTips: parseRecentTipsJson(row?.recent_json),
      dailyByYmd: new Map(),
      hourlyByHour: parseHourlyBucketsJson(row?.buckets_json),
    };
  }

  const rows = await prisma.$queryRaw<
    Array<{ recent_json: unknown; buckets_json: unknown }>
  >(Prisma.sql`
    SELECT
      (
        SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
        FROM (
          SELECT id, amount, status::text AS status, created_at
          FROM tips
          WHERE employee_id = ${opts.employeeId}
            AND status = 'success'
            AND created_at >= ${opts.startUtc}
            AND created_at <= ${opts.endUtc}
          ORDER BY created_at DESC
          LIMIT ${take}
        ) r
      ) AS recent_json,
      (
        SELECT COALESCE(json_agg(row_to_json(b)), '[]'::json)
        FROM (
          SELECT
            to_char(date_trunc('day', ${sqlCreatedAtLocal(tz)}), 'YYYY-MM-DD') AS d,
            COALESCE(SUM(amount), 0)::float AS total
          FROM tips
          WHERE employee_id = ${opts.employeeId}
            AND status = 'success'
            AND created_at >= ${opts.startUtc}
            AND created_at <= ${opts.endUtc}
          GROUP BY 1
        ) b
      ) AS buckets_json
  `);
  const row = rows[0];
  return {
    recentTips: parseRecentTipsJson(row?.recent_json),
    dailyByYmd: parseDailyBucketsJson(row?.buckets_json),
    hourlyByHour: new Map(),
  };
}

/** Hourly tip totals for business-local day (0–23). */
export async function queryHourlyTipBuckets(opts: {
  employeeId?: string;
  businessId?: string;
  startUtc: Date;
  endUtc: Date;
  timezone: string;
}): Promise<Map<number, number>> {
  const tz = sanitizeIanaTimezone(opts.timezone);
  const employeeFilter =
    opts.employeeId != null
      ? Prisma.sql`AND employee_id = ${opts.employeeId}`
      : Prisma.empty;
  const businessFilter =
    opts.businessId != null
      ? Prisma.sql`AND business_id = ${opts.businessId}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ h: number; total: number }>>(Prisma.sql`
    SELECT
      EXTRACT(HOUR FROM (${sqlCreatedAtLocal(tz)}))::int AS h,
      COALESCE(SUM(amount), 0)::float AS total
    FROM tips
    WHERE status = 'success'
      AND created_at >= ${opts.startUtc}
      AND created_at <= ${opts.endUtc}
      ${employeeFilter}
      ${businessFilter}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const m = new Map<number, number>();
  for (const r of rows) {
    const h = Number(r.h);
    if (h >= 0 && h < 24) m.set(h, Number(r.total ?? 0));
  }
  return m;
}

/**
 * Period tip € by venue-local hour + completed (day × shift) buckets for avg tips/shift.
 * Shift windows: morning 6–12, afternoon 12–17, evening 17–22, late 22–6 (wraps).
 */
export async function queryBusinessTipShiftAggregates(opts: {
  businessId: string;
  startUtc: Date;
  endUtc: Date;
  timezone: string;
}): Promise<{
  hourlyByHour: Map<number, number>;
  tipCountByHour: Map<number, number>;
  completedShifts: number;
}> {
  const tz = sanitizeIanaTimezone(opts.timezone);
  const [hourlyRows, completedRows] = await Promise.all([
    prisma.$queryRaw<Array<{ h: number; total: number; tip_count: number }>>(Prisma.sql`
      SELECT
        EXTRACT(HOUR FROM (${sqlCreatedAtLocal(tz)}))::int AS h,
        COALESCE(SUM(amount), 0)::float AS total,
        COUNT(*)::int AS tip_count
      FROM tips
      WHERE business_id = ${opts.businessId}
        AND status = 'success'
        AND created_at >= ${opts.startUtc}
        AND created_at <= ${opts.endUtc}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    prisma.$queryRaw<Array<{ completed: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS completed
      FROM (
        SELECT
          to_char(date_trunc('day', ${sqlCreatedAtLocal(tz)}), 'YYYY-MM-DD') AS d,
          CASE
            WHEN EXTRACT(HOUR FROM (${sqlCreatedAtLocal(tz)}))::int >= 6
              AND EXTRACT(HOUR FROM (${sqlCreatedAtLocal(tz)}))::int < 12 THEN 'morning'
            WHEN EXTRACT(HOUR FROM (${sqlCreatedAtLocal(tz)}))::int >= 12
              AND EXTRACT(HOUR FROM (${sqlCreatedAtLocal(tz)}))::int < 17 THEN 'afternoon'
            WHEN EXTRACT(HOUR FROM (${sqlCreatedAtLocal(tz)}))::int >= 17
              AND EXTRACT(HOUR FROM (${sqlCreatedAtLocal(tz)}))::int < 22 THEN 'evening'
            ELSE 'late'
          END AS shift_key
        FROM tips
        WHERE business_id = ${opts.businessId}
          AND status = 'success'
          AND created_at >= ${opts.startUtc}
          AND created_at <= ${opts.endUtc}
        GROUP BY 1, 2
      ) s
    `),
  ]);

  const hourlyByHour = new Map<number, number>();
  const tipCountByHour = new Map<number, number>();
  for (const r of hourlyRows) {
    const h = Number(r.h);
    if (h >= 0 && h < 24) {
      hourlyByHour.set(h, Number(r.total ?? 0));
      tipCountByHour.set(h, Number(r.tip_count ?? 0));
    }
  }
  return {
    hourlyByHour,
    tipCountByHour,
    completedShifts: Number(completedRows[0]?.completed ?? 0),
  };
}

/** Monthly tip totals for a year window (index 0 = January). */
export async function queryMonthlyTipTotalsForRange(opts: {
  businessId?: string;
  employeeId?: string;
  startUtc: Date;
  endUtc: Date;
  timezone: string;
}): Promise<number[]> {
  const tz = sanitizeIanaTimezone(opts.timezone);
  const employeeFilter =
    opts.employeeId != null
      ? Prisma.sql`AND employee_id = ${opts.employeeId}`
      : Prisma.empty;
  const businessFilter =
    opts.businessId != null
      ? Prisma.sql`AND business_id = ${opts.businessId}`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ m: number; total: number }>>(Prisma.sql`
    SELECT
      EXTRACT(MONTH FROM (${sqlCreatedAtLocal(tz)}))::int AS m,
      COALESCE(SUM(amount), 0)::float AS total
    FROM tips
    WHERE status = 'success'
      AND created_at >= ${opts.startUtc}
      AND created_at <= ${opts.endUtc}
      ${employeeFilter}
      ${businessFilter}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const monthTotals = new Array(12).fill(0);
  for (const r of rows) {
    const idx = Number(r.m) - 1;
    if (idx >= 0 && idx < 12) monthTotals[idx] = Number(r.total ?? 0);
  }
  return monthTotals;
}

/** All-time tip totals by venue-local calendar year (for timeframe=all chart reconciliation). */
export async function queryYearlyTipTotalsForRange(opts: {
  businessId: string;
  startUtc: Date;
  endUtc: Date;
  timezone: string;
}): Promise<Array<{ year: number; total: number }>> {
  const tz = sanitizeIanaTimezone(opts.timezone);
  const rows = await prisma.$queryRaw<Array<{ y: number; total: number }>>(Prisma.sql`
    SELECT
      EXTRACT(YEAR FROM (${sqlCreatedAtLocal(tz)}))::int AS y,
      COALESCE(SUM(amount), 0)::float AS total
    FROM tips
    WHERE status = 'success'
      AND business_id = ${opts.businessId}
      AND created_at >= ${opts.startUtc}
      AND created_at <= ${opts.endUtc}
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  return rows.map((r) => ({ year: Number(r.y), total: Number(r.total ?? 0) }));
}

/** Location / table tip rollups for a period (SSOT rankings — not feed samples). */
export async function queryTipRankingsByLocationAndTable(opts: {
  businessId: string;
  startUtc: Date;
  endUtc: Date;
}): Promise<{
  locations: Array<{ id: string | null; name: string; tipsEur: number; tipCount: number }>;
  tables: Array<{ id: string | null; name: string; tipsEur: number; tipCount: number }>;
}> {
  const locationRows = await prisma.$queryRaw<
    Array<{ id: string | null; name: string | null; tips_eur: number; tip_count: number }>
  >(Prisma.sql`
    SELECT
      t.location_id AS id,
      COALESCE(NULLIF(TRIM(l.name), ''), 'Main venue') AS name,
      COALESCE(SUM(t.amount), 0)::float AS tips_eur,
      COUNT(*)::int AS tip_count
    FROM tips t
    LEFT JOIN locations l ON l.id = t.location_id
    WHERE t.business_id = ${opts.businessId}
      AND t.status = 'success'
      AND t.created_at >= ${opts.startUtc}
      AND t.created_at <= ${opts.endUtc}
    GROUP BY t.location_id, l.name
    ORDER BY tips_eur DESC
    LIMIT 25
  `);

  const tableRows = await prisma.$queryRaw<
    Array<{ id: string | null; name: string | null; tips_eur: number; tip_count: number }>
  >(Prisma.sql`
    SELECT
      t.table_id AS id,
      COALESCE(NULLIF(TRIM(tb.name), ''), '—') AS name,
      COALESCE(SUM(t.amount), 0)::float AS tips_eur,
      COUNT(*)::int AS tip_count
    FROM tips t
    LEFT JOIN venue_tables tb ON tb.id = t.table_id
    WHERE t.business_id = ${opts.businessId}
      AND t.status = 'success'
      AND t.created_at >= ${opts.startUtc}
      AND t.created_at <= ${opts.endUtc}
      AND t.table_id IS NOT NULL
    GROUP BY t.table_id, tb.name
    ORDER BY tips_eur DESC
    LIMIT 25
  `);

  return {
    locations: locationRows.map((r) => ({
      id: r.id,
      name: String(r.name ?? "Main venue"),
      tipsEur: Number(r.tips_eur ?? 0),
      tipCount: Number(r.tip_count ?? 0),
    })),
    tables: tableRows.map((r) => ({
      id: r.id,
      name: String(r.name ?? "—"),
      tipsEur: Number(r.tips_eur ?? 0),
      tipCount: Number(r.tip_count ?? 0),
    })),
  };
}

/** Prior window of equal length ending just before rangeStart (WoW / MoM / YoY base). */
export async function queryPriorPeriodTipTotals(opts: {
  businessId: string;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<{ totalTips: number; tipCount: number }> {
  const durationMs = Math.max(0, opts.rangeEnd.getTime() - opts.rangeStart.getTime());
  const priorEnd = new Date(opts.rangeStart.getTime() - 1);
  const priorStart = new Date(priorEnd.getTime() - durationMs);
  const [row] = await prisma.$queryRaw<Array<{ total: number; c: number }>>(Prisma.sql`
    SELECT
      COALESCE(SUM(amount), 0)::float AS total,
      COUNT(*)::int AS c
    FROM tips
    WHERE business_id = ${opts.businessId}
      AND status = 'success'
      AND created_at >= ${priorStart}
      AND created_at <= ${priorEnd}
  `);
  return {
    totalTips: Number(row?.total ?? 0),
    tipCount: Number(row?.c ?? 0),
  };
}

export type BusinessDashboardTimeframe = "week" | "month" | "year" | "all";

function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      // ignore
    }
  }
  return [];
}

export type BusinessDashboardSqlSummary = {
  periodAmount: number;
  periodCount: number;
  last60Amount: number;
  last60Count: number;
  todayAmount: number;
  todayCount: number;
};

export type BusinessDashboardMetaSummaryRow = {
  id: string;
  name: string;
  slug: string | null;
  verification_status: string;
  onboarding_verification_status: string;
  kyc_verification_status: string;
  timezone: string | null;
  roster_total: number;
  tipping_ready: number;
  missing_qr: number;
  period_amount: number;
  period_count: number;
  last60_amount: number;
  last60_count: number;
  today_amount: number;
  today_count: number;
};

/**
 * Business + roster + tip KPIs in one round trip.
 * Period windows are computed in SQL from `businesses.timezone` (no prior tz fetch).
 */
export async function queryBusinessDashboardMetaAndSummaryMetrics(opts: {
  businessId: string;
  timeframe: BusinessDashboardTimeframe;
  /** Optional explicit ranges — when omitted, SQL derives bounds from business timezone. */
  rangeStart?: Date;
  rangeEnd?: Date;
  scanStart?: Date;
  scanEnd?: Date;
  sixtyAgo: Date;
  todayStart?: Date;
  todayEnd: Date;
}): Promise<BusinessDashboardMetaSummaryRow> {
  const shouldLog =
    process.env.NODE_ENV !== "production" || process.env.DASHBOARD_TIMING === "1";
  const t0 = performance.now();

  const useSqlBounds = opts.rangeStart == null || opts.rangeEnd == null;

  const [row] = await prisma.$queryRaw<BusinessDashboardMetaSummaryRow[]>(
    useSqlBounds
      ? Prisma.sql`
    WITH biz AS (
      SELECT
        b.id,
        b.name,
        b.slug,
        b.verification_status,
        b.onboarding_verification_status,
        b.kyc_verification_status,
        b.timezone,
        COALESCE(NULLIF(TRIM(b.timezone), ''), 'UTC') AS tz
      FROM businesses b
      WHERE b.id = ${opts.businessId}
    ),
    bounds AS (
      SELECT
        CASE
          WHEN ${opts.timeframe} = 'all' THEN TIMESTAMPTZ '1970-01-01'
          WHEN ${opts.timeframe} = 'year' THEN (date_trunc('year', now() AT TIME ZONE biz.tz) AT TIME ZONE biz.tz)
          WHEN ${opts.timeframe} = 'month' THEN (date_trunc('month', now() AT TIME ZONE biz.tz) AT TIME ZONE biz.tz)
          WHEN ${opts.timeframe} = 'week' THEN (date_trunc('week', now() AT TIME ZONE biz.tz) AT TIME ZONE biz.tz)
          ELSE (date_trunc('day', now() AT TIME ZONE biz.tz) AT TIME ZONE biz.tz)
        END AS range_start,
        CASE
          WHEN ${opts.timeframe} = 'all' THEN ${opts.todayEnd}
          WHEN ${opts.timeframe} = 'year' THEN ((date_trunc('year', now() AT TIME ZONE biz.tz) + INTERVAL '1 year' - INTERVAL '1 microsecond') AT TIME ZONE biz.tz)
          WHEN ${opts.timeframe} = 'month' THEN ((date_trunc('month', now() AT TIME ZONE biz.tz) + INTERVAL '1 month' - INTERVAL '1 microsecond') AT TIME ZONE biz.tz)
          WHEN ${opts.timeframe} = 'week' THEN ((date_trunc('week', now() AT TIME ZONE biz.tz) + INTERVAL '7 days' - INTERVAL '1 microsecond') AT TIME ZONE biz.tz)
          ELSE ((date_trunc('day', now() AT TIME ZONE biz.tz) + INTERVAL '1 day' - INTERVAL '1 microsecond') AT TIME ZONE biz.tz)
        END AS range_end,
        (date_trunc('day', now() AT TIME ZONE biz.tz) AT TIME ZONE biz.tz) AS today_start,
        biz.tz
      FROM biz
    ),
    tip_scoped AS (
      SELECT t.amount, t.created_at
      FROM tips t
      CROSS JOIN bounds bd
      WHERE t.business_id = ${opts.businessId}
        AND t.status = 'success'
        AND t.created_at >= LEAST(bd.range_start, ${opts.sixtyAgo}, bd.today_start)
        AND t.created_at <= GREATEST(bd.range_end, ${opts.todayEnd})
    ),
    tip_agg AS (
      SELECT
        COALESCE(SUM(ts.amount) FILTER (
          WHERE ts.created_at >= bd.range_start AND ts.created_at <= bd.range_end
        ), 0)::float AS period_amount,
        (COUNT(*) FILTER (
          WHERE ts.created_at >= bd.range_start AND ts.created_at <= bd.range_end
        ))::int AS period_count,
        COALESCE(SUM(ts.amount) FILTER (
          WHERE ts.created_at >= ${opts.sixtyAgo}
        ), 0)::float AS last60_amount,
        (COUNT(*) FILTER (
          WHERE ts.created_at >= ${opts.sixtyAgo}
        ))::int AS last60_count,
        COALESCE(SUM(ts.amount) FILTER (
          WHERE ts.created_at >= bd.today_start AND ts.created_at <= ${opts.todayEnd}
        ), 0)::float AS today_amount,
        (COUNT(*) FILTER (
          WHERE ts.created_at >= bd.today_start AND ts.created_at <= ${opts.todayEnd}
        ))::int AS today_count
      FROM tip_scoped ts
      CROSS JOIN bounds bd
    ),
    roster AS (
      SELECT
        COUNT(e.id)::int AS roster_total,
        COUNT(e.id) FILTER (
          WHERE e.is_active = true
            AND e.activation_status = 'active'
            AND u.email_verified = true
        )::int AS tipping_ready,
        COUNT(e.id) FILTER (
          WHERE e.slug IS NULL OR TRIM(e.slug) = ''
        )::int AS missing_qr
      FROM employees e
      LEFT JOIN "User" u ON u.id = e.user_id
      WHERE e.business_id = ${opts.businessId}
    )
    SELECT
      biz.id,
      biz.name,
      biz.slug,
      biz.verification_status,
      biz.onboarding_verification_status,
      biz.kyc_verification_status,
      biz.timezone,
      r.roster_total,
      r.tipping_ready,
      r.missing_qr,
      ta.period_amount,
      ta.period_count,
      ta.last60_amount,
      ta.last60_count,
      ta.today_amount,
      ta.today_count
    FROM biz
    CROSS JOIN roster r
    CROSS JOIN tip_agg ta
  `
      : Prisma.sql`
    WITH tip_scoped AS (
      SELECT amount, created_at
      FROM tips
      WHERE business_id = ${opts.businessId}
        AND status = 'success'
        AND created_at >= ${new Date(
          Math.min(
            (opts.scanStart ?? opts.rangeStart)!.getTime(),
            opts.sixtyAgo.getTime(),
            (opts.todayStart ?? opts.rangeStart)!.getTime(),
          ),
        )}
        AND created_at <= ${new Date(
          Math.max((opts.scanEnd ?? opts.rangeEnd)!.getTime(), opts.todayEnd.getTime()),
        )}
    ),
    tip_agg AS (
      SELECT
        COALESCE(SUM(amount) FILTER (
          WHERE created_at >= ${opts.rangeStart!} AND created_at <= ${opts.rangeEnd!}
        ), 0)::float AS period_amount,
        (COUNT(*) FILTER (
          WHERE created_at >= ${opts.rangeStart!} AND created_at <= ${opts.rangeEnd!}
        ))::int AS period_count,
        COALESCE(SUM(amount) FILTER (
          WHERE created_at >= ${opts.sixtyAgo}
        ), 0)::float AS last60_amount,
        (COUNT(*) FILTER (
          WHERE created_at >= ${opts.sixtyAgo}
        ))::int AS last60_count,
        COALESCE(SUM(amount) FILTER (
          WHERE created_at >= ${opts.todayStart!} AND created_at <= ${opts.todayEnd}
        ), 0)::float AS today_amount,
        (COUNT(*) FILTER (
          WHERE created_at >= ${opts.todayStart!} AND created_at <= ${opts.todayEnd}
        ))::int AS today_count
      FROM tip_scoped
    ),
    roster AS (
      SELECT
        COUNT(e.id)::int AS roster_total,
        COUNT(e.id) FILTER (
          WHERE e.is_active = true
            AND e.activation_status = 'active'
            AND u.email_verified = true
        )::int AS tipping_ready,
        COUNT(e.id) FILTER (
          WHERE e.slug IS NULL OR TRIM(e.slug) = ''
        )::int AS missing_qr
      FROM employees e
      LEFT JOIN "User" u ON u.id = e.user_id
      WHERE e.business_id = ${opts.businessId}
    )
    SELECT
      b.id,
      b.name,
      b.slug,
      b.verification_status,
      b.onboarding_verification_status,
      b.kyc_verification_status,
      b.timezone,
      r.roster_total,
      r.tipping_ready,
      r.missing_qr,
      ta.period_amount,
      ta.period_count,
      ta.last60_amount,
      ta.last60_count,
      ta.today_amount,
      ta.today_count
    FROM businesses b
    CROSS JOIN roster r
    CROSS JOIN tip_agg ta
    WHERE b.id = ${opts.businessId}
  `,
  );

  if (!row) {
    throw new Error("Business not found");
  }

  const tSql = Math.round(performance.now() - t0);
  if (shouldLog) {
    console.info(
      `[dashboard.timing] business.myStats.${opts.timeframe}.metaSummarySql ${tSql}ms`,
      { businessId: opts.businessId, sqlBounds: useSqlBounds },
    );
  }

  return row;
}

export type BusinessDashboardSqlBundle = {
  summary: BusinessDashboardSqlSummary;
  tipsByEmployee: Map<string, { total: number; count: number }>;
  dailyByYmd: Map<string, number>;
  monthTotals: number[] | null;
  /** All-time yearly buckets (timeframe=all). */
  yearTotals: Array<{ year: number; total: number }> | null;
  locationRankings: Array<{ id: string | null; name: string; tipsEur: number; tipCount: number }>;
  tableRankings: Array<{ id: string | null; name: string; tipsEur: number; tipCount: number }>;
  priorPeriod: { totalTips: number; tipCount: number };
  /** SQL hour + shift aggregates for peakHour / bestShift / avgTipsPerShift. */
  shiftAggregate: import("../config/venueShiftWindows.js").TipShiftAggregate;
};

/** Per-employee tip totals for a business period (simple GROUP BY — pool-safe). */
async function queryBusinessTipsByEmployee(opts: {
  businessId: string;
  startUtc: Date;
  endUtc: Date;
}): Promise<Map<string, { total: number; count: number }>> {
  const rows = await prisma.$queryRaw<
    Array<{ employee_id: string; total: number; count: number }>
  >(Prisma.sql`
    SELECT
      employee_id,
      COALESCE(SUM(amount), 0)::float AS total,
      COUNT(*)::int AS count
    FROM tips
    WHERE business_id = ${opts.businessId}
      AND status = 'success'
      AND created_at >= ${opts.startUtc}
      AND created_at <= ${opts.endUtc}
    GROUP BY employee_id
    ORDER BY employee_id ASC
  `);

  const m = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    m.set(String(r.employee_id), {
      total: Number(r.total ?? 0),
      count: Number(r.count ?? 0),
    });
  }
  return m;
}

export type EmployeeDashboardSqlSummary = {
  periodAmount: number;
  periodCount: number;
  monthAmount: number;
  periodAvgRating: number | null;
  periodRatingCount: number;
};

/** Period + current-month totals for employee metric cards (single tips scan). */
export async function queryEmployeeDashboardSummaryMetrics(opts: {
  employeeId: string;
  periodStart: Date;
  periodEnd: Date;
  monthStart: Date;
  monthEnd: Date;
  scanStart: Date;
  scanEnd: Date;
}): Promise<EmployeeDashboardSqlSummary> {
  const shouldLog =
    process.env.NODE_ENV !== "production" || process.env.DASHBOARD_TIMING === "1";
  const t0 = performance.now();
  const [row] = await prisma.$queryRaw<
    Array<{
      period_amount: number;
      period_count: number;
      month_amount: number;
      period_avg_rating: number | null;
      period_rating_count: number;
    }>
  >(Prisma.sql`
    SELECT
      COALESCE(SUM(t.amount) FILTER (
        WHERE t.created_at >= ${opts.periodStart} AND t.created_at <= ${opts.periodEnd}
      ), 0)::float AS period_amount,
      (COUNT(*) FILTER (
        WHERE t.created_at >= ${opts.periodStart} AND t.created_at <= ${opts.periodEnd}
      ))::int AS period_count,
      COALESCE(SUM(t.amount) FILTER (
        WHERE t.created_at >= ${opts.monthStart} AND t.created_at <= ${opts.monthEnd}
      ), 0)::float AS month_amount,
      AVG(tf.rating) FILTER (
        WHERE t.created_at >= ${opts.periodStart}
          AND t.created_at <= ${opts.periodEnd}
          AND tf.rating IS NOT NULL
      )::float AS period_avg_rating,
      (COUNT(tf.id) FILTER (
        WHERE t.created_at >= ${opts.periodStart}
          AND t.created_at <= ${opts.periodEnd}
          AND tf.rating IS NOT NULL
      ))::int AS period_rating_count
    FROM tips t
    LEFT JOIN tip_feedback tf ON tf.transaction_id = t.id
    WHERE t.employee_id = ${opts.employeeId}
      AND t.status = 'success'
      AND t.created_at >= ${opts.scanStart}
      AND t.created_at <= ${opts.scanEnd}
  `);

  const tSql = Math.round(performance.now() - t0);
  if (shouldLog) {
    console.info(`[dashboard.timing] employee.summaryMetrics ${tSql}ms`, {
      employeeId: opts.employeeId,
    });
  }

  const avgRaw = row?.period_avg_rating;
  const periodAvgRating =
    avgRaw != null && Number.isFinite(Number(avgRaw)) ? Math.round(Number(avgRaw) * 10) / 10 : null;

  return {
    periodAmount: Number(row?.period_amount ?? 0),
    periodCount: Number(row?.period_count ?? 0),
    monthAmount: Number(row?.month_amount ?? 0),
    periodAvgRating,
    periodRatingCount: Number(row?.period_rating_count ?? 0),
  };
}

/**
 * Analytics chart/employee aggregates + summary metrics.
 * Runs summary first, then period-scoped employee/chart queries sequentially
 * (Supabase transaction pooler is often connection_limit=1).
 */
export async function queryBusinessDashboardSqlBundle(opts: {
  businessId: string;
  timeframe: BusinessDashboardTimeframe;
  rangeStart: Date;
  rangeEnd: Date;
  scanStart: Date;
  scanEnd: Date;
  sixtyAgo: Date;
  todayStart: Date;
  todayEnd: Date;
  timezone: string;
}): Promise<BusinessDashboardSqlBundle> {
  const shouldLog =
    process.env.NODE_ENV !== "production" || process.env.DASHBOARD_TIMING === "1";
  const t0 = performance.now();
  const tz = sanitizeIanaTimezone(opts.timezone);
  const periodStart = opts.timeframe === "all" ? opts.scanStart : opts.rangeStart;
  const periodEnd = opts.timeframe === "all" ? opts.scanEnd : opts.rangeEnd;

  const summary = await queryBusinessDashboardSummaryMetrics({
    businessId: opts.businessId,
    timeframe: opts.timeframe,
    rangeStart: opts.rangeStart,
    rangeEnd: opts.rangeEnd,
    scanStart: opts.scanStart,
    scanEnd: opts.scanEnd,
    sixtyAgo: opts.sixtyAgo,
    todayStart: opts.todayStart,
    todayEnd: opts.todayEnd,
  });

  const tEmp0 = performance.now();
  const tipsByEmployee = await queryBusinessTipsByEmployee({
    businessId: opts.businessId,
    startUtc: periodStart,
    endUtc: periodEnd,
  });
  const tipsByEmployeeMs = Math.round(performance.now() - tEmp0);

  let dailyByYmd = new Map<string, number>();
  let dailyBucketsMs = 0;
  if (opts.timeframe === "week" || opts.timeframe === "month") {
    const tDaily0 = performance.now();
    dailyByYmd = await queryDailyTipBuckets({
      businessId: opts.businessId,
      startUtc: periodStart,
      endUtc: periodEnd,
      timezone: tz,
    });
    dailyBucketsMs = Math.round(performance.now() - tDaily0);
  }

  let monthTotals: number[] | null = null;
  let monthTotalsMs = 0;
  let yearTotals: Array<{ year: number; total: number }> | null = null;
  if (opts.timeframe === "year") {
    const tMonth0 = performance.now();
    monthTotals = await queryMonthlyTipTotalsForRange({
      businessId: opts.businessId,
      startUtc: periodStart,
      endUtc: periodEnd,
      timezone: tz,
    });
    monthTotalsMs = Math.round(performance.now() - tMonth0);
  } else if (opts.timeframe === "all") {
    const tYear0 = performance.now();
    yearTotals = await queryYearlyTipTotalsForRange({
      businessId: opts.businessId,
      startUtc: periodStart,
      endUtc: periodEnd,
      timezone: tz,
    });
    monthTotalsMs = Math.round(performance.now() - tYear0);
  }

  const rankings = await queryTipRankingsByLocationAndTable({
    businessId: opts.businessId,
    startUtc: periodStart,
    endUtc: periodEnd,
  });

  const priorPeriod =
    opts.timeframe === "all"
      ? { totalTips: 0, tipCount: 0 }
      : await queryPriorPeriodTipTotals({
          businessId: opts.businessId,
          rangeStart: periodStart,
          rangeEnd: periodEnd,
        });

  const shiftRaw = await queryBusinessTipShiftAggregates({
    businessId: opts.businessId,
    startUtc: periodStart,
    endUtc: periodEnd,
    timezone: tz,
  });
  const shiftAggregate = buildTipShiftAggregateFromHourly(
    shiftRaw.hourlyByHour,
    shiftRaw.completedShifts,
    shiftRaw.tipCountByHour,
  );

  const tSql = Math.round(performance.now() - t0);
  if (shouldLog) {
    console.info(
      `[dashboard.timing] business.myStats.${opts.timeframe}.sqlBundle ${tSql}ms`,
      {
        businessId: opts.businessId,
        tipsByEmployeeMs,
        dailyBucketsMs,
        monthTotalsMs,
        sequentialQueries: 3 + (dailyBucketsMs > 0 || monthTotalsMs > 0 ? 1 : 0),
      },
    );
  }

  return {
    summary,
    tipsByEmployee,
    dailyByYmd,
    monthTotals,
    yearTotals,
    locationRankings: rankings.locations,
    tableRankings: rankings.tables,
    priorPeriod,
    shiftAggregate,
  };
}

/**
 * Hero/summary cards only — one bounded tips scan (period + pulse).
 * Does not load per-employee or chart aggregates.
 */
export async function queryBusinessDashboardSummaryMetrics(opts: {
  businessId: string;
  timeframe: BusinessDashboardTimeframe;
  rangeStart: Date;
  rangeEnd: Date;
  scanStart: Date;
  scanEnd: Date;
  sixtyAgo: Date;
  todayStart: Date;
  todayEnd: Date;
}): Promise<BusinessDashboardSqlSummary> {
  const shouldLog =
    process.env.NODE_ENV !== "production" || process.env.DASHBOARD_TIMING === "1";
  const t0 = performance.now();

  // Bound the scan to period ∪ pulse windows — never scan the full tips history for KPIs.
  const lowerBound = new Date(
    Math.min(opts.scanStart.getTime(), opts.sixtyAgo.getTime(), opts.todayStart.getTime()),
  );
  const upperBound = new Date(
    Math.max(opts.scanEnd.getTime(), opts.todayEnd.getTime()),
  );

  const [row] = await prisma.$queryRaw<
    Array<{
      period_amount: number;
      period_count: number;
      last60_amount: number;
      last60_count: number;
      today_amount: number;
      today_count: number;
    }>
  >(Prisma.sql`
    SELECT
      COALESCE(SUM(amount) FILTER (
        WHERE created_at >= ${opts.rangeStart} AND created_at <= ${opts.rangeEnd}
      ), 0)::float AS period_amount,
      (COUNT(*) FILTER (
        WHERE created_at >= ${opts.rangeStart} AND created_at <= ${opts.rangeEnd}
      ))::int AS period_count,
      COALESCE(SUM(amount) FILTER (
        WHERE created_at >= ${opts.sixtyAgo}
      ), 0)::float AS last60_amount,
      (COUNT(*) FILTER (
        WHERE created_at >= ${opts.sixtyAgo}
      ))::int AS last60_count,
      COALESCE(SUM(amount) FILTER (
        WHERE created_at >= ${opts.todayStart} AND created_at <= ${opts.todayEnd}
      ), 0)::float AS today_amount,
      (COUNT(*) FILTER (
        WHERE created_at >= ${opts.todayStart} AND created_at <= ${opts.todayEnd}
      ))::int AS today_count
    FROM tips
    WHERE business_id = ${opts.businessId}
      AND status = 'success'
      AND created_at >= ${lowerBound}
      AND created_at <= ${upperBound}
  `);

  const tSql = Math.round(performance.now() - t0);
  if (shouldLog) {
    console.info(
      `[dashboard.timing] business.myStats.${opts.timeframe}.summarySql ${tSql}ms`,
      {
        businessId: opts.businessId,
        periodStartIso: opts.rangeStart.toISOString(),
        periodEndIso: opts.rangeEnd.toISOString(),
        todayStartIso: opts.todayStart.toISOString(),
        todayEndIso: opts.todayEnd.toISOString(),
        periodAmount: Number(row?.period_amount ?? 0),
        todayAmount: Number(row?.today_amount ?? 0),
        todayCount: Number(row?.today_count ?? 0),
      },
    );
  }

  return {
    periodAmount: Number(row?.period_amount ?? 0),
    periodCount: Number(row?.period_count ?? 0),
    last60Amount: Number(row?.last60_amount ?? 0),
    last60Count: Number(row?.last60_count ?? 0),
    todayAmount: Number(row?.today_amount ?? 0),
    todayCount: Number(row?.today_count ?? 0),
  };
}

/** @deprecated Use queryBusinessDashboardSqlBundle — kept for callers that only need chart slices. */
export async function queryBusinessTipsAndChartBundle(opts: {
  businessId: string;
  timeframe: BusinessDashboardTimeframe;
  startUtc: Date;
  endUtc: Date;
  timezone: string;
}): Promise<{
  tipsByEmployee: Map<string, { total: number; count: number }>;
  dailyByYmd: Map<string, number>;
  monthTotals: number[] | null;
}> {
  const now = new Date();
  const sixtyAgo = new Date(Date.now() - 60 * 60 * 1000);
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const bundle = await queryBusinessDashboardSqlBundle({
    businessId: opts.businessId,
    timeframe: opts.timeframe,
    rangeStart: opts.startUtc,
    rangeEnd: opts.endUtc,
    scanStart: opts.startUtc,
    scanEnd: opts.endUtc,
    sixtyAgo,
    todayStart,
    todayEnd: now,
    timezone: opts.timezone,
  });
  return {
    tipsByEmployee: bundle.tipsByEmployee,
    dailyByYmd: bundle.dailyByYmd,
    monthTotals: bundle.monthTotals,
  };
}

export type EmployeeDashboardTimeframe = "today" | "week" | "month";

export function buildEmployeeChartSeries(
  timeframe: EmployeeDashboardTimeframe,
  businessTimezone: string,
  dailyByYmd: Map<string, number>,
  hourlyByHour: Map<number, number>,
): Array<{ label: string; amount: number }> {
  const tz = sanitizeIanaTimezone(businessTimezone);

  if (timeframe === "today") {
    return Array.from({ length: 24 }, (_, h) => ({
      label: `${h}:00`,
      amount: hourlyByHour.get(h) ?? 0,
    }));
  }

  if (timeframe === "week") {
    const nowLocal = DateTime.utc().setZone(tz).startOf("day");
    const mon = mondayOfWeekContaining(nowLocal);
    const order: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      order.push(mon.plus({ days: i }).toFormat("yyyy-LL-dd"));
    }
    return order.map((ymd) => {
      const dl = DateTime.fromISO(ymd, { zone: tz }).startOf("day");
      return {
        label: dl.toFormat("ccc"),
        amount: dailyByYmd.get(ymd) ?? 0,
      };
    });
  }

  const nowLocal = DateTime.utc().setZone(tz);
  const monthStart = nowLocal.startOf("month");
  const daysInMonth = nowLocal.daysInMonth ?? 31;
  const orderKeys: string[] = [];
  for (let di = 0; di < daysInMonth; di += 1) {
    orderKeys.push(monthStart.plus({ days: di }).toFormat("yyyy-LL-dd"));
  }
  return orderKeys.map((ymd) => ({
    label: DateTime.fromISO(ymd, { zone: tz }).toFormat("dd"),
    amount: dailyByYmd.get(ymd) ?? 0,
  }));
}

const MONTH_CHART_LABELS = [
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
];

export function buildBusinessDailyTipDistribution(
  tf: BusinessDashboardTimeframe,
  dailyByYmd: Map<string, number>,
  rangeStartUtc: Date,
  businessTimezone: string,
): { day: string; amount: number }[] {
  const tz = sanitizeIanaTimezone(businessTimezone);

  if (tf === "week") {
    const out: { day: string; amount: number }[] = [];
    let cur = DateTime.fromJSDate(rangeStartUtc, { zone: "utc" }).setZone(tz).startOf("day");
    for (let i = 0; i < 7; i++) {
      const key = cur.toFormat("yyyy-LL-dd");
      out.push({ day: cur.toFormat("ccc"), amount: dailyByYmd.get(key) ?? 0 });
      cur = cur.plus({ days: 1 });
    }
    return out;
  }

  if (tf === "month") {
    const out: { day: string; amount: number }[] = [];
    const monthStart = DateTime.fromJSDate(rangeStartUtc, { zone: "utc" }).setZone(tz).startOf("month");
    const daysInMonth = monthStart.daysInMonth ?? 31;
    for (let dom = 0; dom < daysInMonth; dom++) {
      const cur = monthStart.plus({ days: dom });
      const key = cur.toFormat("yyyy-LL-dd");
      out.push({ day: String(dom + 1), amount: dailyByYmd.get(key) ?? 0 });
    }
    return out;
  }

  const monthTotals = new Array(12).fill(0);
  for (const [ymd, amount] of dailyByYmd) {
    const monthIdx = Number(ymd.slice(5, 7)) - 1;
    if (monthIdx >= 0 && monthIdx < 12) monthTotals[monthIdx] += amount;
  }
  return MONTH_CHART_LABELS.map((day, i) => ({ day, amount: monthTotals[i] ?? 0 }));
}

export function buildYearChartFromMonthTotals(monthTotals: number[]): { day: string; amount: number }[] {
  return MONTH_CHART_LABELS.map((day, i) => ({ day, amount: monthTotals[i] ?? 0 }));
}

/** All-time chart: one bucket per calendar year — sum equals period totalTips. */
export function buildAllTimeChartFromYearTotals(
  yearTotals: Array<{ year: number; total: number }>,
): { day: string; amount: number }[] {
  if (yearTotals.length === 0) return [];
  return yearTotals.map((row) => ({
    day: String(row.year),
    amount: Number(row.total ?? 0),
  }));
}

/** Fallback: build daily map from rows when SQL path is skipped. */
export function dailyMapFromTipRows(
  tipRows: ReadonlyArray<{ amount: unknown; createdAt: Date }>,
  businessTimezone: string,
): Map<string, number> {
  const tz = sanitizeIanaTimezone(businessTimezone);
  const byDay = new Map<string, number>();
  for (const t of tipRows) {
    const key = businessDayKey(t.createdAt, tz);
    byDay.set(key, (byDay.get(key) ?? 0) + Number(t.amount));
  }
  return byDay;
}
