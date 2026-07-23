import {
  createEmployeeInviteForManager,
  validateEmployeeInviteCode,
  listInviteHistoryForBusiness,
} from "./employeeInvite.service.js";
import { Prisma, TipStatus, type EmployeeActivationStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { StatsFetchError, logStatsPhase } from "../utils/statsErrors.js";
import { randomBytes } from "node:crypto";
import { generateSlug, ensureUniqueSlug } from "../utils/slug.js";
import { prisma } from "../prisma.js";
import { isSubscriptionBasicDefaultEnabled } from "../config/featureFlags.js";
import { provisionInternalBasicSubscription } from "./subscription.service.js";
import { emitBusinessDataChanged, emitPlatformDataUpdated } from "../socket/socketEmitters.js";
import {
  toManagerBusinessProfileDto,
  toPublicBusinessProfileDto,
  type ManagerBusinessProfileDto,
  type PublicBusinessProfileDto,
} from "./businessProfile.dto.js";
import { listEmployeeGoalsForBusiness } from "./goal.service.js";
import { PUBLIC_APP_RESERVED_SLUGS } from "../utils/publicReservedSlugs.js";
import { absolutizePublicMediaPath } from "../utils/publicMediaUrl.js";
import { resolveSubscriptionEntitlements } from "./subscriptionEntitlement.service.js";
import {
  businessDayKey,
  businessUtcRangeForTimeframe,
  sanitizeIanaTimezone,
} from "../utils/businessTime.js";
import {
  getCachedOrLoad,
  getCachedIfFresh,
  invalidateCacheKey,
  invalidateCacheKeyPrefix,
  primeCachedValue,
} from "../utils/shortLivedCache.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import { logDashboardPhase } from "../utils/dashboardTiming.js";
import { inferManagerOnboardingStep } from "./onboardingProgress.service.js";
import { queryEmployeeRatingAggregates } from "./feedback.service.js";
import {
  buildBusinessDailyTipDistribution,
  buildYearChartFromMonthTotals,
  buildAllTimeChartFromYearTotals,
  queryBusinessDashboardMetaAndSummaryMetrics,
  queryBusinessDashboardSqlBundle,
  queryBusinessDashboardSummaryMetrics,
  type BusinessDashboardSqlBundle,
} from "../utils/tipChartBuckets.js";

const BUSINESS_STATS_CACHE_TTL_MS = 30_000;
/** Business row + roster pulse (split queries, cached). */
const BUSINESS_META_ROSTER_CACHE_TTL_MS = 10 * 60_000;
/** Per-timeframe tips CTE bundle — keep warm for timeframe switching. */
const BUSINESS_SQL_BUNDLE_CACHE_TTL_MS = 90_000;
/** KPI-only summary metrics (no chart/employee aggregates). */
const BUSINESS_SUMMARY_METRICS_CACHE_TTL_MS = 90_000;
/** Manager lookup caching for stats endpoints. */
const BUSINESS_MANAGER_ID_CACHE_TTL_MS = 60_000;
/** Employees + goals — timeframe independent. */
const BUSINESS_ANALYTICS_EXTRAS_CACHE_TTL_MS = 120_000;

/** Avoid collision with SPA routes at `/{slug}` and legacy `/business/{slug}` paths. */
const RESERVED_BUSINESS_SLUGS = new Set([
  ...PUBLIC_APP_RESERVED_SLUGS,
  "qr-management",
  "qr-code-management",
]);

function normalizeBusinessSlugBase(name: string): string {
  let base = generateSlug(name);
  if (RESERVED_BUSINESS_SLUGS.has(base)) {
    base = `${base}-venue`;
  }
  return base;
}

/** Unique slug for a new business name (registration, seeds). */
export async function generateUniqueBusinessSlugForName(name: string): Promise<string> {
  const base = normalizeBusinessSlugBase(name);
  return ensureUniqueSlug(base, async (s) => {
    const hit = await prisma.business.findFirst({ where: { slug: s } });
    return !!hit;
  });
}

/** Backfill missing slugs for legacy rows (run before NOT NULL migrate if needed). */
export async function ensureBusinessHasSlug(businessId: string): Promise<void> {
  const b = await prisma.business.findUnique({ where: { id: businessId } });
  if (!b) return;
  if (b.slug && b.slug.length > 0) return;
  const base = normalizeBusinessSlugBase(b.name);
  const slug = await ensureUniqueSlug(base, async (s) => {
    const hit = await prisma.business.findFirst({ where: { slug: s } });
    return !!hit;
  });
  await prisma.business.update({ where: { id: businessId }, data: { slug } });
}

export async function getBusinessByUserId(userId: string) {
  const existing = await prisma.business.findUnique({ where: { userId } });
  if (existing) return existing;

  // Auto-heal: legacy or inconsistent rows where a MANAGER exists without a Business record.
  // This keeps the app usable and prevents "Business not found" / "Only business owners..." errors.
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, isActive: true, isPlatformAdmin: true },
  });
  if (!u || !u.isActive || u.isPlatformAdmin || u.role !== "MANAGER") {
    return null;
  }

  const baseName = (u.email.split("@")[0] || "My").trim();
  const name = `${baseName} venue`;
  const slug = await generateUniqueBusinessSlugForName(name);
  return prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        userId: u.id,
        name,
        slug,
        businessType: null,
        location: null,
      },
    });

    if (isSubscriptionBasicDefaultEnabled()) {
      await provisionInternalBasicSubscription(business.id, {
        source: "auto_heal",
        tx,
      });
    }

    return business;
  });
}

/**
 * Hard-delete a venue and every auth account tied to it:
 * all staff `User` rows (and their `Employee` rows via FK cascade), then the manager `User` row
 * (which cascades removal of the `Business` row per `businesses_user_id_fkey`).
 *
 * Call this instead of `prisma.business.delete` so staff manager accounts are not left orphaned.
 */
export async function deleteBusinessCascadeUsers(businessId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const business = await tx.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        userId: true,
        user: { select: { id: true, role: true, isPlatformAdmin: true } },
      },
    });
    if (!business) {
      throw new Error("Business not found");
    }
    if (business.user.isPlatformAdmin) {
      throw new Error("Cannot delete a business owned by a platform administrator account");
    }
    if (business.user.role !== "MANAGER") {
      throw new Error("Business owner user has unexpected role; delete aborted");
    }

    const employees = await tx.employee.findMany({
      where: { businessId },
      select: {
        userId: true,
        user: { select: { role: true, isPlatformAdmin: true } },
      },
    });

    const ownerUserId = business.userId;
    const staffUserIds: string[] = [];
    for (const row of employees) {
      if (row.userId === ownerUserId) {
        continue;
      }
      if (row.user.isPlatformAdmin) {
        throw new Error("Cannot delete business: a staff account is marked as platform administrator");
      }
      if (row.user.role !== "EMPLOYEE") {
        throw new Error("Business has a staff user with unexpected role; delete aborted");
      }
      staffUserIds.push(row.userId);
    }

    for (const uid of staffUserIds) {
      await tx.user.delete({ where: { id: uid } });
    }

    await tx.user.delete({ where: { id: ownerUserId } });
  });

  emitBusinessDataChanged(businessId, "business_deleted");
  emitPlatformDataUpdated("business_deleted");
}

/** Narrow lookup for dashboard — avoids SELECT * on `businesses` (P2022 when DB lags schema). */
export async function getBusinessIdForManagerUser(userId: string): Promise<{ id: string } | null> {
  return prisma.business.findUnique({
    where: { userId },
    select: { id: true },
  });
}

export async function generateInviteCode(userId: string): Promise<{
  inviteCode: string;
  expiresAt: string;
  inviteId?: string;
}> {
  return createEmployeeInviteForManager(userId);
}

export async function validateInviteCode(
  code: string,
  opts?: { clientKey?: string; ipKey?: string },
): Promise<{
  ok: boolean;
  businessName?: string;
  businessId?: string;
  businessSlug?: string;
  businessLocation?: string | null;
}> {
  return validateEmployeeInviteCode(code, opts);
}

export async function getInviteRedemptionHistory(userId: string, take = 20) {
  const business = await prisma.business.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!business) throw new Error("Business not found");
  return listInviteHistoryForBusiness(business.id, take);
}

export type BusinessDashboardTimeframe = "week" | "month" | "year" | "all";

function buildDailyTipDistribution(
  tipRows: { amount: unknown; createdAt: Date }[],
  tf: BusinessDashboardTimeframe,
  rangeStartUtc: Date,
  businessTimezone: string,
): { day: string; amount: number }[] {
  const byDay = new Map<string, number>();
  for (const t of tipRows) {
    const key = businessDayKey(t.createdAt, businessTimezone);
    byDay.set(key, (byDay.get(key) ?? 0) + Number(t.amount));
  }

  const tz = sanitizeIanaTimezone(businessTimezone);

  if (tf === "week") {
    const out: { day: string; amount: number }[] = [];
    let cur = DateTime.fromJSDate(rangeStartUtc, { zone: "utc" }).setZone(tz).startOf("day");
    for (let i = 0; i < 7; i++) {
      const key = cur.toFormat("yyyy-LL-dd");
      out.push({ day: cur.toFormat("ccc"), amount: byDay.get(key) ?? 0 });
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
      out.push({ day: String(dom + 1), amount: byDay.get(key) ?? 0 });
    }
    return out;
  }

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthTotals = new Array(12).fill(0);
  for (const t of tipRows) {
    const key = businessDayKey(t.createdAt, businessTimezone);
    const monthIdx = Number(key.slice(5, 7)) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      monthTotals[monthIdx] += Number(t.amount);
    }
  }
  return monthNames.map((day, i) => ({ day, amount: monthTotals[i] }));
}

const MONTH_CHART_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monthly buckets for year/all charts — Prisma-only (avoids PG enum casting issues in raw SQL). */
async function monthlyTipTotalsForRange(
  businessId: string,
  startUtc: Date,
  endUtc: Date,
  businessTimezone: string,
): Promise<number[]> {
  const tz = sanitizeIanaTimezone(businessTimezone);
  const monthTotals = new Array(12).fill(0);
  const tips = await prisma.transaction.findMany({
    where: {
      businessId,
      status: TipStatus.success,
      createdAt: { gte: startUtc, lte: endUtc },
    },
    select: { amount: true, createdAt: true },
  });
  for (const t of tips) {
    const key = businessDayKey(t.createdAt, tz);
    const monthIdx = Number(key.slice(5, 7)) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      monthTotals[monthIdx] += Number(t.amount);
    }
  }
  return monthTotals;
}

export type BusinessStatsScope = "summary" | "roster" | "analytics" | "full";

/** Full invalidation (roster, employees, goals, all timeframes). */
export function invalidateBusinessStatsCache(businessId: string): void {
  invalidateBusinessStatsTipCaches(businessId);
  invalidateCacheKey(`business-stats-roster:${businessId}`);
  invalidateCacheKey(`biz-dash-context:${businessId}`);
  invalidateCacheKey(`biz-dash-meta-roster:${businessId}`);
  invalidateCacheKey(`biz-dash-tz:${businessId}`);
  invalidateCacheKeyPrefix(`biz-dash-meta-summary:${businessId}:`);
  invalidateCacheKeyPrefix(`biz-dash-extras:${businessId}`);
  invalidateCacheKeyPrefix(`biz-dash-employees:${businessId}:`);
}

/** Tips / charts / period metrics only — keeps roster + employee list warm (5+ min). */
export function invalidateBusinessStatsTipCaches(businessId: string): void {
  invalidateCacheKeyPrefix(`biz-dash-sql:${businessId}:`);
  invalidateCacheKeyPrefix(`biz-dash-summary:${businessId}:`);
  invalidateCacheKey(`biz-dash-goals:${businessId}`);
  invalidateCacheKeyPrefix(`biz-employee-goals:${businessId}:`);
  invalidateCacheKeyPrefix(`business-stats:${businessId}:`);
  invalidateCacheKeyPrefix(`business-stats-summary:${businessId}:`);
  invalidateCacheKeyPrefix(`business-stats-analytics:${businessId}:`);
}

function runBusinessDashboardDb<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  return runSerializedByKey(`biz-dash-db:${businessId}`, fn);
}

export function getBusinessStats(
  businessId: string,
  timeframe: BusinessDashboardTimeframe = "month",
  scope: BusinessStatsScope = "full",
): Promise<Awaited<ReturnType<typeof getBusinessStatsImpl>>> {
  if (scope === "summary") {
    const cacheKey = `business-stats-summary:${businessId}:${timeframe}`;
    return runSerializedByKey(`biz-stats-summary:${businessId}:${timeframe}`, () =>
      getCachedOrLoad(cacheKey, BUSINESS_STATS_CACHE_TTL_MS, () =>
        getBusinessStatsSummaryImpl(businessId, timeframe),
      ),
    ) as Promise<Awaited<ReturnType<typeof getBusinessStatsImpl>>>;
  }
  if (scope === "analytics") {
    const cacheKey = `business-stats-analytics:${businessId}:${timeframe}`;
    return runSerializedByKey(`biz-stats-analytics:${businessId}:${timeframe}`, () =>
      getCachedOrLoad(cacheKey, BUSINESS_STATS_CACHE_TTL_MS, () =>
        getBusinessStatsAnalyticsImpl(businessId, timeframe),
      ),
    ) as Promise<Awaited<ReturnType<typeof getBusinessStatsImpl>>>;
  }
  if (scope === "roster") {
    const cacheKey = `business-stats-roster:${businessId}`;
    return runSerializedByKey(`biz-stats-roster:${businessId}`, () =>
      getCachedOrLoad(cacheKey, BUSINESS_STATS_CACHE_TTL_MS, () =>
        getBusinessStatsRosterImpl(businessId),
      ),
    ) as Promise<Awaited<ReturnType<typeof getBusinessStatsImpl>>>;
  }
  const cacheKey = `business-stats:${businessId}:${timeframe}`;
  return runSerializedByKey(`biz-stats-full:${businessId}:${timeframe}`, () =>
    getCachedOrLoad(cacheKey, BUSINESS_STATS_CACHE_TTL_MS, () =>
      getBusinessStatsImpl(businessId, timeframe),
    ),
  );
}

type BusinessRosterPulse = {
  roster_total: number;
  tipping_ready: number;
  missing_qr: number;
};

type BusinessDashboardContext = {
  business: {
    id: string;
    name: string;
    slug: string | null;
    onboardingVerificationStatus: string;
    kycVerificationStatus: string;
    timezone: string | null;
  };
  tz: string;
  roster: BusinessRosterPulse;
};

type BusinessSqlBundleSlice = {
  bundle: BusinessDashboardSqlBundle;
  rangeStart: Date;
  rangeEnd: Date;
  timeframe: BusinessDashboardTimeframe;
  ctx: { businessId: string; timeframe: BusinessDashboardTimeframe };
};

type BusinessSqlBundleCache = BusinessDashboardContext & BusinessSqlBundleSlice;

type BusinessRosterCountsRow = {
  roster_total: number;
  tipping_ready: number;
  missing_qr: number;
};

/** Business row + roster pulse — one cache entry per venue (shared across timeframes). */
async function loadBusinessDashboardContextImpl(businessId: string): Promise<BusinessDashboardContext> {
  if (!businessId?.trim()) {
    throw new StatsFetchError("Business not found", { businessId, reason: "missing_business_id" });
  }

  // Parallel: transaction pooler uses connection_limit=5 (independent meta queries).
  const [business, countsRows] = await Promise.all([
    logDashboardPhase("business.myStats.summary", "metaBusinessRow", () =>
      prisma.business.findUnique({
        where: { id: businessId },
        select: {
          id: true,
          name: true,
          slug: true,
          onboardingVerificationStatus: true,
          kycVerificationStatus: true,
          timezone: true,
        },
      }),
    ),
    logDashboardPhase("business.myStats.summary", "metaRosterSql", () =>
      prisma.$queryRaw<BusinessRosterCountsRow[]>(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM employees e WHERE e.business_id = ${businessId}) AS roster_total,
      (SELECT COUNT(*)::int
       FROM employees e
       INNER JOIN "User" u ON u.id = e.user_id
       WHERE e.business_id = ${businessId}
         AND e.is_active = true
         AND e.activation_status = 'active'
         AND u.email_verified = true
      ) AS tipping_ready,
      (SELECT COUNT(*)::int
       FROM employees e
       WHERE e.business_id = ${businessId}
         AND (e.slug IS NULL OR TRIM(e.slug) = '')
      ) AS missing_qr
  `),
    ),
  ]);

  if (!business) {
    throw new StatsFetchError("Business not found", { businessId, reason: "business_row_missing" });
  }

  const [counts] = countsRows;
  const roster = counts ?? { roster_total: 0, tipping_ready: 0, missing_qr: 0 };

  return {
    business: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      onboardingVerificationStatus: business.onboardingVerificationStatus,
      kycVerificationStatus: business.kycVerificationStatus,
      timezone: business.timezone,
    },
    tz: sanitizeIanaTimezone(business.timezone),
    roster: {
      roster_total: Number(roster.roster_total ?? 0),
      tipping_ready: Number(roster.tipping_ready ?? 0),
      missing_qr: Number(roster.missing_qr ?? 0),
    },
  };
}

function loadBusinessDashboardContextCached(businessId: string): Promise<BusinessDashboardContext> {
  return getCachedOrLoad(`biz-dash-context:${businessId}`, BUSINESS_META_ROSTER_CACHE_TTL_MS, () =>
    runBusinessDashboardDb(businessId, () => loadBusinessDashboardContextImpl(businessId)),
  );
}

/** @deprecated Use loadBusinessDashboardContextCached — same cache key as context loader. */
function loadBusinessDashboardMetaAndRoster(businessId: string): Promise<BusinessDashboardContext> {
  return loadBusinessDashboardContextCached(businessId);
}

async function loadBusinessSqlBundleSlice(
  businessId: string,
  timeframe: BusinessDashboardTimeframe,
  meta: BusinessDashboardContext,
): Promise<BusinessSqlBundleSlice> {
  const { tz } = meta;
  const ctx = { businessId, timeframe };
  const now = new Date();
  const range = businessUtcRangeForTimeframe(timeframe === "all" ? "all" : timeframe, tz);
  const rangeStart = range?.startUtc ?? new Date(0);
  const rangeEnd = range?.endUtc ?? now;
  const scanStart = timeframe === "all" ? new Date(0) : rangeStart;
  const scanEnd = rangeEnd;
  const todayRange = businessUtcRangeForTimeframe("today", tz) ?? {
    startUtc: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    endUtc: now,
  };
  const sixtyAgo = new Date(Date.now() - 60 * 60 * 1000);

  const bundle = await logDashboardPhase("business.myStats.summary", "sqlBundle", () =>
    queryBusinessDashboardSqlBundle({
      businessId,
      timeframe,
      rangeStart,
      rangeEnd,
      scanStart,
      scanEnd,
      sixtyAgo,
      todayStart: todayRange.startUtc,
      todayEnd: todayRange.endUtc,
      timezone: tz,
    }),
  );

  return { bundle, rangeStart, rangeEnd, timeframe, ctx };
}

/** Per-timeframe tips CTE bundle (meta loaded once, shared across scopes). */
function loadBusinessSqlBundleSliceCached(
  businessId: string,
  timeframe: BusinessDashboardTimeframe,
): Promise<BusinessSqlBundleSlice> {
  return getCachedOrLoad(
    `biz-dash-sql:${businessId}:${timeframe}`,
    BUSINESS_SQL_BUNDLE_CACHE_TTL_MS,
    async () => {
      const meta = await loadBusinessDashboardContextCached(businessId);
      return runBusinessDashboardDb(businessId, () =>
        loadBusinessSqlBundleSlice(businessId, timeframe, meta),
      );
    },
  );
}

type BusinessSummaryMetricsSlice = {
  summary: BusinessDashboardSqlBundle["summary"];
  timeframe: BusinessDashboardTimeframe;
  ctx: { businessId: string; timeframe: BusinessDashboardTimeframe };
};

/**
 * KPI-only path: period + pulse totals without tipsByEmployee / chart buckets.
 * Used by scope=summary so first KPI is not blocked on analytics SQL.
 */
async function loadBusinessSummaryMetricsSlice(
  businessId: string,
  timeframe: BusinessDashboardTimeframe,
  meta: BusinessDashboardContext,
): Promise<BusinessSummaryMetricsSlice> {
  const { tz } = meta;
  const ctx = { businessId, timeframe };
  const now = new Date();
  const range = businessUtcRangeForTimeframe(timeframe === "all" ? "all" : timeframe, tz);
  const rangeStart = range?.startUtc ?? new Date(0);
  const rangeEnd = range?.endUtc ?? now;
  const scanStart = timeframe === "all" ? new Date(0) : rangeStart;
  const scanEnd = rangeEnd;
  const todayRange = businessUtcRangeForTimeframe("today", tz) ?? {
    startUtc: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    endUtc: now,
  };
  const sixtyAgo = new Date(Date.now() - 60 * 60 * 1000);

  const summary = await logDashboardPhase("business.myStats.summary", "summarySqlOnly", () =>
    queryBusinessDashboardSummaryMetrics({
      businessId,
      timeframe,
      rangeStart,
      rangeEnd,
      scanStart,
      scanEnd,
      sixtyAgo,
      todayStart: todayRange.startUtc,
      todayEnd: todayRange.endUtc,
    }),
  );

  return { summary, timeframe, ctx };
}

function loadBusinessSummaryMetricsSliceCached(
  businessId: string,
  timeframe: BusinessDashboardTimeframe,
): Promise<BusinessSummaryMetricsSlice> {
  return getCachedOrLoad(
    `biz-dash-summary:${businessId}:${timeframe}`,
    BUSINESS_SUMMARY_METRICS_CACHE_TTL_MS,
    async () => {
      const meta = await loadBusinessDashboardContextCached(businessId);
      return runBusinessDashboardDb(businessId, () =>
        loadBusinessSummaryMetricsSlice(businessId, timeframe, meta),
      );
    },
  );
}

async function loadBusinessSqlBundleCached(
  businessId: string,
  timeframe: BusinessDashboardTimeframe,
): Promise<BusinessSqlBundleCache> {
  const meta = await loadBusinessDashboardContextCached(businessId);
  const slice = await loadBusinessSqlBundleSliceCached(businessId, timeframe);
  return { ...meta, ...slice };
}

function assertBusinessChartKpiSsot(opts: {
  businessId: string;
  timeframe: BusinessDashboardTimeframe;
  tz: string;
  rangeStart: Date;
  dailyTipDistribution: { day: string; amount: number }[];
  periodAmount: number;
  todayAmount?: number;
  todayCount?: number;
}): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.DASHBOARD_TIMING !== "1" &&
    process.env.SSOT_CHART_ASSERT !== "1"
  ) {
    return;
  }
  const chartSum = opts.dailyTipDistribution.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const kpi = Number(opts.periodAmount) || 0;
  const delta = Math.abs(chartSum - kpi);
  console.info("[SSOT] business.chart↔kpi", {
    businessId: opts.businessId,
    timeframe: opts.timeframe,
    tz: opts.tz,
    periodStartIso: opts.rangeStart.toISOString(),
    chartBuckets: opts.dailyTipDistribution.length,
    chartSum,
    periodAmount: kpi,
    delta,
    todayAmount: opts.todayAmount,
    todayCount: opts.todayCount,
  });
  if (opts.dailyTipDistribution.length > 0 && delta > 0.05) {
    console.warn(
      `[SSOT] chart sum ≠ period KPI (${opts.timeframe}): chartSum=${chartSum} periodAmount=${kpi} Δ=${delta}`,
    );
  }
}

function buildChartFromSqlBundle(
  timeframe: BusinessDashboardTimeframe,
  rangeStart: Date,
  tz: string,
  bundle: BusinessDashboardSqlBundle,
): { day: string; amount: number }[] {
  if (timeframe === "year" && bundle.monthTotals) return buildYearChartFromMonthTotals(bundle.monthTotals);
  if (timeframe === "all") {
    return buildAllTimeChartFromYearTotals(bundle.yearTotals ?? []);
  }
  if (timeframe === "week" || timeframe === "month") {
    return buildBusinessDailyTipDistribution(timeframe, bundle.dailyByYmd, rangeStart, tz);
  }
  return [];
}

async function loadBusinessAnalyticsEmployees(
  businessId: string,
  opts?: { includeAssignments?: boolean },
) {
  const legacyEmployeeSelect = {
    id: true,
    slug: true,
    name: true,
    jobTitle: true,
    avatar: true,
    phone: true,
    isActive: true,
    activationStatus: true,
    monthlyGoal: true,
    user: {
      select: {
        email: true,
        emailVerified: true,
        passwordHash: true,
        oauthProvider: true,
      },
    },
  } as const;

  const includeAssignments = opts?.includeAssignments === true;

  const extendedEmployeeSelect = {
    ...legacyEmployeeSelect,
    locationId: true,
    ...(includeAssignments
      ? { tableAssignments: { select: { table: { select: { id: true } } } } }
      : {}),
  } as const;

  const minimalEmployeeSelect = {
    id: true,
    slug: true,
    name: true,
    jobTitle: true,
    avatar: true,
    phone: true,
    isActive: true,
    activationStatus: true,
    monthlyGoal: true,
    user: {
      select: {
        email: true,
        emailVerified: true,
        passwordHash: true,
        oauthProvider: true,
      },
    },
  } as const;

  try {
      return await prisma.employee.findMany({
      where: { businessId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: extendedEmployeeSelect,
    });
  } catch (extendedErr) {
    try {
      const rows = await prisma.employee.findMany({
        where: { businessId },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        select: legacyEmployeeSelect,
      });
      console.warn(
        "[getBusinessStats] Extended employee select failed (DB may need migration); using legacy columns.",
        extendedErr instanceof Error ? extendedErr.message : extendedErr,
      );
      return rows;
    } catch (legacyErr) {
      console.warn(
        "[getBusinessStats] Legacy employee select failed; using minimal columns.",
        legacyErr instanceof Error ? legacyErr.message : legacyErr,
      );
      return prisma.employee.findMany({
        where: { businessId },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        select: minimalEmployeeSelect,
      });
    }
  }
}

type BusinessAnalyticsExtras = {
  employees: Awaited<ReturnType<typeof loadBusinessAnalyticsEmployees>>;
  employeeGoals: Awaited<ReturnType<typeof listEmployeeGoalsForBusiness>>;
};

function loadBusinessAnalyticsEmployeesCached(
  businessId: string,
  includeAssignments: boolean,
): Promise<BusinessAnalyticsExtras["employees"]> {
  const cacheKey = includeAssignments
    ? `biz-dash-employees:${businessId}:withAssignments`
    : `biz-dash-employees:${businessId}:noAssignments`;
  return getCachedOrLoad(cacheKey, BUSINESS_ANALYTICS_EXTRAS_CACHE_TTL_MS, () =>
    runSerializedByKey(
      `biz-dash-employees:${businessId}:${includeAssignments ? "withAssignments" : "noAssignments"}`,
      () =>
        logDashboardPhase("business.myStats.analytics", "employeesSql", () =>
          loadBusinessAnalyticsEmployees(businessId, { includeAssignments }),
        ),
    ),
  );
}

function loadBusinessAnalyticsGoalsCached(
  businessId: string,
): Promise<BusinessAnalyticsExtras["employeeGoals"]> {
  return getCachedOrLoad(`biz-dash-goals:${businessId}`, BUSINESS_ANALYTICS_EXTRAS_CACHE_TTL_MS, () =>
    runSerializedByKey(`biz-dash-goals:${businessId}`, () =>
      logDashboardPhase("business.myStats.analytics", "goalsSql", () =>
        listEmployeeGoalsForBusiness(businessId, { maxGoals: 25 }).catch((goalsErr) => {
          console.warn(
            "[getBusinessStats] employee goals omitted",
            goalsErr instanceof Error ? goalsErr.message : goalsErr,
          );
          return [] as Awaited<ReturnType<typeof listEmployeeGoalsForBusiness>>;
        }),
      ),
    ),
  );
}

async function loadBusinessAnalyticsExtras(
  businessId: string,
  opts?: { includeAssignments?: boolean },
): Promise<BusinessAnalyticsExtras> {
  const includeAssignments = opts?.includeAssignments === true;
  // Parallel: pooler connection_limit=5 supports concurrent independent reads.
  const [employees, employeeGoals] = await Promise.all([
    loadBusinessAnalyticsEmployeesCached(businessId, includeAssignments),
    loadBusinessAnalyticsGoalsCached(businessId),
  ]);
  return { employees, employeeGoals };
}

function mapEmployeesToStats(
  employees: Awaited<ReturnType<typeof loadBusinessAnalyticsEmployees>>,
  tipsByEmployee: Map<string, { total: number; count: number }>,
  ratingsByEmployee: Map<string, { average: number; count: number }>,
) {
  return employees.map((emp) => {
    const agg = tipsByEmployee.get(emp.id) ?? { total: 0, count: 0 };
    const ratingAgg = ratingsByEmployee.get(emp.id);
    const account = emp.user ?? {
      email: "",
      emailVerified: false,
      passwordHash: null as string | null,
      oauthProvider: null as string | null,
    };
    const passwordIsSet =
      (account.passwordHash != null && account.passwordHash.length > 0) ||
      (account.oauthProvider != null && account.oauthProvider.trim().length > 0);
    return {
      id: emp.id,
      slug: emp.slug ?? null,
      name: emp.name ?? "Staff",
      jobTitle: emp.jobTitle ?? "",
      avatar: absolutizePublicMediaPath(emp.avatar),
      phone: emp.phone ?? null,
      isActive: emp.isActive ?? false,
      activationStatus: emp.activationStatus ?? "active",
      email: account.email,
      emailVerified: account.emailVerified === true,
      passwordIsSet,
      monthlyGoal: emp.monthlyGoal != null ? Number(emp.monthlyGoal) : null,
      locationId: "locationId" in emp ? (emp.locationId ?? null) : null,
      assignedTableIds:
        "tableAssignments" in emp && Array.isArray(emp.tableAssignments)
          ? emp.tableAssignments.map((ta: { table: { id: string } }) => ta.table.id)
          : [],
      tipsTotal: agg.total,
      tipCount: agg.count,
      rating: ratingAgg && ratingAgg.count > 0 ? ratingAgg.average : null,
    };
  });
}

function composeBusinessStatsSummaryPayload(
  business: BusinessDashboardContext["business"],
  roster: BusinessDashboardContext["roster"],
  timeframe: BusinessDashboardTimeframe,
  summaryMetrics: BusinessDashboardSqlBundle["summary"],
) {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    onboardingVerificationStatus: business.onboardingVerificationStatus,
    kycVerificationStatus: business.kycVerificationStatus,
    timeframe,
    totalTips: summaryMetrics.periodAmount,
    tipCount: summaryMetrics.periodCount,
    employeeCount: roster.tipping_ready,
    operationalPulse: {
      tipsLast60m: { amount: summaryMetrics.last60Amount, count: summaryMetrics.last60Count },
      tipsToday: { amount: summaryMetrics.todayAmount, count: summaryMetrics.todayCount },
      tippingReadyEmployees: roster.tipping_ready,
      rosterTotal: roster.roster_total,
      employeesMissingQr: roster.missing_qr,
      goalsTracked: 0,
      goalsOnTrackOrBetter: 0,
    },
  };
}

/**
 * Cold KPI path: one SQL round trip for business + roster + period/pulse totals.
 * Primes context + summary metric caches for subsequent scopes/timeframes.
 */
async function loadBusinessStatsSummaryColdCombined(
  businessId: string,
  timeframe: BusinessDashboardTimeframe,
) {
  const now = new Date();
  const sixtyAgo = new Date(Date.now() - 60 * 60 * 1000);

  const row = await logDashboardPhase("business.myStats.summary", "metaSummarySql", () =>
    queryBusinessDashboardMetaAndSummaryMetrics({
      businessId,
      timeframe,
      sixtyAgo,
      todayEnd: now,
    }),
  );

  const tz = sanitizeIanaTimezone(row.timezone);
  const summaryMetrics: BusinessDashboardSqlBundle["summary"] = {
    periodAmount: Number(row.period_amount ?? 0),
    periodCount: Number(row.period_count ?? 0),
    last60Amount: Number(row.last60_amount ?? 0),
    last60Count: Number(row.last60_count ?? 0),
    todayAmount: Number(row.today_amount ?? 0),
    todayCount: Number(row.today_count ?? 0),
  };

  const ctx: BusinessDashboardContext = {
    business: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      onboardingVerificationStatus: row.onboarding_verification_status,
      kycVerificationStatus: row.kyc_verification_status,
      timezone: row.timezone,
    },
    tz,
    roster: {
      roster_total: Number(row.roster_total ?? 0),
      tipping_ready: Number(row.tipping_ready ?? 0),
      missing_qr: Number(row.missing_qr ?? 0),
    },
  };

  primeCachedValue(`biz-dash-context:${businessId}`, BUSINESS_META_ROSTER_CACHE_TTL_MS, ctx);
  primeCachedValue(
    `biz-dash-summary:${businessId}:${timeframe}`,
    BUSINESS_SUMMARY_METRICS_CACHE_TTL_MS,
    {
      summary: summaryMetrics,
      timeframe,
      ctx: { businessId, timeframe },
    } satisfies BusinessSummaryMetricsSlice,
  );

  return composeBusinessStatsSummaryPayload(ctx.business, ctx.roster, timeframe, summaryMetrics);
}

async function getBusinessStatsSummaryImpl(
  businessId: string,
  timeframe: BusinessDashboardTimeframe = "month",
) {
  const warmCtx = getCachedIfFresh<BusinessDashboardContext>(`biz-dash-context:${businessId}`);
  if (!warmCtx) {
    // Cold: one round trip for KPI cards (business + roster + tip totals).
    const payload = await runBusinessDashboardDb(businessId, () =>
      loadBusinessStatsSummaryColdCombined(businessId, timeframe),
    );
    logStatsPhase("summary_ok", {
      businessId,
      timeframe,
      totalTips: payload.totalTips,
      tipCount: payload.tipCount,
      employeeCount: payload.employeeCount,
      path: "metaSummaryCombined",
    });
    return payload;
  }

  const { summary: summaryMetrics, ctx } = await loadBusinessSummaryMetricsSliceCached(
    businessId,
    timeframe,
  );
  logStatsPhase("summary_start", ctx);
  const payload = composeBusinessStatsSummaryPayload(
    warmCtx.business,
    warmCtx.roster,
    timeframe,
    summaryMetrics,
  );
  logStatsPhase("summary_ok", {
    ...ctx,
    totalTips: payload.totalTips,
    tipCount: payload.tipCount,
    employeeCount: payload.employeeCount,
    path: "summarySqlOnly",
  });
  return payload;
}

async function getBusinessStatsAnalyticsImpl(
  businessId: string,
  timeframe: BusinessDashboardTimeframe = "month",
) {
  const { business, tz } = await loadBusinessDashboardContextCached(businessId);
  const { bundle, rangeStart, ctx } = await loadBusinessSqlBundleSliceCached(businessId, timeframe);
  logStatsPhase("analytics_start", ctx);

  // Table assignments are only needed for staff management views (timeframe=all).
  const { employees, employeeGoals } = await runSerializedByKey(
    `biz-dash-analytics-extras:${businessId}:${timeframe === "all" ? "all" : "charts"}`,
    () => loadBusinessAnalyticsExtras(businessId, { includeAssignments: timeframe === "all" }),
  );
  const dailyTipDistribution = buildChartFromSqlBundle(timeframe, rangeStart, tz, bundle);
  console.info("[SSOT:13.7] business.dailyTipDistribution", {
    businessId,
    timeframe,
    tz,
    rangeStartIso: rangeStart.toISOString(),
    todayAmount: bundle.summary.todayAmount,
    todayCount: bundle.summary.todayCount,
    periodAmount: bundle.summary.periodAmount,
    distribution: dailyTipDistribution,
  });
  assertBusinessChartKpiSsot({
    businessId,
    timeframe,
    tz,
    rangeStart,
    dailyTipDistribution,
    periodAmount: bundle.summary.periodAmount,
    todayAmount: bundle.summary.todayAmount,
    todayCount: bundle.summary.todayCount,
  });
  const ratingsByEmployee = await queryEmployeeRatingAggregates(businessId);
  const employeeStats = mapEmployeesToStats(employees, bundle.tipsByEmployee, ratingsByEmployee);

  const goalsTracked = employeeGoals.length;
  const goalsOnTrackOrBetter = employeeGoals.filter(
    (g) => g.status === "on_track" || g.status === "achieved",
  ).length;

  const periodTotalTips = bundle.summary.periodAmount;
  const prior = bundle.priorPeriod;
  const growthPercent =
    prior.totalTips > 0
      ? Math.round(((periodTotalTips - prior.totalTips) / prior.totalTips) * 100)
      : periodTotalTips > 0
        ? 100
        : 0;

  logStatsPhase("analytics_ok", {
    ...ctx,
    employeeCount: employees.length,
    chartPoints: dailyTipDistribution.length,
  });

  return {
    id: business.id,
    timeframe,
    dailyTipDistribution,
    employees: employeeStats,
    employeeGoals,
    operationalPulse: { goalsTracked, goalsOnTrackOrBetter },
    locationRankings: bundle.locationRankings,
    tableRankings: bundle.tableRankings,
    priorPeriod: prior,
    growthPercent,
    peakHour: bundle.shiftAggregate.peakHour,
    bestShift: bundle.shiftAggregate.bestShift,
    avgTipsPerShift: bundle.shiftAggregate.avgTipsPerShift,
    completedShifts: bundle.shiftAggregate.completedShifts,
  };
}

async function getBusinessStatsRosterImpl(businessId: string) {
  const { business } = await loadBusinessDashboardContextCached(businessId);
  const { bundle } = await loadBusinessSqlBundleSliceCached(businessId, "all");
  const employees = await loadBusinessAnalyticsEmployeesCached(businessId, true);
  const ratingsByEmployee = await queryEmployeeRatingAggregates(businessId);
  const employeeStats = mapEmployeesToStats(employees, bundle.tipsByEmployee, ratingsByEmployee);

  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    onboardingVerificationStatus: business.onboardingVerificationStatus,
    kycVerificationStatus: business.kycVerificationStatus,
    timeframe: "all" as const,
    employees: employeeStats,
  };
}

async function getBusinessStatsImpl(
  businessId: string,
  timeframe: BusinessDashboardTimeframe = "month",
) {
  const ctx = { businessId, timeframe };
  logStatsPhase("start", ctx);
  try {
    // Single sql-bundle load for full scope (avoids summary→analytics double tips scans).
    const { business, roster, tz, bundle, rangeStart } = await loadBusinessSqlBundleCached(
      businessId,
      timeframe,
    );
    const summaryMetrics = bundle.summary;
    const totalTips = summaryMetrics.periodAmount;
    const tipCount = summaryMetrics.periodCount;

    const { employees, employeeGoals } = await runSerializedByKey(
      `biz-dash-analytics-extras:${businessId}:${timeframe === "all" ? "all" : "charts"}`,
      () => loadBusinessAnalyticsExtras(businessId, { includeAssignments: timeframe === "all" }),
    );
    const dailyTipDistribution = buildChartFromSqlBundle(timeframe, rangeStart, tz, bundle);
    assertBusinessChartKpiSsot({
      businessId,
      timeframe,
      tz,
      rangeStart,
      dailyTipDistribution,
      periodAmount: summaryMetrics.periodAmount,
      todayAmount: summaryMetrics.todayAmount,
      todayCount: summaryMetrics.todayCount,
    });
    const ratingsByEmployee = await queryEmployeeRatingAggregates(businessId);
    const employeeStats = mapEmployeesToStats(employees, bundle.tipsByEmployee, ratingsByEmployee);

    const goalsTracked = employeeGoals.length;
    const goalsOnTrackOrBetter = employeeGoals.filter(
      (g) => g.status === "on_track" || g.status === "achieved",
    ).length;

    const prior = bundle.priorPeriod;
    const growthPercent =
      prior.totalTips > 0
        ? Math.round(((totalTips - prior.totalTips) / prior.totalTips) * 100)
        : totalTips > 0
          ? 100
          : 0;

    const payload = {
      id: business.id,
      name: business.name,
      slug: business.slug,
      onboardingVerificationStatus: business.onboardingVerificationStatus,
      kycVerificationStatus: business.kycVerificationStatus,
      timeframe,
      totalTips,
      tipCount,
      employeeCount: roster.tipping_ready,
      dailyTipDistribution,
      employees: employeeStats,
      employeeGoals,
      locationRankings: bundle.locationRankings,
      tableRankings: bundle.tableRankings,
      priorPeriod: prior,
      growthPercent,
      peakHour: bundle.shiftAggregate.peakHour,
      bestShift: bundle.shiftAggregate.bestShift,
      avgTipsPerShift: bundle.shiftAggregate.avgTipsPerShift,
      completedShifts: bundle.shiftAggregate.completedShifts,
      operationalPulse: {
        tipsLast60m: { amount: summaryMetrics.last60Amount, count: summaryMetrics.last60Count },
        tipsToday: { amount: summaryMetrics.todayAmount, count: summaryMetrics.todayCount },
        tippingReadyEmployees: roster.tipping_ready,
        rosterTotal: roster.roster_total,
        employeesMissingQr: roster.missing_qr,
        goalsTracked,
        goalsOnTrackOrBetter,
      },
    };
    logStatsPhase("ok", {
      ...ctx,
      totalTips: payload.totalTips,
      tipCount: payload.tipCount,
      employeeCount: payload.employeeCount,
      chartPoints: payload.dailyTipDistribution?.length ?? 0,
    });
    return payload;
  } catch (err) {
    logStatsPhase("failed", ctx, err);
    if (err instanceof StatsFetchError) throw err;
    if (err instanceof Error && err.message === "Business not found") {
      throw new StatsFetchError(err.message, ctx, { cause: err });
    }
    throw new StatsFetchError("Unable to load stats", ctx, { cause: err });
  }
}

/** All tips for a business (export); caller must ensure businessId is authorized. */
export async function getTipsForExport(businessId: string) {
  return prisma.transaction.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: {
      employee: { select: { id: true, name: true, jobTitle: true } },
    },
  });
}

/** Manager JWT: own venue only (full profile). */
export async function getManagerBusinessProfile(userId: string) {
  const b = await getBusinessByUserId(userId);
  if (!b) return null;
  const profile = await getManagerBusinessProfileById(b.id);
  if (!profile) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hasCompletedOnboarding: true, onboardingCompletedAt: true },
  });
  const onboardingCompleted =
    user?.hasCompletedOnboarding === true && user.onboardingCompletedAt != null;
  const onboardingStep = onboardingCompleted
    ? 3
    : inferManagerOnboardingStep({
        name: profile.name,
        businessType: profile.type,
        registeredAddress: profile.registeredAddress,
      });

  return {
    ...profile,
    onboardingCompleted,
    onboardingStep,
  };
}

const BUSINESS_PROFILE_SELECT = {
  id: true,
  name: true,
  slug: true,
  businessType: true,
  location: true,
  registeredAddress: true,
  timezone: true,
  onboardingVerificationStatus: true,
  kycVerificationStatus: true,
  subscriptionTier: true,
  contactPhone: true,
  website: true,
  logoPath: true,
  bannerImagePath: true,
  brandPrimaryColor: true,
  brandSecondaryColor: true,
  welcomeMessage: true,
  thankYouMessage: true,
  brandDisplayName: true,
  brandTagline: true,
  qrTemplate: true,
  qrBorderStyle: true,
  qrShape: true,
  qrAccentColor: true,
  qrBackgroundColor: true,
} as const;

async function countActivePublicEmployees(businessId: string): Promise<number> {
  return prisma.employee.count({
    where: {
      businessId,
      isActive: true,
      activationStatus: "active",
      user: { is: { emailVerified: true } },
    },
  });
}

/** Public tipping / QR — no KYC tier, contact, or staff counts. */
export async function getPublicBusinessById(id: string): Promise<PublicBusinessProfileDto | null> {
  const business = await prisma.business.findUnique({
    where: { id },
    select: BUSINESS_PROFILE_SELECT,
  });
  if (!business) return null;
  const entitlements = await resolveSubscriptionEntitlements(business.id);
  return toPublicBusinessProfileDto(business, entitlements.subscriptionTier);
}

/** Manager profile + authenticated consumers — includes operational fields. */
export async function getManagerBusinessProfileById(
  id: string,
): Promise<ManagerBusinessProfileDto | null> {
  const business = await prisma.business.findUnique({
    where: { id },
    select: BUSINESS_PROFILE_SELECT,
  });
  if (!business) return null;
  const employeeCount = await countActivePublicEmployees(business.id);
  const entitlements = await resolveSubscriptionEntitlements(business.id);
  return toManagerBusinessProfileDto(
    { ...business, subscriptionTier: entitlements.subscriptionTier },
    employeeCount,
    entitlements,
  );
}

/** @deprecated Use getPublicBusinessById or getManagerBusinessProfileById. */
export async function getBusinessById(id: string) {
  return getManagerBusinessProfileById(id);
}

const MAX_LOCATION_LEN = 2000;

export async function updateManagerBusinessProfile(
  userId: string,
  data: {
    /** Preferred public / display name (same column as `legalBusinessName` legacy). */
    name?: string;
    legalBusinessName?: string;
    businessType?: string | null;
    /** Short venue location (separate from registered address). */
    location?: string | null;
    registeredAddress?: string | null;
    contactPhone?: string | null;
    website?: string | null;
  }
): Promise<{ id: string }> {
  const b = await getBusinessByUserId(userId);
  if (!b) {
    throw new Error("Business not found");
  }

  const nameSource = data.name !== undefined ? data.name : data.legalBusinessName;
  const nextName =
    nameSource !== undefined ? String(nameSource).trim() : undefined;
  if (nextName !== undefined && nextName.length === 0) {
    throw new Error("Business name is required");
  }
  const nextType = data.businessType !== undefined ? (data.businessType?.trim() || null) : undefined;
  const nextLocation =
    data.location !== undefined
      ? data.location == null
        ? null
        : (() => {
            const t = String(data.location).trim();
            if (t.length > MAX_LOCATION_LEN) {
              throw new Error(`Location must be at most ${MAX_LOCATION_LEN} characters`);
            }
            return t || null;
          })()
      : undefined;
  const nextAddress =
    data.registeredAddress !== undefined ? (data.registeredAddress?.trim() || null) : undefined;
  const nextPhone =
    data.contactPhone !== undefined ? (data.contactPhone?.trim() || null) : undefined;
  const nextWebsite =
    data.website !== undefined ? (data.website?.trim() || null) : undefined;

  await prisma.business.update({
    where: { id: b.id },
    data: {
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(nextType !== undefined ? { businessType: nextType } : {}),
      ...(nextLocation !== undefined ? { location: nextLocation } : {}),
      ...(nextAddress !== undefined ? { registeredAddress: nextAddress } : {}),
      ...(nextPhone !== undefined ? { contactPhone: nextPhone } : {}),
      ...(nextWebsite !== undefined ? { website: nextWebsite } : {}),
    },
    select: { id: true },
  });

  emitBusinessDataChanged(b.id, "business_profile_updated");
  return { id: b.id };
}

/** Rotate the public business slug so storefront QR becomes a new link. */
export async function regenerateManagerBusinessSlug(userId: string): Promise<{ slug: string }> {
  const b = await getBusinessByUserId(userId);
  if (!b) {
    throw new Error("Business not found");
  }
  const base = normalizeBusinessSlugBase(b.name);
  const seed = `${base}-${randomBytes(2).toString("hex")}`;
  const slug = await ensureUniqueSlug(seed, async (s) => {
    const hit = await prisma.business.findFirst({ where: { slug: s, NOT: { id: b.id } } });
    return !!hit;
  });
  await prisma.business.update({ where: { id: b.id }, data: { slug } });
  emitBusinessDataChanged(b.id, "business_profile_updated");
  return { slug };
}
