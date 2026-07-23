import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { logClientError } from "../lib/clientLog";

import {

  buildBusinessAnalyticsDTO,

  fetchBusinessAnalyticsBundle,

  getBusinessAnalyticsBundle,

  invalidateBusinessAnalytics,

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

import { shouldProcessRealtimeEvent } from "../lib/realtime/realtimeEventDedupe";

import { trackAnalyticsRefetch, trackSocketEventProcessed } from "../lib/realtime/realtimeMetrics";

import {
  deriveAnalyticsLoadingLifecycle,
  hasVisibleAnalyticsData as dtoHasVisibleAnalyticsData,
} from "../lib/analyticsLoadingLifecycle";



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



  const timeframeRef = useRef(timeframe);

  timeframeRef.current = timeframe;

  const isFirstLoad = useRef(true);

  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);



  const applyBundle = useCallback((next: BusinessAnalyticsDTO) => {

    setDto(next);

    setLastUpdatedAt(next.fetchedAt);

  }, []);



  const load = useCallback(

    async (opts?: { quiet?: boolean; periodSwitch?: boolean; revalidate?: boolean }) => {

      if (!enabled) return;

      const tf = timeframeRef.current;

      const fetchOpts = {
        includeTipsFeed: includeTipsFeed && advancedAnalytics,
        includeWeekStats,
        includeQrAnalytics,
      };



      if (!opts?.revalidate) {

        const cached = getBusinessAnalyticsBundle(tf);

        if (cached && isBusinessAnalyticsBundleComplete(cached, fetchOpts)) {

          applyBundle(buildBusinessAnalyticsDTO(cached));

          if (!opts?.quiet) setLoading(false);

          if (opts?.periodSwitch) setTimeframeLoading(false);

          return;

        }

      }



      if (opts?.periodSwitch) {

        setTimeframeLoading(true);

      } else if (!opts?.quiet) {

        setLoading(true);

      }



      try {

        trackAnalyticsRefetch();

        const bundle = await fetchBusinessAnalyticsBundle(tf, {

          silent: opts?.quiet,

          revalidate: opts?.revalidate,

          ...fetchOpts,

        });

        if (tf !== timeframeRef.current) return;

        applyBundle(buildBusinessAnalyticsDTO(bundle));

      } catch (err) {

        logClientError("useBusinessAnalytics", err);

      } finally {

        if (tf === timeframeRef.current) {

          if (opts?.periodSwitch) setTimeframeLoading(false);

          else if (!opts?.quiet) setLoading(false);

        }

      }

    },

    [enabled, advancedAnalytics, includeTipsFeed, includeWeekStats, includeQrAnalytics, applyBundle],

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

      applyBundle(buildBusinessAnalyticsDTO(cached));

      setLoading(false);

      setTimeframeLoading(false);

      return;

    }

    if (isFirstLoad.current) {

      isFirstLoad.current = false;

      void load();

      return;

    }

    void load({ quiet: true, periodSwitch: true });

  }, [load, timeframe, enabled, advancedAnalytics, includeTipsFeed, includeWeekStats, includeQrAnalytics, applyBundle]);



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

      if (!shouldProcessRealtimeEvent(eventId)) return;

      trackSocketEventProcessed();

      patchLiveTipAcrossTimeframes(payload, payload.employeeName);

      const cached = getBusinessAnalyticsBundle(timeframeRef.current);

      if (cached) applyBundle(buildBusinessAnalyticsDTO(cached));

      scheduleReconcile();

    };



    const onBusinessData = () => {

      invalidateBusinessAnalytics("all");

    };



    const unsubTip = subscribeTipReceived(socket, onTip);

    socket.on("business_data_updated", onBusinessData);



    return () => {

      unsubTip();

      socket.off("business_data_updated", onBusinessData);

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

  const visibleAnalyticsData = dtoHasVisibleAnalyticsData(dto);

  const valuesMatchPeriod = dto?.timeframe === timeframe;

  const { isInitialAnalyticsLoading, isAnalyticsRefreshing } = deriveAnalyticsLoadingLifecycle({

    hasVisibleAnalyticsData: visibleAnalyticsData,

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

    hasVisibleAnalyticsData: visibleAnalyticsData,

    isInitialAnalyticsLoading,

    isAnalyticsRefreshing,

    valuesMatchPeriod,

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


