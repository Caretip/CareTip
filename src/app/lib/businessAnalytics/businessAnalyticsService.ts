import { bundleHasAboveFoldStats, bundleHasDeferredStats } from "./bundleStatsSlices";
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
  BusinessAnalyticsSlice,
  BusinessAnalyticsDTO,
  FetchBusinessAnalyticsOptions,
} from "./types";
import type { BusinessDashboardStats } from "../api";
import { trackAnalyticsCacheHit, trackAnalyticsCacheMiss, trackAnalyticsRefetch } from "../realtime/realtimeMetrics";
import { markAnalyticsPerformance } from "./analyticsPerformanceMarks";
import { getOrCreateInFlightRequest } from "../getOrCreateInFlightRequest";

function businessAnalyticsBundleInflightKey(
  timeframe: AnalyticsTimeframe,
  opts?: FetchBusinessAnalyticsOptions,
): string {
  const tips = opts?.includeTipsFeed !== false ? "1" : "0";
  const week = opts?.includeWeekStats !== false ? "1" : "0";
  const qr = opts?.includeQrAnalytics !== false ? "1" : "0";
  const deferred = opts?.includeDeferredAnalytics !== false ? "1" : "0";
  const revalidate = opts?.revalidate ? "1" : "0";
  return `me:biz-analytics-bundle:${timeframe}:${tips}:${week}:${qr}:${deferred}:${revalidate}`;
}

export { bundleHasAboveFoldStats, bundleHasDeferredStats } from "./bundleStatsSlices";

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

  const inflightKey = businessAnalyticsBundleInflightKey(timeframe, opts);
  return getOrCreateInFlightRequest(inflightKey, () =>
    loadBusinessAnalyticsBundleNetwork(timeframe, opts, cached),
  );
}

async function loadBusinessAnalyticsBundleNetwork(
  timeframe: AnalyticsTimeframe,
  opts: FetchBusinessAnalyticsOptions | undefined,
  cachedSeed: BusinessAnalyticsBundle | null,
): Promise<BusinessAnalyticsBundle> {
  const cached = !opts?.revalidate
    ? getBusinessAnalyticsBundle(timeframe) ?? cachedSeed
    : cachedSeed;
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

  const tasks: Array<{ slice: BusinessAnalyticsSlice; run: Promise<void> }> = [];

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
    tasks.push({ slice: "aboveFold", run: aboveFoldPromise });
  } else if (mutable.periodStats) {
    mutable.aboveFoldFetched = true;
  }

  if (needsDeferred) {
    // Requested alongside the KPIs, merged after them so the KPI values always win.
    markAnalyticsPerformance("analytics.deferred.request");
    const deferredRequest = getBusinessStats(timeframe, {
      scope: "analytics",
      signal: opts?.signal,
      silent: opts?.silent,
      revalidate: opts?.revalidate,
    });
    // Awaited in the task below, which is skipped when the KPI request fails first.
    deferredRequest.catch(() => {});
    tasks.push({
      slice: "deferred",
      run: aboveFoldPromise.then(async () => {
        const deferredStats = await deferredRequest;
        mutable.periodStats = mergeBusinessDashboardStats(mutable.periodStats, deferredStats)!;
        mutable.deferredAnalyticsFetched = true;
        mutable.fetchedAt = Date.now();
        markAnalyticsPerformance("analytics.deferred.ready");
        publish();
      }),
    });
  }

  if (needsWeekStats) {
    tasks.push({
      slice: "weekStats",
      run: getBusinessStats("week", {
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
    });
  }

  if (needsTipsFeed) {
    tasks.push({
      slice: "tipsFeed",
      run: listBusinessTips({
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
    });
  }

  if (needsQrAnalytics) {
    tasks.push({
      slice: "qr",
      run: getBusinessQrAnalytics(timeframe, { signal: opts?.signal, silent: opts?.silent }).then(
        (qrAnalytics) => {
          mutable.qrAnalytics = qrAnalytics;
          mutable.qrFetched = true;
          if (mutable.periodStats && mutable.aboveFoldFetched) {
            mutable.fetchedAt = Date.now();
            publish();
          }
        },
      ),
    });
  }

  // Slices settle independently: what loaded stays on screen and the rest is reported as failed.
  const outcomes = await Promise.allSettled(tasks.map((task) => task.run));
  const failedSlices: BusinessAnalyticsSlice[] = [];
  let firstFailure: unknown;
  outcomes.forEach((outcome, index) => {
    if (outcome.status !== "rejected") return;
    if (failedSlices.length === 0) firstFailure = outcome.reason;
    failedSlices.push(tasks[index]!.slice);
  });

  if (!mutable.periodStats || !mutable.aboveFoldFetched) {
    throw firstFailure ?? new Error("fetchBusinessAnalyticsBundle: above-fold period stats unavailable");
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
  return failedSlices.length ? { ...bundle, failedSlices, firstFailure } : bundle;
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
