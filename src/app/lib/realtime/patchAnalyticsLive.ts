import type { BusinessDashboardStats, TipActivityRow, BusinessQrAnalytics } from "../api";
import type { AnalyticsTimeframe, BusinessAnalyticsBundle } from "../businessAnalytics/types";
import {
  getBusinessAnalyticsBundle,
  setBusinessAnalyticsBundle,
} from "../businessAnalytics/businessAnalyticsStore";
import { buildBusinessAnalyticsDTO } from "../businessAnalytics/businessAnalyticsService";
import type { LiveNewTipPayload } from "./realtimeContracts";
import { trackSocketPatchApplied } from "./realtimeMetrics";

type PatchListener = (dto: ReturnType<typeof buildBusinessAnalyticsDTO>) => void;
const patchListeners = new Set<PatchListener>();

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
      tipsToday: {
        amount: pulse.tipsToday.amount + amount,
        count: pulse.tipsToday.count + 1,
      },
    },
  };
}

export function patchLiveTipAcrossTimeframes(
  payload: LiveNewTipPayload,
  employeeName?: string | null,
): void {
  const status = String(payload.tip.status ?? "").toLowerCase();
  if (status && status !== "success") return;

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

      const totalTips = (stats.totalTips ?? 0) + Number(payload.tip.amount || 0);
      const tipCount = (stats.tipCount ?? 0) + 1;
      const pulse = stats.operationalPulse
        ? {
            ...stats.operationalPulse,
            tipsLast60m: {
              amount: stats.operationalPulse.tipsLast60m.amount + Number(payload.tip.amount || 0),
              count: stats.operationalPulse.tipsLast60m.count + 1,
            },
            tipsToday: {
              amount: stats.operationalPulse.tipsToday.amount + Number(payload.tip.amount || 0),
              count: stats.operationalPulse.tipsToday.count + 1,
            },
          }
        : stats.operationalPulse;

      const nextStats: BusinessDashboardStats = {
        ...stats,
        totalTips,
        tipCount,
        operationalPulse: pulse,
      };

      return {
        ...bundle,
        periodStats: nextStats,
        recentTips: [row, ...prevTips].slice(0, 50),
        fetchedAt: Date.now(),
      };
    });
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
