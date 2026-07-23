import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { DateTime } from "luxon";
import { sanitizeIanaTimezone, DEFAULT_BUSINESS_TIMEZONE } from "../utils/businessTime.js";
import { sqlCreatedAtLocal } from "../utils/sqlNaiveUtcToLocal.js";
import { getCachedOrLoad, invalidateCacheKeyPrefix } from "../utils/shortLivedCache.js";

const PLATFORM_ANALYTICS_CACHE_TTL_MS = 60_000;

export function invalidatePlatformAnalyticsCache(): void {
  invalidateCacheKeyPrefix("platform:analytics:");
}

export type PlatformAnalyticsResponse = {
  timezone: string;
  rangeDays: number;
  userDistribution: Array<{ role: "business" | "employee" | "platform_admin"; count: number }>;
  tipStatus: Array<{ status: "success" | "pending" | "failed"; count: number }>;
  /** Daily growth series for the last N days (inclusive). */
  growth: Array<{
    date: string; // YYYY-MM-DD
    newUsers: number;
    newBusinesses: number;
    newTips: number;
  }>;
  /** Daily successful tip volume + count. */
  tipVolume: Array<{
    date: string; // YYYY-MM-DD
    tipsEur: number;
    tipCount: number;
  }>;
  /** Top businesses by successful tip volume (for bar chart). */
  topBusinessesByTips: Array<{
    businessId: string;
    businessName: string;
    tipsEur: number;
  }>;
};

function clampDays(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 7), 120);
}

function eachLocalDayIso(rangeDays: number, timezone: string): { startUtc: Date; endUtc: Date; dayKeys: string[] } {
  const tz = sanitizeIanaTimezone(timezone);
  const localEnd = DateTime.now().setZone(tz).endOf("day");
  const localStart = localEnd.startOf("day").minus({ days: rangeDays - 1 });
  const dayKeys: string[] = [];
  for (let i = 0; i < rangeDays; i += 1) {
    dayKeys.push(localStart.plus({ days: i }).toFormat("yyyy-MM-dd"));
  }
  return { startUtc: localStart.toUTC().toJSDate(), endUtc: localEnd.toUTC().toJSDate(), dayKeys };
}

type DailyAggRow = {
  kind: string;
  d: string;
  c: number;
  tips_eur: number | null;
};

/** Analytics aggregates for Super Admin dashboard charts (Postgres/Supabase). */
async function getPlatformAnalyticsImpl(input?: {
  days?: unknown;
  timezone?: unknown;
}): Promise<PlatformAnalyticsResponse> {
  const rangeDays = clampDays(input?.days, 30);

  const timezone =
    typeof input?.timezone === "string" ? sanitizeIanaTimezone(input.timezone) : DEFAULT_BUSINESS_TIMEZONE;
  const { startUtc: start, endUtc: end, dayKeys } = eachLocalDayIso(rangeDays, timezone);

  // Tip volume / tip counts MUST stay independent of growth subqueries.
  // A missing businesses.created_at (or any growth SQL failure) must not zero tip charts.
  const tipDailyRows = await prisma.$queryRaw<DailyAggRow[]>(Prisma.sql`
    SELECT 'tips'::text AS kind,
      date_trunc('day', ${sqlCreatedAtLocal(timezone)})::date::text AS d,
      COUNT(*)::int AS c,
      NULL::float AS tips_eur
    FROM tips
    WHERE created_at >= ${start} AND created_at <= ${end}
    GROUP BY 2
    UNION ALL
    SELECT 'tip_vol'::text,
      date_trunc('day', ${sqlCreatedAtLocal(timezone)})::date::text,
      COUNT(*)::int,
      COALESCE(SUM(amount), 0)::float
    FROM tips
    WHERE status = 'success'
      AND created_at >= ${start}
      AND created_at <= ${end}
    GROUP BY 2
  `);

  let growthDailyRows: DailyAggRow[] = [];
  try {
    growthDailyRows = await prisma.$queryRaw<DailyAggRow[]>(Prisma.sql`
      SELECT 'users'::text AS kind,
        date_trunc('day', ${sqlCreatedAtLocal(timezone)})::date::text AS d,
        COUNT(*)::int AS c,
        NULL::float AS tips_eur
      FROM "User"
      WHERE created_at >= ${start} AND created_at <= ${end}
      GROUP BY 2
      UNION ALL
      SELECT 'businesses'::text,
        date_trunc('day', ${sqlCreatedAtLocal(timezone)})::date::text,
        COUNT(*)::int,
        NULL::float
      FROM businesses
      WHERE deleted_at IS NULL
        AND created_at >= ${start}
        AND created_at <= ${end}
      GROUP BY 2
    `);
  } catch (err) {
    // Fallback: users + MANAGER proxy if businesses.created_at unavailable.
    console.warn("[platformAnalytics] businesses.created_at growth failed; using MANAGER proxy", err);
    growthDailyRows = await prisma.$queryRaw<DailyAggRow[]>(Prisma.sql`
      SELECT 'users'::text AS kind,
        date_trunc('day', ${sqlCreatedAtLocal(timezone)})::date::text AS d,
        COUNT(*)::int AS c,
        NULL::float AS tips_eur
      FROM "User"
      WHERE created_at >= ${start} AND created_at <= ${end}
      GROUP BY 2
      UNION ALL
      SELECT 'businesses'::text,
        date_trunc('day', ${sqlCreatedAtLocal(timezone)})::date::text,
        COUNT(*)::int,
        NULL::float
      FROM "User"
      WHERE role = 'MANAGER'
        AND created_at >= ${start}
        AND created_at <= ${end}
      GROUP BY 2
    `);
  }

  const dailyRows = [...growthDailyRows, ...tipDailyRows];

  const roleCountRows = await prisma.user.groupBy({ by: ["role"], _count: { _all: true } });
  const tipStatusRows = await prisma.transaction.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const topBusinesses = await prisma.transaction.groupBy({
    by: ["businessId"],
    where: { status: "success", createdAt: { gte: start, lte: end } },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
    take: 7,
  });

  const usersDaily: Array<{ d: string; c: number }> = [];
  const businessesDaily: Array<{ d: string; c: number }> = [];
  const tipsDaily: Array<{ d: string; c: number }> = [];
  const tipVolumeDaily: Array<{ d: string; tips_eur: number; tip_count: number }> = [];
  for (const r of dailyRows) {
    const d = String(r.d).slice(0, 10);
    if (r.kind === "users") usersDaily.push({ d, c: Number(r.c ?? 0) });
    else if (r.kind === "businesses") businessesDaily.push({ d, c: Number(r.c ?? 0) });
    else if (r.kind === "tips") tipsDaily.push({ d, c: Number(r.c ?? 0) });
    else if (r.kind === "tip_vol") {
      tipVolumeDaily.push({
        d,
        tips_eur: Number(r.tips_eur ?? 0),
        tip_count: Number(r.c ?? 0),
      });
    }
  }

  const roleCount = (role: string) =>
    roleCountRows.find((row) => String(row.role) === role)?._count._all ?? 0;
  const managerCount = roleCount("MANAGER");
  const employeeCount = roleCount("EMPLOYEE");
  const adminCount = roleCount("SUPER_ADMIN");

  const tipStatus: PlatformAnalyticsResponse["tipStatus"] = [
    { status: "success", count: 0 },
    { status: "pending", count: 0 },
    { status: "failed", count: 0 },
  ];
  for (const r of tipStatusRows) {
    const s = String(r.status);
    if (s === "success" || s === "pending" || s === "failed") {
      tipStatus.find((x) => x.status === s)!.count = r._count._all;
    }
  }

  const mapCount = (rows: Array<{ d: string; c: number }>) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.d).slice(0, 10), Number(r.c ?? 0));
    return m;
  };
  const mapUsers = mapCount(usersDaily);
  const mapBusinesses = mapCount(businessesDaily);
  const mapTips = mapCount(tipsDaily);
  const mapTipVol = new Map<string, { tipsEur: number; tipCount: number }>();
  for (const r of tipVolumeDaily) {
    mapTipVol.set(String(r.d).slice(0, 10), {
      tipsEur: Number(r.tips_eur ?? 0),
      tipCount: Number(r.tip_count ?? 0),
    });
  }

  const topBusinessIds = topBusinesses.map((r) => r.businessId);
  const businessNames =
    topBusinessIds.length > 0
      ? await prisma.business.findMany({
          where: { id: { in: topBusinessIds } },
          select: { id: true, name: true },
        })
      : [];
  const nameMap = new Map(businessNames.map((b) => [b.id, b.name]));
  const topBusinessesByTips = topBusinesses.map((r) => ({
    businessId: r.businessId,
    businessName: nameMap.get(r.businessId) ?? "Unknown",
    tipsEur: Number(r._sum.amount ?? 0),
  }));

  const result: PlatformAnalyticsResponse = {
    timezone,
    rangeDays,
    userDistribution: [
      { role: "business", count: managerCount },
      { role: "employee", count: employeeCount },
      { role: "platform_admin", count: adminCount },
    ],
    tipStatus,
    growth: dayKeys.map((d) => ({
      date: d,
      newUsers: mapUsers.get(d) ?? 0,
      newBusinesses: mapBusinesses.get(d) ?? 0,
      newTips: mapTips.get(d) ?? 0,
    })),
    tipVolume: dayKeys.map((d) => ({
      date: d,
      tipsEur: mapTipVol.get(d)?.tipsEur ?? 0,
      tipCount: mapTipVol.get(d)?.tipCount ?? 0,
    })),
    topBusinessesByTips,
  };

  if (
    process.env.NODE_ENV !== "production" ||
    process.env.DASHBOARD_TIMING === "1" ||
    process.env.SSOT_CHART_ASSERT === "1"
  ) {
    const tipVolumeSum = result.tipVolume.reduce((s, r) => s + (Number(r.tipsEur) || 0), 0);
    const todayKey = dayKeys[dayKeys.length - 1];
    const todayVol = mapTipVol.get(todayKey);
    console.info("[SSOT] platform.tipVolume", {
      timezone,
      rangeDays,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      tipVolumeSumEur: tipVolumeSum,
      todayKey,
      todayTipsEur: todayVol?.tipsEur ?? 0,
      todayTipCount: todayVol?.tipCount ?? 0,
      tipVolRows: tipVolumeDaily.length,
    });
  }

  return result;
}

/** Analytics aggregates for Super Admin dashboard charts (Postgres/Supabase). */
export async function getPlatformAnalytics(input?: {
  days?: unknown;
  timezone?: unknown;
}): Promise<PlatformAnalyticsResponse> {
  const rangeDays = clampDays(input?.days, 30);
  const timezone =
    typeof input?.timezone === "string" ? sanitizeIanaTimezone(input.timezone) : DEFAULT_BUSINESS_TIMEZONE;
  const cacheKey = `platform:analytics:${rangeDays}:${timezone}`;
  return getCachedOrLoad(cacheKey, PLATFORM_ANALYTICS_CACHE_TTL_MS, () =>
    getPlatformAnalyticsImpl(input),
  );
}
