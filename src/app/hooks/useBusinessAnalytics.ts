import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { logClientError } from "../lib/clientLog";

import {

  buildBusinessAnalyticsDTO,

  fetchBusinessAnalyticsBundle,

  getBusinessAnalyticsBundle,

  invalidateBusinessAnalytics,

  isBusinessAnalyticsAboveFoldComplete,

  isBusinessAnalyticsBundleComplete,

  subscribeBusinessAnalyticsRefresh,

  type AnalyticsTimeframe,

  type BusinessAnalyticsDTO,

  EMPTY_PERIOD_SNAPSHOT,

} from "../lib/businessAnalytics";

import { useSocket, useDeferSocketConnect } from "./useSocket";

import { useRealtimeFallback } from "./useRealtimeFallback";

import { useRealtimeReconnect } from "../lib/realtime/useRealtimeReconnect";

import {

  patchLiveTipAcrossTimeframes,

  subscribeAnalyticsPatch,

} from "../lib/realtime/patchAnalyticsLive";

import { subscribeTipReceived } from "../lib/realtime/subscribeTipReceived";
import type { LiveNewTipPayload } from "../lib/realtime/realtimeContracts";
import { REALTIME_EVENTS } from "../lib/realtime/realtimeContracts";

import { shouldProcessRealtimeEvent, tipRealtimeDedupeId } from "../lib/realtime/realtimeEventDedupe";

import { trackAnalyticsRefetch, trackSocketEventProcessed } from "../lib/realtime/realtimeMetrics";

import {
  deriveAnalyticsLoadingLifecycle,
  derivePeriodScopedSectionLoading,
  hasVisiblePeriodStats as dtoHasVisiblePeriodStats,
} from "../lib/analyticsLoadingLifecycle";
import type { BusinessAnalyticsBundle } from "../lib/businessAnalytics";
import { markAnalyticsPerformance } from "../lib/businessAnalytics/analyticsPerformanceMarks";



export type { AnalyticsTimeframe } from "../lib/businessAnalytics";



export type UseBusinessAnalyticsOptions = {

  timeframe?: AnalyticsTimeframe;

  advancedAnalytics?: boolean;

  includeIntelligence?: boolean;

  includeTipsFeed?: boolean;

  includeWeekStats?: boolean;

  includeQrAnalytics?: boolean;

};



const EMPTY_DTO: BusinessAnalyticsDTO = {

  timeframe: "month",

  stats: {} as BusinessAnalyticsDTO["stats"],

  period: EMPTY_PERIOD_SNAPSHOT,

  week: EMPTY_PERIOD_SNAPSHOT,

  today: EMPTY_PERIOD_SNAPSHOT,

  pulse: null,

  recentTips: [],

  employees: [],

  employeeGoals: [],

  dailyTipDistribution: [],

  input: {

    period: EMPTY_PERIOD_SNAPSHOT,

    week: EMPTY_PERIOD_SNAPSHOT,

    today: EMPTY_PERIOD_SNAPSHOT,

    dailyTipDistribution: [],

    recentTips: [],

    employees: [],

    employeeGoals: [],

    pulse: null,
    qrAnalytics: null,
    locationRankings: [],
    tableRankings: [],
    growthPercent: null,
    priorPeriod: null,
    peakHour: null,
    bestShift: null,
    avgTipsPerShift: null,
    completedShifts: null,
  },

  intelligence: {

    revenue: {

      totalTips: 0,

      tipCount: 0,

      growthPercent: 0,
      growthComparable: false,

      averageTip: 0,

      dailyRevenue: 0,

      weeklyRevenue: 0,

      periodRevenue: 0,

    },

    insights: {

      bestDay: "—",

      bestDayAmount: 0,

      bestShift: "—",

      bestLocation: "—",

      bestTable: "—",

      peakPeriod: "—",

    },

    operational: {

      activeEmployees: 0,

      employeesReceivingTips: 0,

      averageTipsPerEmployee: 0,

      averageTipsPerShift: null,

    },

    trends: { tipsOverTime: [], revenueTrend: [], participationTrend: [] },

    health: {

      score: 0,

      grade: "needs_attention",

      components: {

        revenueGrowth: 0,

        employeeParticipation: 0,

        goalCompletion: 0,

        activeEmployees: 0,

        guestFeedback: 0,

        tipActivity: 0,

      },

    },

    executiveInsights: [],

    opportunities: [],

    risks: [],

    recommendations: [],

    executiveSummary: {
      messageKey: "business.team.performance.executive.summary.collectingData",
      clauses: [{ key: "business.team.performance.executive.summary.collectingData" }],
    },

    snapshot: {

      healthScore: 0,

      growthRate: 0,

      employeeParticipation: 0,

      goalCompletion: 0,

      guestSatisfaction: 0,

      activeLocations: 0,

      periodTipCount: 0,

    },

    locations: [],

    tables: [],

    topTipSources: [],

  },

  fetchedAt: 0,

};



const RECONCILE_DEBOUNCE_MS = 800;



/**

 * Sprint 3C + Sprint 5B — analytics with socket patch-first, debounced API reconcile.

 */

export function useBusinessAnalytics(

  enabled: boolean,

  options: UseBusinessAnalyticsOptions = {},

) {

  const {

    timeframe: controlledTimeframe,

    advancedAnalytics = true,

    includeIntelligence = true,

    includeTipsFeed = true,

    includeWeekStats = true,

    includeQrAnalytics = true,

  } = options;



  const [internalTimeframe, setInternalTimeframe] = useState<AnalyticsTimeframe>("month");

  const timeframe = controlledTimeframe ?? internalTimeframe;

  const [loading, setLoading] = useState(true);

  const [timeframeLoading, setTimeframeLoading] = useState(false);

  const [dto, setDto] = useState<BusinessAnalyticsDTO | null>(null);

  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const [periodStatsReady, setPeriodStatsReady] = useState(false);

  const [deferredAnalyticsReady, setDeferredAnalyticsReady] = useState(false);

  const [tipsFeedReady, setTipsFeedReady] = useState(false);

  const [qrReady, setQrReady] = useState(false);



  const timeframeRef = useRef(timeframe);

  timeframeRef.current = timeframe;

  const isFirstLoad = useRef(true);

  const loadGenRef = useRef(0);

  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);



  const applyBundle = useCallback((next: BusinessAnalyticsDTO) => {

    setDto(next);

    setLastUpdatedAt(next.fetchedAt);

  }, []);

  const applyProgressBundle = useCallback(
    (bundle: BusinessAnalyticsBundle) => {
      if (bundle.timeframe !== timeframeRef.current) return;
      applyBundle(buildBusinessAnalyticsDTO(bundle));
      const aboveFoldOk = isBusinessAnalyticsAboveFoldComplete(bundle);
      const deferredOk = Boolean(bundle.deferredAnalyticsFetched) || Boolean(
        bundle.periodStats?.dailyTipDistribution?.length ||
          bundle.periodStats?.locationRankings?.length ||
          bundle.periodStats?.avgTipsPerShift != null,
      );
      if (aboveFoldOk) markAnalyticsPerformance("analytics.stats.ready");
      if (bundle.tipsFeedFetched) markAnalyticsPerformance("analytics.tipsFeed.ready");
      if (bundle.qrFetched) markAnalyticsPerformance("analytics.qr.ready");
      setPeriodStatsReady(aboveFoldOk);
      setDeferredAnalyticsReady(deferredOk);
      setTipsFeedReady(Boolean(bundle.tipsFeedFetched));
      setQrReady(Boolean(bundle.qrFetched));
    },
    [applyBundle],
  );

  const syncReadyFlagsFromCache = useCallback(
    (tf: AnalyticsTimeframe) => {
      const cached = getBusinessAnalyticsBundle(tf);
      const wantsTipsFeed = includeTipsFeed && advancedAnalytics;
      setPeriodStatsReady(isBusinessAnalyticsAboveFoldComplete(cached));
      setDeferredAnalyticsReady(
        Boolean(cached?.deferredAnalyticsFetched) ||
          Boolean(
            cached?.periodStats?.dailyTipDistribution?.length ||
              cached?.periodStats?.locationRankings?.length ||
              cached?.periodStats?.avgTipsPerShift != null,
          ),
      );
      setTipsFeedReady(!wantsTipsFeed || Boolean(cached?.tipsFeedFetched));
      setQrReady(!includeQrAnalytics || Boolean(cached?.qrFetched));
    },
    [advancedAnalytics, includeTipsFeed, includeQrAnalytics],
  );



  const load = useCallback(

    async (opts?: { quiet?: boolean; periodSwitch?: boolean; revalidate?: boolean }) => {

      if (!enabled) return;

      const tf = timeframeRef.current;
      const gen = ++loadGenRef.current;
      const stillCurrent = () => gen === loadGenRef.current && tf === timeframeRef.current;

      const fetchOpts = {
        includeTipsFeed: includeTipsFeed && advancedAnalytics,
        includeWeekStats,
        includeQrAnalytics,
      };



      if (!opts?.revalidate) {

        const cached = getBusinessAnalyticsBundle(tf);

        if (cached && isBusinessAnalyticsBundleComplete(cached, fetchOpts)) {

          if (!stillCurrent()) return;

          applyProgressBundle(cached);

          if (!opts?.quiet) setLoading(false);

          if (opts?.periodSwitch) setTimeframeLoading(false);

          return;

        }

      }



      if (opts?.periodSwitch) {

        setTimeframeLoading(true);

        syncReadyFlagsFromCache(tf);

      } else if (!opts?.quiet) {

        setLoading(true);

        syncReadyFlagsFromCache(tf);

      }



      try {

        trackAnalyticsRefetch();
        markAnalyticsPerformance("analytics.stats.request");

        const bundle = await fetchBusinessAnalyticsBundle(tf, {

          silent: opts?.quiet,

          revalidate: opts?.revalidate,

          ...fetchOpts,

          onProgress: (partial) => {

            if (!stillCurrent() || partial.timeframe !== tf) return;

            applyProgressBundle(partial);

            if (!opts?.quiet && isBusinessAnalyticsAboveFoldComplete(partial)) setLoading(false);

          },

        });

        if (!stillCurrent() || bundle.timeframe !== tf) return;

        applyProgressBundle(bundle);

      } catch (err) {

        logClientError("useBusinessAnalytics", err);

      } finally {

        if (stillCurrent()) {

          if (opts?.periodSwitch) setTimeframeLoading(false);

          else if (!opts?.quiet) setLoading(false);

        }

      }

    },

    [
      enabled,
      advancedAnalytics,
      includeTipsFeed,
      includeWeekStats,
      includeQrAnalytics,
      applyProgressBundle,
      syncReadyFlagsFromCache,
    ],

  );



  const loadRef = useRef(load);

  loadRef.current = load;



  const scheduleReconcile = useCallback(() => {

    if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);

    reconcileTimerRef.current = setTimeout(() => {

      reconcileTimerRef.current = null;

      invalidateBusinessAnalytics("all");

    }, RECONCILE_DEBOUNCE_MS);

  }, []);



  useLayoutEffect(() => {
    if (!enabled) return;
    loadGenRef.current += 1;
    const tf = timeframe;
    const fetchOpts = {
      includeTipsFeed: includeTipsFeed && advancedAnalytics,
      includeWeekStats,
      includeQrAnalytics,
    };
    const cached = getBusinessAnalyticsBundle(tf);
    if (cached && cached.timeframe === tf && isBusinessAnalyticsAboveFoldComplete(cached)) {
      applyProgressBundle(cached);
      if (isBusinessAnalyticsBundleComplete(cached, fetchOpts)) {
        setTimeframeLoading(false);
        setLoading(false);
        return;
      }
    }
    setTimeframeLoading(true);
    syncReadyFlagsFromCache(tf);
  }, [
    timeframe,
    enabled,
    advancedAnalytics,
    includeTipsFeed,
    includeWeekStats,
    includeQrAnalytics,
    applyProgressBundle,
    syncReadyFlagsFromCache,
  ]);

  useEffect(() => {

    if (!enabled) return;

    const tf = timeframeRef.current;

    const fetchOpts = {

      includeTipsFeed: includeTipsFeed && advancedAnalytics,

      includeWeekStats,

      includeQrAnalytics,

    };

    const cached = getBusinessAnalyticsBundle(tf);

    if (cached && isBusinessAnalyticsBundleComplete(cached, fetchOpts)) {

      applyProgressBundle(cached);

      setLoading(false);

      setTimeframeLoading(false);

      return;

    }

    syncReadyFlagsFromCache(tf);

    if (isFirstLoad.current) {

      isFirstLoad.current = false;

      void load();

      return;

    }

    void load({ quiet: true, periodSwitch: true });

  }, [
    load,
    timeframe,
    enabled,
    advancedAnalytics,
    includeTipsFeed,
    includeWeekStats,
    includeQrAnalytics,
    applyProgressBundle,
    syncReadyFlagsFromCache,
  ]);



  const refreshQuiet = useCallback(() => {

    invalidateBusinessAnalytics(timeframeRef.current);

  }, []);



  const socketReady = useDeferSocketConnect(enabled);

  const { socket, connected, connectionStatus } = useSocket(socketReady);



  useRealtimeFallback(connected, refreshQuiet);

  useRealtimeReconnect(() => {

    invalidateBusinessAnalytics("all");

  }, enabled);



  useEffect(() => {

    if (!enabled) return;

    return subscribeAnalyticsPatch((patched) => {

      if (patched.timeframe === timeframeRef.current) {

        applyBundle(patched);

      }

    });

  }, [enabled, applyBundle]);



  useEffect(() => {

    if (!socket || !enabled) return;



    const onTip = (payload: LiveNewTipPayload, eventId?: string) => {

      if (!shouldProcessRealtimeEvent(tipRealtimeDedupeId(payload, eventId), "business-analytics-tips")) return;

      trackSocketEventProcessed();

      patchLiveTipAcrossTimeframes(payload, payload.employeeName);

      const cached = getBusinessAnalyticsBundle(timeframeRef.current);

      if (cached) applyBundle(buildBusinessAnalyticsDTO(cached));

      scheduleReconcile();

    };



    const onBusinessData = () => {

      invalidateBusinessAnalytics("all");

    };

    const onQrScanned = (raw: { eventId?: string }) => {
      if (!shouldProcessRealtimeEvent(raw.eventId, "business-analytics-qr")) return;
      trackSocketEventProcessed();
      scheduleReconcile();
    };

    const unsubTip = subscribeTipReceived(socket, onTip);

    socket.on("business_data_updated", onBusinessData);
    socket.on(REALTIME_EVENTS.QR_SCANNED, onQrScanned);



    return () => {

      unsubTip();

      socket.off("business_data_updated", onBusinessData);
      socket.off(REALTIME_EVENTS.QR_SCANNED, onQrScanned);

    };

  }, [socket, enabled, scheduleReconcile, applyBundle]);



  useEffect(() => {

    if (!enabled) return;

    return subscribeBusinessAnalyticsRefresh(() => {

      void loadRef.current({ quiet: true, revalidate: true });

    });

  }, [enabled]);



  useEffect(

    () => () => {

      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);

    },

    [],

  );



  const setTimeframe = useCallback((tf: AnalyticsTimeframe) => {

    if (!controlledTimeframe) setInternalTimeframe(tf);

  }, [controlledTimeframe]);



  const resolved = dto ?? EMPTY_DTO;

  const visiblePeriodStats = dtoHasVisiblePeriodStats(dto);

  const valuesMatchPeriod = dto?.timeframe === timeframe;

  const wantsTipsFeed = includeTipsFeed && advancedAnalytics;

  const bundleFetchInFlight = loading || timeframeLoading;

  const isPeriodStatsLoading = derivePeriodScopedSectionLoading({
    valuesMatchPeriod,
    sliceReady: periodStatsReady,
    fetchInFlight: bundleFetchInFlight,
  });

  const isDeferredAnalyticsLoading = derivePeriodScopedSectionLoading({
    valuesMatchPeriod,
    sliceReady: deferredAnalyticsReady,
    fetchInFlight: bundleFetchInFlight,
  });

  const isTipsFeedLoading = wantsTipsFeed
    ? derivePeriodScopedSectionLoading({
        valuesMatchPeriod,
        sliceReady: tipsFeedReady,
        fetchInFlight: bundleFetchInFlight,
      })
    : false;

  const isQrLoading = includeQrAnalytics
    ? derivePeriodScopedSectionLoading({
        valuesMatchPeriod,
        sliceReady: qrReady,
        fetchInFlight: bundleFetchInFlight,
      })
    : false;

  const { isInitialAnalyticsLoading, isAnalyticsRefreshing } = deriveAnalyticsLoadingLifecycle({

    hasVisibleAnalyticsData: visiblePeriodStats,

    isColdLoading: loading,

    isTimeframeLoading: timeframeLoading,

    valuesMatchPeriod,

  });

  const bi = useMemo(

    () => (includeIntelligence ? resolved.intelligence : EMPTY_DTO.intelligence),

    [includeIntelligence, resolved.intelligence],

  );



  return {

    loading,

    timeframeLoading,

    hasVisibleAnalyticsData: visiblePeriodStats,

    isPeriodStatsLoading,

    isDeferredAnalyticsLoading,

    isTipsFeedLoading,

    isQrLoading,

    isInitialAnalyticsLoading,

    isAnalyticsRefreshing,

    valuesMatchPeriod,

    displayTimeframe: dto?.timeframe ?? timeframe,

    timeframe,

    setTimeframe,

    lastUpdatedAt,

    stats: resolved.stats,

    period: resolved.period,

    week: resolved.week,

    today: resolved.today,

    pulse: resolved.pulse,

    recentTips: resolved.recentTips,

    employees: resolved.employees,

    employeeGoals: resolved.employeeGoals,

    dailyTipDistribution: resolved.dailyTipDistribution,

    input: resolved.input,

    intelligence: bi,

    bi,

    refresh: refreshQuiet,

    connected,

    connectionStatus,

  };

}


