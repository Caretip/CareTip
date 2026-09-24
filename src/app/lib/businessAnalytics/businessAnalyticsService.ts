import {
  getBusinessStats,
  listBusinessTips,
  getBusinessQrAnalytics,
  mergeBusinessDashboardStats,
  type BusinessStatsScope,
} from "../api";
import { runBusinessIntelligenceEngine } from "../businessIntelligenceEngine";
import { buildBusinessIntelligenceInput, tipsFeedParamsForTimeframe } from "../buildBusinessIntelligenceInput";
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
import { markAnalyticsPerformance } from "./analyticsPerformanceMarks";

/** Whether period stats include above-fold authoritative fields (KPIs, prior, employees). */
export function bundleHasAboveFoldStats(stats: BusinessDashboardStats | undefined): boolean {
  if (!stats) return false;
  return stats.priorPeriod != null && Array.isArray(stats.employees);
}

/** Whether period stats include deferred lower-page analytics (charts, rankings, shifts, goals). */
export function bundleHasDeferredStats(stats: BusinessDashboardStats | undefined): boolean {
  if (!stats) return false;
  return (
    (stats.dailyTipDistribution != null && stats.dailyTipDistribution.length > 0) ||
    stats.locationRankings != null ||
    stats.tableRankings != null ||
    stats.avgTipsPerShift != null ||
    (stats.employeeGoals != null && stats.employeeGoals.length > 0) ||
    stats.peakHour != null
  );
}

function resolveBundleSliceFlags(bundle: BusinessAnalyticsBundle): {
  aboveFoldFetched: boolean;
  deferredAnalyticsFetched: boolean;
} {
  return {
    aboveFoldFetched: Boolean(bundle.aboveFoldFetched) || bundleHasAboveFoldStats(bundle.periodStats),
    deferredAnalyticsFetched:
      Boolean(bundle.deferredAnalyticsFetched) || bundleHasDeferredStats(bundle.periodStats),
  };
}

/** Whether a cached bundle satisfies the requested fetch options (avoids stats-only false hits). */
export function isBusinessAnalyticsBundleComplete(
  bundle: BusinessAnalyticsBundle,
  opts?: FetchBusinessAnalyticsOptions,
): boolean {
  const includeTipsFeed = opts?.includeTipsFeed !== false;
  const includeQrAnalytics = opts?.includeQrAnalytics !== false;
  const { aboveFoldFetched, deferredAnalyticsFetched } = resolveBundleSliceFlags(bundle);
  if (!aboveFoldFetched || !bundle.periodStats) return false;
  if (opts?.includeDeferredAnalytics !== false && !deferredAnalyticsFetched) return false;
  if (includeTipsFeed && !bundle.tipsFeedFetched) return false;
  if (includeQrAnalytics && !bundle.qrFetched) return false;
  return true;
}

/** Above-fold slice only — used to gate overview/revenue/operational KPI cards. */
export function isBusinessAnalyticsAboveFoldComplete(
  bundle: BusinessAnalyticsBundle | null | undefined,
): boolean {
  if (!bundle?.periodStats) return false;
  const { aboveFoldFetched } = resolveBundleSliceFlags(bundle);
  return aboveFoldFetched;
}

/**
 * Sprint 8.1 — authoritative period stats fetch.
 * Analytics page uses scope=aboveFold; legacy callers may still request scope=full.
 */
export async function fetchBusinessPeriodStats(
  timeframe: AnalyticsTimeframe,
  opts?: FetchBusinessAnalyticsOptions,
): Promise<BusinessDashboardStats> {
  if (!opts?.revalidate) {
    const cached = getBusinessAnalyticsBundle(timeframe);
    if (cached?.periodStats && bundleHasAboveFoldStats(cached.periodStats)) {
      trackAnalyticsCacheHit();
      return cached.periodStats;
    }
  }

  trackAnalyticsCacheMiss();
  trackAnalyticsRefetch();

  const scope: BusinessStatsScope = opts?.scope ?? "aboveFold";
  const periodStats = await getBusinessStats(timeframe, {
    scope,
    signal: opts?.signal,
    silent: opts?.silent,
    revalidate: opts?.revalidate,
  });

  upsertBusinessAnalyticsStatsBundle(timeframe, periodStats);
  return periodStats;
}

/**
 * Sprint 3B — unified fetch for business analytics.
 * Summary-first: aboveFold → render KPIs, then deferred scope=analytics for lower sections.
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
  const includeDeferredAnalytics = opts?.includeDeferredAnalytics !== false;
  const feedParams = tipsFeedParamsForTimeframe(timeframe);

  const cachedFlags = cached ? resolveBundleSliceFlags(cached) : null;

  const needsAboveFold =
    !cachedFlags?.aboveFoldFetched || !cached?.periodStats || Boolean(opts?.revalidate);
  const needsDeferred =
    includeDeferredAnalytics &&
    (!cachedFlags?.deferredAnalyticsFetched || Boolean(opts?.revalidate));
  const needsWeekStats =
    includeWeekStats && (!cached?.weekStats || Boolean(opts?.revalidate));
  const needsTipsFeed =
    includeTipsFeed && (!cached?.tipsFeedFetched || Boolean(opts?.revalidate));
  const needsQrAnalytics =
    includeQrAnalytics && (!cached?.qrFetched || Boolean(opts?.revalidate));

  if (
    cached &&
    !needsAboveFold &&
    !needsDeferred &&
    !needsWeekStats &&
    !needsTipsFeed &&
    !needsQrAnalytics
  ) {
    trackAnalyticsCacheHit();
    return cached;
  }

  trackAnalyticsCacheMiss();
  if (needsAboveFold || needsDeferred || needsWeekStats || needsTipsFeed || needsQrAnalytics) {
    trackAnalyticsRefetch();
  }

  type MutableBundle = {
    timeframe: AnalyticsTimeframe;
    periodStats?: BusinessDashboardStats;
    weekStats?: BusinessDashboardStats;
    recentTips: BusinessAnalyticsBundle["recentTips"];
    qrAnalytics: BusinessAnalyticsBundle["qrAnalytics"];
    tipsFeedFetched: boolean;
    qrFetched: boolean;
    aboveFoldFetched: boolean;
    deferredAnalyticsFetched: boolean;
    fetchedAt: number;
  };

  const mutable: MutableBundle = {
    timeframe,
    periodStats: cached?.periodStats,
    weekStats: cached?.weekStats,
    recentTips: cached?.recentTips ?? [],
    qrAnalytics: cached?.qrAnalytics ?? null,
    tipsFeedFetched: cached?.tipsFeedFetched ?? false,
    qrFetched: cached?.qrFetched ?? false,
    aboveFoldFetched: cachedFlags?.aboveFoldFetched ?? false,
    deferredAnalyticsFetched: cachedFlags?.deferredAnalyticsFetched ?? false,
    fetchedAt: cached?.fetchedAt ?? 0,
  };

  const publish = () => {
    if (!mutable.periodStats || !mutable.aboveFoldFetched) return;
    const bundle: BusinessAnalyticsBundle = {
      timeframe: mutable.timeframe,
      periodStats: mutable.periodStats,
      weekStats: mutable.weekStats ?? mutable.periodStats,
      recentTips: mutable.recentTips,
      qrAnalytics: mutable.qrAnalytics ?? null,
      tipsFeedFetched: mutable.tipsFeedFetched,
      qrFetched: mutable.qrFetched,
      aboveFoldFetched: mutable.aboveFoldFetched,
      deferredAnalyticsFetched: mutable.deferredAnalyticsFetched,
      fetchedAt: mutable.fetchedAt,
    };
    setBusinessAnalyticsBundle(timeframe, bundle);
    opts?.onProgress?.(bundle);
  };

  const tasks: Promise<void>[] = [];

  let aboveFoldPromise: Promise<void> = Promise.resolve();

  if (needsAboveFold) {
    aboveFoldPromise = (async () => {
      markAnalyticsPerformance("analytics.summary.request");
      markAnalyticsPerformance("analytics.stats.request");
      const aboveFoldStats = await getBusinessStats(timeframe, {
        scope: "aboveFold",
        signal: opts?.signal,
        silent: opts?.silent,
        revalidate: opts?.revalidate,
      });
      mutable.periodStats = aboveFoldStats;
      if (!mutable.weekStats) mutable.weekStats = aboveFoldStats;
      mutable.aboveFoldFetched = true;
      mutable.fetchedAt = Date.now();
      markAnalyticsPerformance("analytics.summary.ready");
      markAnalyticsPerformance("analytics.stats.ready");
      publish();
    })();
    tasks.push(aboveFoldPromise);
  } else if (mutable.periodStats) {
    mutable.aboveFoldFetched = true;
  }

  if (needsDeferred) {
    tasks.push(
      aboveFoldPromise.then(async () => {
        markAnalyticsPerformance("analytics.deferred.request");
        const deferredStats = await getBusinessStats(timeframe, {
          scope: "analytics",
          signal: opts?.signal,
          silent: opts?.silent,
          revalidate: opts?.revalidate,
        });
        mutable.periodStats = mergeBusinessDashboardStats(mutable.periodStats, deferredStats)!;
        mutable.deferredAnalyticsFetched = true;
        mutable.fetchedAt = Date.now();
        markAnalyticsPerformance("analytics.deferred.ready");
        publish();
      }),
    );
  }

  if (needsWeekStats) {
    tasks.push(
      getBusinessStats("week", {
        scope: "summary",
        signal: opts?.signal,
        silent: opts?.silent,
        revalidate: opts?.revalidate,
      }).then((weekStats) => {
        mutable.weekStats = weekStats;
        if (mutable.periodStats && mutable.aboveFoldFetched) {
          mutable.fetchedAt = Date.now();
          publish();
        }
      }),
    );
  }

  if (needsTipsFeed) {
    tasks.push(
      listBusinessTips({
        ...feedParams,
        skip: 0,
        status: "success",
      }).then((feed) => {
        mutable.recentTips = feed.items;
        mutable.tipsFeedFetched = true;
        if (mutable.periodStats && mutable.aboveFoldFetched) {
          mutable.fetchedAt = Date.now();
          publish();
        }
      }),
    );
  }

  if (needsQrAnalytics) {
    tasks.push(
      getBusinessQrAnalytics(timeframe, { signal: opts?.signal, silent: opts?.silent })
        .catch(() => null)
        .then((qrAnalytics) => {
          mutable.qrAnalytics = qrAnalytics;
          mutable.qrFetched = true;
          if (mutable.periodStats && mutable.aboveFoldFetched) {
            mutable.fetchedAt = Date.now();
            publish();
          }
        }),
    );
  }

  await Promise.all(tasks);

  if (!mutable.periodStats || !mutable.aboveFoldFetched) {
    throw new Error("fetchBusinessAnalyticsBundle: above-fold period stats unavailable");
  }

  const bundle: BusinessAnalyticsBundle = {
    timeframe,
    periodStats: mutable.periodStats,
    weekStats: mutable.weekStats ?? mutable.periodStats,
    recentTips: mutable.recentTips,
    qrAnalytics: mutable.qrAnalytics ?? null,
    tipsFeedFetched: mutable.tipsFeedFetched,
    qrFetched: mutable.qrFetched,
    aboveFoldFetched: mutable.aboveFoldFetched,
    deferredAnalyticsFetched: mutable.deferredAnalyticsFetched,
    fetchedAt: mutable.fetchedAt || Date.now(),
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
    priorPeriod: bundle.periodStats.priorPeriod ?? null,
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
