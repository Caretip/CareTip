import type { BusinessDashboardStats, TipActivityRow, BusinessQrAnalytics } from "../api";
import type { AnalyticsTimeframe, BusinessAnalyticsBundle } from "../businessAnalytics/types";
import {
  getBusinessAnalyticsBundle,
  setBusinessAnalyticsBundle,
} from "../businessAnalytics/businessAnalyticsStore";
import { buildBusinessAnalyticsDTO } from "../businessAnalytics/businessAnalyticsService";
import {
  isWithinVenueLocalDay,
  resolveBusinessTimezone,
  venueLocalDayKey,
} from "../businessVenueTime";
import type { LiveNewTipPayload } from "./realtimeContracts";
import { trackSocketPatchApplied } from "./realtimeMetrics";

type PatchListener = (dto: ReturnType<typeof buildBusinessAnalyticsDTO>) => void;
const patchListeners = new Set<PatchListener>();

const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTH_KEYS = [
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

/**
 * Map a tip timestamp to the chart bucket key used by dailyTipDistribution
 * (Luxon `ccc` / DOM / month short — English keys from the API).
 * Never use `length - 1` (that wrongly bumps Sunday / last DOM / Dec).
 */
function venueTipChartBucketKey(
  createdAt: string,
  timeframe: AnalyticsTimeframe,
  timeZone?: string | null,
): string | null {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  const tz = resolveBusinessTimezone(timeZone);

  if (timeframe === "week") {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
    return (WEEKDAY_KEYS as readonly string[]).includes(wd) ? wd : null;
  }
  if (timeframe === "month") {
    const dayKey = venueLocalDayKey(createdAt, tz);
    if (!dayKey) return null;
    return String(Number(dayKey.slice(8, 10)));
  }
  if (timeframe === "year") {
    const mon = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short" }).format(d);
    return (MONTH_KEYS as readonly string[]).includes(mon) ? mon : null;
  }
  return null;
}

function bumpDailyTipDistributionBucket(
  dist: Array<{ day: string; amount: number }>,
  timeframe: AnalyticsTimeframe,
  createdAt: string,
  amount: number,
): Array<{ day: string; amount: number }> {
  if (dist.length === 0) return dist;
  const tipKey = venueTipChartBucketKey(createdAt, timeframe);
  if (!tipKey) return dist;

  let matched = false;
  const next = dist.map((row) => {
    const rowKey =
      timeframe === "month" ? String(Number.parseInt(String(row.day), 10) || 0) : String(row.day);
    if (rowKey !== tipKey) return row;
    matched = true;
    return { ...row, amount: (Number(row.amount) || 0) + amount };
  });
  return matched ? next : dist;
}

export function subscribeAnalyticsPatch(listener: PatchListener): () => void {
  patchListeners.add(listener);
  return () => patchListeners.delete(listener);
}

function notifyPatchListeners(timeframe: AnalyticsTimeframe): void {
  const bundle = getBusinessAnalyticsBundle(timeframe);
  if (!bundle) return;
  const dto = buildBusinessAnalyticsDTO(bundle);
  for (const l of patchListeners) {
    try {
      l(dto);
    } catch {
      // isolate subscriber failures
    }
  }
}

function patchBundle(
  timeframe: AnalyticsTimeframe,
  patcher: (b: BusinessAnalyticsBundle) => BusinessAnalyticsBundle,
): void {
  const current = getBusinessAnalyticsBundle(timeframe);
  if (!current) return;
  const next = patcher(current);
  setBusinessAnalyticsBundle(timeframe, next);
  trackSocketPatchApplied();
  notifyPatchListeners(timeframe);
}

function tipBelongsToVenueToday(createdAt: string, timezoneHint?: string | null): boolean {
  return isWithinVenueLocalDay(createdAt, resolveBusinessTimezone(timezoneHint));
}

/** Optimistic dashboard summary patch when analytics bundle is not hydrated yet. */
export function patchDashboardStatsForLiveTip(
  stats: Partial<BusinessDashboardStats>,
  payload: LiveNewTipPayload,
): Partial<BusinessDashboardStats> {
  const status = String(payload.tip.status ?? "").toLowerCase();
  if (status && status !== "success") return stats;

  const amount = Number(payload.tip.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return stats;

  const pulse = stats.operationalPulse ?? {
    tipsLast60m: { amount: 0, count: 0 },
    tipsToday: { amount: 0, count: 0 },
    tippingReadyEmployees: 0,
    rosterTotal: 0,
    employeesMissingQr: 0,
    goalsTracked: 0,
    goalsOnTrackOrBetter: 0,
  };

  const bumpToday = tipBelongsToVenueToday(payload.tip.createdAt);

  return {
    ...stats,
    totalTips: (stats.totalTips ?? 0) + amount,
    tipCount: (stats.tipCount ?? 0) + 1,
    operationalPulse: {
      ...pulse,
      tipsLast60m: {
        amount: pulse.tipsLast60m.amount + amount,
        count: pulse.tipsLast60m.count + 1,
      },
      tipsToday: bumpToday
        ? {
            amount: pulse.tipsToday.amount + amount,
            count: pulse.tipsToday.count + 1,
          }
        : pulse.tipsToday,
    },
  };
}

export function patchLiveTipAcrossTimeframes(
  payload: LiveNewTipPayload,
  employeeName?: string | null,
): void {
  const status = String(payload.tip.status ?? "").toLowerCase();
  if (status && status !== "success") return;

  const amount = Number(payload.tip.amount || 0);
  const bumpToday = tipBelongsToVenueToday(payload.tip.createdAt);

  const row: TipActivityRow = {
    id: payload.tip.id,
    amount: payload.tip.amount,
    status: payload.tip.status,
    createdAt: payload.tip.createdAt,
    employeeId: payload.employeeId,
    locationId: null,
    tableId: null,
    staffName: employeeName ?? payload.employeeName ?? null,
    locationName: null,
    tableName: null,
  };

  for (const tf of ["week", "month", "year"] as AnalyticsTimeframe[]) {
    patchBundle(tf, (bundle) => {
      const stats = bundle.periodStats;
      const prevTips = bundle.recentTips ?? [];
      if (prevTips.some((tip) => tip.id === row.id)) return bundle;

      const totalTips = (stats.totalTips ?? 0) + amount;
      const tipCount = (stats.tipCount ?? 0) + 1;
      const pulse = stats.operationalPulse
        ? {
            ...stats.operationalPulse,
            tipsLast60m: {
              amount: stats.operationalPulse.tipsLast60m.amount + amount,
              count: stats.operationalPulse.tipsLast60m.count + 1,
            },
            tipsToday: bumpToday
              ? {
                  amount: stats.operationalPulse.tipsToday.amount + amount,
                  count: stats.operationalPulse.tipsToday.count + 1,
                }
              : stats.operationalPulse.tipsToday,
          }
        : stats.operationalPulse;

      const dist = stats.dailyTipDistribution ?? [];
      const dailyTipDistribution = bumpDailyTipDistributionBucket(
        dist,
        tf,
        payload.tip.createdAt,
        amount,
      );

      const nextStats: BusinessDashboardStats = {
        ...stats,
        totalTips,
        tipCount,
        operationalPulse: pulse,
        dailyTipDistribution,
      };

      return {
        ...bundle,
        periodStats: nextStats,
        recentTips: [row, ...prevTips].slice(0, 50),
        fetchedAt: Date.now(),
      };
    });
  }

  if (import.meta.env.DEV) {
    for (const tf of ["week", "month", "year"] as const) {
      const bundle = getBusinessAnalyticsBundle(tf);
      if (!bundle?.periodStats) continue;
      void import("../assertKpiChartIntegrity").then(({ assertLivePatchReconciles }) => {
        assertLivePatchReconciles({
          label: tf,
          kpiTotal: bundle.periodStats.totalTips ?? 0,
          chartAmounts: (bundle.periodStats.dailyTipDistribution ?? []).map((r) => r.amount),
        });
      });
    }
  }
}

export function patchQrAnalyticsLocal(
  data: BusinessQrAnalytics | null,
  scanDelta = 1,
): BusinessQrAnalytics | null {
  if (!data) return data;
  trackSocketPatchApplied();
  return {
    ...data,
    totalScans: data.totalScans + scanDelta,
    repeatScans: data.repeatScans + scanDelta,
    scanTrend:
      data.scanTrend.length > 0
        ? data.scanTrend.map((row, i) =>
            i === data.scanTrend.length - 1 ? { ...row, count: row.count + scanDelta } : row,
          )
        : data.scanTrend,
  };
}
