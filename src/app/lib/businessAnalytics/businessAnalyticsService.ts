import { getBusinessStats, listBusinessTips, getBusinessQrAnalytics, type BusinessStatsScope } from "../api";
import { runBusinessIntelligenceEngine } from "../businessIntelligenceEngine";import { buildBusinessIntelligenceInput, tipsFeedParamsForTimeframe } from "../buildBusinessIntelligenceInput";
import {
  getBusinessAnalyticsBundle,
  setBusinessAnalyticsBundle,
  upsertBusinessAnalyticsStatsBundle,
} from "./businessAnalyticsStore";
import { snapshotFromStats, todaySnapshotFromPulse } from "./snapshot";
import type {
  AnalyticsTimeframe,
  BusinessAnalyticsBundle,
  BusinessAnalyticsDTO,
  FetchBusinessAnalyticsOptions,
} from "./types";
import type { BusinessDashboardStats } from "../api";
import { trackAnalyticsCacheHit, trackAnalyticsCacheMiss, trackAnalyticsRefetch } from "../realtime/realtimeMetrics";

/** Whether a cached bundle satisfies the requested fetch options (avoids stats-only false hits). */
export function isBusinessAnalyticsBundleComplete(
  bundle: BusinessAnalyticsBundle,
  opts?: FetchBusinessAnalyticsOptions,
): boolean {
  const includeTipsFeed = opts?.includeTipsFeed !== false;
  const includeQrAnalytics = opts?.includeQrAnalytics !== false;
  if (!bundle.periodStats) return false;
  if (includeTipsFeed && !bundle.tipsFeedFetched) return false;
  if (includeQrAnalytics && !bundle.qrFetched) return false;
  return true;
}

/**
 * Sprint 8.1 — single authoritative period stats fetch (scope=full).
 * Used by dashboard overview to avoid summary + analytics duplicate calls.
 */
export async function fetchBusinessPeriodStats(
  timeframe: AnalyticsTimeframe,
  opts?: FetchBusinessAnalyticsOptions,
): Promise<BusinessDashboardStats> {
  if (!opts?.revalidate) {
    const cached = getBusinessAnalyticsBundle(timeframe);
    if (cached?.periodStats) {
      trackAnalyticsCacheHit();
      return cached.periodStats;
    }
  }

  trackAnalyticsCacheMiss();
  trackAnalyticsRefetch();

  const periodStats = await getBusinessStats(timeframe, {
    scope: opts?.scope ?? "full",
    signal: opts?.signal,
    silent: opts?.silent,
    revalidate: opts?.revalidate,
  });

  upsertBusinessAnalyticsStatsBundle(timeframe, periodStats);
  return periodStats;
}

/**
 * Sprint 3B — unified fetch for business analytics.
 * Single entry for period stats + week comparison + optional tips feed.
 */
export async function fetchBusinessAnalyticsBundle(
  timeframe: AnalyticsTimeframe,
  opts?: FetchBusinessAnalyticsOptions,
): Promise<BusinessAnalyticsBundle> {
  const cached = !opts?.revalidate ? getBusinessAnalyticsBundle(timeframe) : null;
  if (cached && isBusinessAnalyticsBundleComplete(cached, opts)) {
    trackAnalyticsCacheHit();
    return cached;
  }

  const includeTipsFeed = opts?.includeTipsFeed !== false;
  const includeWeekStats = opts?.includeWeekStats !== false;
  const includeQrAnalytics = opts?.includeQrAnalytics !== false;
  const feedParams = tipsFeedParamsForTimeframe(timeframe);

  const needsPeriodStats = !cached?.periodStats || Boolean(opts?.revalidate);
  const needsWeekStats =
    includeWeekStats && (!cached?.weekStats || Boolean(opts?.revalidate));
  const needsTipsFeed =
    includeTipsFeed && (!cached?.tipsFeedFetched || Boolean(opts?.revalidate));
  const needsQrAnalytics =
    includeQrAnalytics && (!cached?.qrFetched || Boolean(opts?.revalidate));

  if (
    cached &&
    !needsPeriodStats &&
    !needsWeekStats &&
    !needsTipsFeed &&
    !needsQrAnalytics
  ) {
    trackAnalyticsCacheHit();
    return cached;
  }

  trackAnalyticsCacheMiss();
  if (needsPeriodStats || needsWeekStats || needsTipsFeed || needsQrAnalytics) {
    trackAnalyticsRefetch();
  }

  const [periodStats, weekStats, feed, qrAnalytics] = await Promise.all([
    needsPeriodStats
      ? getBusinessStats(timeframe, {
          scope: "full",
          signal: opts?.signal,
          silent: opts?.silent,
          revalidate: opts?.revalidate,
        })
      : Promise.resolve(cached!.periodStats),
    needsWeekStats
      ? getBusinessStats("week", {
          scope: "summary",
          signal: opts?.signal,
          silent: opts?.silent,
          revalidate: opts?.revalidate,
        })
      : Promise.resolve(cached?.weekStats ?? cached?.periodStats ?? null),
    needsTipsFeed
      ? listBusinessTips({
          ...feedParams,
          skip: 0,
          status: "success",
        })
      : Promise.resolve({ items: cached?.recentTips ?? [] }),
    needsQrAnalytics
      ? getBusinessQrAnalytics(timeframe, { signal: opts?.signal, silent: opts?.silent }).catch(
          () => null,
        )
      : Promise.resolve(cached?.qrAnalytics ?? null),
  ]);

  const bundle: BusinessAnalyticsBundle = {
    timeframe,
    periodStats,
    weekStats: weekStats ?? periodStats,
    recentTips: needsTipsFeed ? feed.items : (cached?.recentTips ?? feed.items),
    qrAnalytics: needsQrAnalytics ? qrAnalytics : (cached?.qrAnalytics ?? null),
    tipsFeedFetched: includeTipsFeed
      ? needsTipsFeed || (cached?.tipsFeedFetched ?? false)
      : (cached?.tipsFeedFetched ?? false),
    qrFetched: includeQrAnalytics
      ? needsQrAnalytics || (cached?.qrFetched ?? false)
      : (cached?.qrFetched ?? false),
    fetchedAt: Date.now(),
  };

  setBusinessAnalyticsBundle(timeframe, bundle);
  return bundle;
}

/** Map raw bundle → authoritative DTO with shared BI aggregates. */
export function buildBusinessAnalyticsDTO(bundle: BusinessAnalyticsBundle): BusinessAnalyticsDTO {
  const period = snapshotFromStats(bundle.periodStats);
  const week = snapshotFromStats(bundle.weekStats);
  const pulse = bundle.periodStats.operationalPulse ?? null;
  const today = todaySnapshotFromPulse(pulse);

  const dailyTipDistribution = bundle.periodStats.dailyTipDistribution ?? [];
  const input = buildBusinessIntelligenceInput({
    period,
    week,
    today,
    dailyTipDistribution,
    recentTips: bundle.recentTips,
    employees: bundle.periodStats.employees ?? [],
    employeeGoals: bundle.periodStats.employeeGoals ?? [],
    pulse,
    qrAnalytics: bundle.qrAnalytics ?? null,
    locationRankings: bundle.periodStats.locationRankings,
    tableRankings: bundle.periodStats.tableRankings,
    growthPercent: bundle.periodStats.growthPercent,
    peakHour: bundle.periodStats.peakHour,
    bestShift: bundle.periodStats.bestShift,
    avgTipsPerShift: bundle.periodStats.avgTipsPerShift,
    completedShifts: bundle.periodStats.completedShifts,
  });

  const intelligence = runBusinessIntelligenceEngine(input);

  if (import.meta.env.DEV) {
    void import("../assertKpiChartIntegrity").then(({ runBusinessSsotIntegrityChecks }) => {
      runBusinessSsotIntegrityChecks({
        label: `business.${bundle.timeframe}`,
        kpiTotal: period.totalTips,
        chartAmounts: dailyTipDistribution.map((r) => r.amount),
        locationRankings: bundle.periodStats.locationRankings,
        tableRankings: bundle.periodStats.tableRankings,
      });
    });
  }

  return {
    timeframe: bundle.timeframe,
    stats: bundle.periodStats,
    period,
    week,
    today,
    pulse,
    recentTips: bundle.recentTips,
    employees: bundle.periodStats.employees ?? [],
    employeeGoals: bundle.periodStats.employeeGoals ?? [],
    dailyTipDistribution,
    input,
    intelligence,
    fetchedAt: bundle.fetchedAt,
  };
}

export async function fetchBusinessAnalyticsDTO(
  timeframe: AnalyticsTimeframe,
  opts?: FetchBusinessAnalyticsOptions,
): Promise<BusinessAnalyticsDTO> {
  const bundle = await fetchBusinessAnalyticsBundle(timeframe, opts);
  return buildBusinessAnalyticsDTO(bundle);
}
