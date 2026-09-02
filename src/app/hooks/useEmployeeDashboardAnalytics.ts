import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearEmployeeTipsClientCache,
  getTipsByEmployee,
  mergeEmployeeTipsResponse,
  type EmployeeTipsResponse,
  type EmployeeGoalProgress,
  type TipItem,
} from "../lib/api";
import { DASHBOARD_SWR_METRICS_TTL_MS } from "../lib/dashboardSwrCache";
import {
  clearEmployeePeriodSwrStore,
  deleteEmployeePeriodSnapshot,
  getEmployeePeriodLastTimeframe,
  getEmployeePeriodSnapshot,
  isEmployeePeriodLiveSettled,
  markEmployeePeriodLiveSettled,
  peekEmployeePeriodSnapshot,
  setEmployeePeriodLastTimeframe,
  writeEmployeePeriodSnapshot,
  type EmployeePeriodSwrEntry,
  type EmployeePeriodTimeframe,
} from "../lib/employeePeriodSessionCache";
import {
  canUsePeriodSwitchCache,
  deriveDashboardMetricLoading,
  markDashboardLiveSettled,
} from "../lib/dashboardHydration";
import { isAbortError, isApiConnectivityError, toUserFriendlyMessage } from "../lib/errorMessages";
import { logClientError } from "../lib/clientLog";
import {
  recordNewEmployeeTip,
  syncEmployeeNotificationTips,
} from "../lib/employeeNotificationStore";
import { resolveEmployeeTipsWithDevPreview } from "../lib/devAnalyticsMocks";
import { getAuthUser } from "../lib/authUserStore";
import { isWalkthroughDemoEmployee } from "../lib/walkthroughDemo";
import { devSetHydrationPhase } from "../lib/dashboardDevDebug";
import { primeEmployeeAccountSnapshot } from "./useEmployeeAccountSummary";
import {
  hasEmployeeAnalyticsPayload,
  hasEmployeeChartOrTipsContent,
  hasEmployeePayloadVisibleContent,
  hasEmployeePeriodActivity,
  isEmployeeSummaryFetched,
} from "../lib/dashboardVisibleContent";
import { shouldRefetchOnAnalyticsCapabilityUpgrade } from "../lib/dashboardAnalyticsLifecycle";

export type EmployeeAnalyticsTimeframe = EmployeePeriodTimeframe;

type LiveNewTipPayload = {
  tip: TipItem;
  employeeId: string;
  currentMonthTotal: number;
  monthlyGoal: number | null;
};

type AnalyticsPayload = {
  tips: TipItem[];
  monthlyGoal: number | null;
  currentMonthTotal: number;
  goalProgress: EmployeeGoalProgress | null;
  businessTimezone: string | null;
  periodTipCount: number;
  periodAmountEur: number;
  averageRating: number | null;
  ratingCount: number;
  chartSeries: Array<{ label: string; amount: number }>;
  totalEarningsEur?: number;
  availableBalanceEur?: number;
  paidOutEur?: number;
  totalSupporters?: number;
};

function logEmployeePeriodPayload(
  timeframe: EmployeeAnalyticsTimeframe,
  payload: AnalyticsPayload,
  source: "cache" | "network",
): void {
  if (!import.meta.env.DEV) return;
  console.info(`[employee.analytics:${timeframe}]`, source, {
    periodAmountEur: payload.periodAmountEur,
    periodTipCount: payload.periodTipCount,
    averageRating: payload.averageRating,
    ratingCount: payload.ratingCount,
    monthlyGoal: payload.monthlyGoal,
    currentMonthTotal: payload.currentMonthTotal,
    goalProgress: payload.goalProgress,
    chartPoints: payload.chartSeries?.length ?? 0,
    tips: payload.tips?.length ?? 0,
  });
}

/** DEV-only period hydration trace — see EMPLOYEE_PERIOD_ANALYTICS_HYDRATION_AUDIT.md §8 */
function debugEmployeeAnalytics(
  event: string,
  detail: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  console.debug("[EmployeeAnalytics]", event, detail);
}

function employeePeriodTimerKey(
  tf: EmployeeAnalyticsTimeframe,
  phase: "summary-fetch" | "analytics-fetch" | "first-kpi-render",
): string {
  return `employee-${tf}-${phase}`;
}

function startEmployeePeriodTimer(
  tf: EmployeeAnalyticsTimeframe,
  phase: "summary-fetch" | "analytics-fetch" | "first-kpi-render",
): void {
  if (!import.meta.env.DEV) return;
  console.time(employeePeriodTimerKey(tf, phase));
}

function endEmployeePeriodTimer(
  tf: EmployeeAnalyticsTimeframe,
  phase: "summary-fetch" | "analytics-fetch" | "first-kpi-render",
): void {
  if (!import.meta.env.DEV) return;
  try {
    console.timeEnd(employeePeriodTimerKey(tf, phase));
  } catch {
    // ignore missing timer
  }
}

type EmployeeSwrEntry = {
  summary: Partial<EmployeeTipsResponse>;
  analytics: Partial<EmployeeTipsResponse>;
  payload: AnalyticsPayload;
  at: number;
};

export { clearEmployeePeriodSwrStore };

function asEmployeeSwrEntry(raw: EmployeePeriodSwrEntry | null): EmployeeSwrEntry | null {
  return raw as EmployeeSwrEntry | null;
}

function lastKnownMetricsFromPayload(payload: AnalyticsPayload) {
  return {
    periodTipCount: payload.periodTipCount,
    periodAmountEur: payload.periodAmountEur,
    monthlyGoal: payload.monthlyGoal,
    currentMonthTotal: payload.currentMonthTotal,
    goalProgress: payload.goalProgress,
    averageRating: payload.averageRating,
    ratingCount: payload.ratingCount,
  };
}

/** Summary scope returned explicit period aggregates — 0 is valid, synthesized defaults are not. */
function isEmployeeSummaryPartialConfirmed(
  partial: Partial<EmployeeTipsResponse> | null | undefined,
): boolean {
  if (!partial) return false;
  return (
    typeof partial.periodTipCount === "number" || typeof partial.periodAmountEur === "number"
  );
}

function payloadFromResponse(data: EmployeeTipsResponse): AnalyticsPayload {
  const tipsArr = data.tips ?? [];
  const nCount = data.periodTipCount;
  const nAmount = data.periodAmountEur;
  return {
    tips: tipsArr,
    monthlyGoal: data.monthlyGoal ?? null,
    currentMonthTotal: data.currentMonthTotal ?? 0,
    goalProgress: data.goal ?? null,
    businessTimezone: (data as { businessTimezone?: string }).businessTimezone ?? null,
    periodTipCount: typeof nCount === "number" ? nCount : 0,
    periodAmountEur: typeof nAmount === "number" ? nAmount : 0,
    averageRating:
      typeof data.averageRating === "number" && Number.isFinite(data.averageRating)
        ? data.averageRating
        : null,
    ratingCount: typeof data.ratingCount === "number" ? data.ratingCount : 0,
    chartSeries: Array.isArray(data.chartSeries) ? data.chartSeries : [],
    totalEarningsEur:
      typeof data.totalEarningsEur === "number" ? data.totalEarningsEur : undefined,
    availableBalanceEur:
      typeof data.availableBalanceEur === "number" ? data.availableBalanceEur : undefined,
    paidOutEur:
      typeof data.paidOutEur === "number"
        ? data.paidOutEur
        : typeof data.availableBalanceEur === "number"
          ? data.availableBalanceEur
          : undefined,
    totalSupporters:
      typeof data.totalSupporters === "number" ? data.totalSupporters : undefined,
  };
}

export function useEmployeeDashboardAnalytics(
  enabled: boolean,
  employeeId: string | undefined,
  sessionValidated: boolean,
  advancedAnalyticsEnabled = true,
) {
  const [boot] = useState(() => {
    const tf = getEmployeePeriodLastTimeframe();
    const hit = asEmployeeSwrEntry(peekEmployeePeriodSnapshot(tf));
    return { tf, hit };
  });
  const [analyticsTimeframe, setAnalyticsTimeframe] = useState<EmployeeAnalyticsTimeframe>(boot.tf);
  const [payload, setPayload] = useState<AnalyticsPayload | null>(() => boot.hit?.payload ?? null);
  const [dataTimeframe, setDataTimeframe] = useState<EmployeeAnalyticsTimeframe | null>(
    () => (boot.hit ? boot.tf : null),
  );
  const [summaryLoading, setSummaryLoading] = useState(() => !boot.hit);
  const [analyticsLoading, setAnalyticsLoading] = useState(() => {
    if (!boot.hit) return true;
    return (
      boot.hit.summary?.analyticsBundled !== true &&
      !hasEmployeeAnalyticsPayload(boot.hit.analytics)
    );
  });
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(() => boot.hit?.at ?? null);
  const [dataRevision, setDataRevision] = useState(0);
  const [lastKnownGoodMetrics, setLastKnownGoodMetrics] = useState<{
    periodTipCount: number;
    periodAmountEur: number;
    monthlyGoal: number | null;
    currentMonthTotal: number;
    goalProgress: EmployeeGoalProgress | null;
    averageRating: number | null;
    ratingCount: number;
  } | null>(() => (boot.hit?.payload ? lastKnownMetricsFromPayload(boot.hit.payload) : null));

  const tfRef = useRef(analyticsTimeframe);
  tfRef.current = analyticsTimeframe;
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const lastKnownGoodMetricsRef = useRef(lastKnownGoodMetrics);
  lastKnownGoodMetricsRef.current = lastKnownGoodMetrics;
  const uiRequestSeqRef = useRef(0);
  const abortRef = useRef(new Map<EmployeeAnalyticsTimeframe, AbortController>());
  const summaryPartialRef = useRef(new Map<EmployeeAnalyticsTimeframe, Partial<EmployeeTipsResponse>>());
  const analyticsPartialRef = useRef(new Map<EmployeeAnalyticsTimeframe, Partial<EmployeeTipsResponse>>());
  const hasSettledLiveUiRef = useRef(Boolean(boot.hit));
  /** Periods that completed at least one successful network fetch this dashboard session. */
  const networkSettledTfsRef = useRef(new Set<EmployeeAnalyticsTimeframe>());
  /** Periods whose summary scope returned confirmed period aggregates from the network. */
  const summaryFetchedTfsRef = useRef(new Set<EmployeeAnalyticsTimeframe>());
  /** Periods whose analytics scope (or bundled summary) returned from the network. */
  const analyticsFetchedTfsRef = useRef(new Set<EmployeeAnalyticsTimeframe>());
  if (boot.hit && summaryPartialRef.current.size === 0) {
    summaryPartialRef.current.set(boot.tf, boot.hit.summary);
    analyticsPartialRef.current.set(boot.tf, boot.hit.analytics);
    if (isEmployeeSummaryPartialConfirmed(boot.hit.summary)) {
      summaryFetchedTfsRef.current.add(boot.tf);
      networkSettledTfsRef.current.add(boot.tf);
    }
    if (
      boot.hit.summary?.analyticsBundled === true ||
      hasEmployeeAnalyticsPayload(boot.hit.analytics)
    ) {
      analyticsFetchedTfsRef.current.add(boot.tf);
      networkSettledTfsRef.current.add(boot.tf);
    }
    markEmployeePeriodLiveSettled();
  }
  const analyticsDeferTimerRef = useRef<number | null>(null);
  const loadInflightByTfRef = useRef(
    new Map<EmployeeAnalyticsTimeframe, Promise<void>>(),
  );
  const loadForRef = useRef<
    (
      tf: EmployeeAnalyticsTimeframe,
      opts?: {
        affectsUi?: boolean;
        silent?: boolean;
        soft?: boolean;
        forceNetwork?: boolean;
        stopAfterSummary?: boolean;
        analyticsOnly?: boolean;
      },
    ) => Promise<void>
  >(async () => {});
  const advancedAnalyticsEnabledRef = useRef(advancedAnalyticsEnabled);
  advancedAnalyticsEnabledRef.current = advancedAnalyticsEnabled;
  const wasDashboardEnabledRef = useRef(false);
  const prefetchQueueRef = useRef<number | null>(null);
  const scheduleInactivePrefetchRef = useRef<(activeTf: EmployeeAnalyticsTimeframe) => void>(() => {});
  const prevAdvancedAnalyticsRef = useRef<boolean | null>(null);
  /** Background reconcile (socket/tab) — must not invalidate in-flight period loads. */
  const quietRefreshGenRef = useRef(0);

  const isActive = enabled && sessionValidated;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const abortInactiveTimeframes = useCallback((activeTf: EmployeeAnalyticsTimeframe) => {
    for (const [tf, controller] of abortRef.current) {
      if (tf === activeTf) continue;
      controller.abort();
      abortRef.current.delete(tf);
    }
  }, []);

  const syncTipsFromResponse = useCallback(
    (data: EmployeeTipsResponse) => {
      if (!employeeId) return;
      const tips = resolveEmployeeTipsWithDevPreview(
        data.tips ?? [],
        {
          totalEarningsEur: data.totalEarningsEur,
          totalSupporters: data.totalSupporters,
        },
        isWalkthroughDemoEmployee(getAuthUser()),
      );
      syncEmployeeNotificationTips(employeeId, tips);
    },
    [employeeId],
  );

  const persistSwr = useCallback((tf: EmployeeAnalyticsTimeframe) => {
    const summary = summaryPartialRef.current.get(tf);
    const analytics = analyticsPartialRef.current.get(tf);
    const merged = mergeEmployeeTipsResponse(summary, analytics);
    if (!merged) return;
    writeEmployeePeriodSnapshot(tf, {
      summary: (summary ?? {}) as Record<string, unknown>,
      analytics: (analytics ?? {}) as Record<string, unknown>,
      payload: payloadFromResponse(merged) as unknown as Record<string, unknown>,
    });
    markEmployeePeriodLiveSettled();
  }, []);

  const hydrateFromSwr = useCallback((tf: EmployeeAnalyticsTimeframe): AnalyticsPayload | null => {
    const hit = asEmployeeSwrEntry(
      getEmployeePeriodSnapshot(tf, DASHBOARD_SWR_METRICS_TTL_MS) ??
        (isEmployeePeriodLiveSettled() ? peekEmployeePeriodSnapshot(tf) : null),
    );
    if (!hit) return null;
    summaryPartialRef.current.set(tf, hit.summary);
    analyticsPartialRef.current.set(tf, hit.analytics);
    if (isEmployeeSummaryPartialConfirmed(hit.summary)) {
      summaryFetchedTfsRef.current.add(tf);
      networkSettledTfsRef.current.add(tf);
    }
    if (
      hit.summary?.analyticsBundled === true ||
      hasEmployeeAnalyticsPayload(hit.analytics)
    ) {
      analyticsFetchedTfsRef.current.add(tf);
      networkSettledTfsRef.current.add(tf);
    }
    return hit.payload;
  }, []);

  const hydratePeriodSessionCache = useCallback(
    (tf: EmployeeAnalyticsTimeframe): void => {
      if (!canUsePeriodSwitchCache(hasSettledLiveUiRef.current)) return;
      hydrateFromSwr(tf);
    },
    [hydrateFromSwr],
  );

  const isPeriodSummaryReady = useCallback((tf: EmployeeAnalyticsTimeframe): boolean => {
    if (!canUsePeriodSwitchCache(hasSettledLiveUiRef.current)) return false;
    let summaryPartial = summaryPartialRef.current.get(tf);
    if (!summaryFetchedTfsRef.current.has(tf) || !isEmployeeSummaryPartialConfirmed(summaryPartial)) {
      hydrateFromSwr(tf);
      summaryPartial = summaryPartialRef.current.get(tf);
    }
    return (
      summaryFetchedTfsRef.current.has(tf) &&
      isEmployeeSummaryPartialConfirmed(summaryPartial)
    );
  }, [hydrateFromSwr]);

  const isPeriodAnalyticsReady = useCallback((tf: EmployeeAnalyticsTimeframe): boolean => {
    if (!advancedAnalyticsEnabledRef.current) return true;
    const summaryPartial = summaryPartialRef.current.get(tf);
    return (
      summaryPartial?.analyticsBundled === true ||
      analyticsFetchedTfsRef.current.has(tf) ||
      hasEmployeeAnalyticsPayload(analyticsPartialRef.current.get(tf))
    );
  }, []);

  const isPeriodSessionReady = useCallback(
    (tf: EmployeeAnalyticsTimeframe): boolean => {
      return isPeriodSummaryReady(tf) && isPeriodAnalyticsReady(tf);
    },
    [isPeriodSummaryReady, isPeriodAnalyticsReady],
  );

  const commitUiPayload = useCallback(
    (tf: EmployeeAnalyticsTimeframe, seq: number, fromNetwork: boolean) => {
      const summaryPartial = summaryPartialRef.current.get(tf);
      const analyticsPartial = analyticsPartialRef.current.get(tf);
      const summaryFetched = summaryFetchedTfsRef.current.has(tf);
      const analyticsFetched =
        analyticsFetchedTfsRef.current.has(tf) || summaryPartial?.analyticsBundled === true;
      const summaryConfirmed = isEmployeeSummaryPartialConfirmed(summaryPartial);
      const networkSettled = networkSettledTfsRef.current.has(tf);

      debugEmployeeAnalytics("commit_attempt", {
        period: tf,
        activePeriod: tfRef.current,
        requestSeq: seq,
        currentSeq: uiRequestSeqRef.current,
        summaryFetched,
        analyticsFetched,
        summaryConfirmed,
        networkSettled,
        fromNetwork,
      });

      if (tf !== tfRef.current) {
        debugEmployeeAnalytics("commit_skipped", {
          reason: "period_mismatch",
          requestedPeriod: tf,
          activePeriod: tfRef.current,
          requestSeq: seq,
          currentSeq: uiRequestSeqRef.current,
          summaryFetched,
          analyticsFetched,
          committed: false,
        });
        return false;
      }
      if (uiRequestSeqRef.current !== seq) {
        debugEmployeeAnalytics("commit_skipped", {
          reason: "seq_mismatch",
          requestedPeriod: tf,
          activePeriod: tfRef.current,
          requestSeq: seq,
          currentSeq: uiRequestSeqRef.current,
          summaryFetched,
          analyticsFetched,
          committed: false,
        });
        return false;
      }
      if (!summaryFetched || !summaryConfirmed) {
        debugEmployeeAnalytics("commit_skipped", {
          reason: "summary_not_network_ready",
          requestedPeriod: tf,
          requestSeq: seq,
          summaryFetched,
          summaryConfirmed,
          committed: false,
        });
        return false;
      }
      const merged = mergeEmployeeTipsResponse(summaryPartial, analyticsPartial);
      if (!merged) {
        debugEmployeeAnalytics("commit_skipped", {
          reason: "no_merged_payload",
          requestedPeriod: tf,
          requestSeq: seq,
          summaryFetched,
          analyticsFetched,
          committed: false,
        });
        return false;
      }
      const next = payloadFromResponse(merged);
      if (!isEmployeeSummaryFetched(next)) {
        debugEmployeeAnalytics("commit_skipped", {
          reason: "summary_payload_invalid",
          requestedPeriod: tf,
          requestSeq: seq,
          summaryFetched,
          analyticsFetched,
          committed: false,
        });
        return false;
      }
      persistSwr(tf);
      setPayload(next);
      setDataTimeframe(tf);
      setError(null);
      setLastUpdatedAt(Date.now());
      if (fromNetwork) setDataRevision((n) => n + 1);
      if (merged.tips?.length) syncTipsFromResponse(merged);
      setLastKnownGoodMetrics({
        periodTipCount: next.periodTipCount,
        periodAmountEur: next.periodAmountEur,
        monthlyGoal: next.monthlyGoal,
        currentMonthTotal: next.currentMonthTotal,
        goalProgress: next.goalProgress,
        averageRating: next.averageRating,
        ratingCount: next.ratingCount,
      });
      logEmployeePeriodPayload(tf, next, fromNetwork ? "network" : "cache");
      endEmployeePeriodTimer(tf, "first-kpi-render");
      debugEmployeeAnalytics("commit_ok", {
        requestedPeriod: tf,
        activePeriod: tfRef.current,
        requestSeq: seq,
        fromNetwork,
        summaryFetched,
        analyticsFetched,
        networkSettled,
        committed: true,
      });
      return true;
    },
    [persistSwr, syncTipsFromResponse],
  );

  const applyCachedToUi = useCallback(
    (tf: EmployeeAnalyticsTimeframe, seq: number) => {
      const committed = commitUiPayload(tf, seq, false);
      if (!committed) return;
      setSummaryLoading(false);
      const analyticsSlice = analyticsPartialRef.current.get(tf);
      const chartsReady =
        !advancedAnalyticsEnabledRef.current ||
        hasEmployeeAnalyticsPayload(analyticsSlice) ||
        Boolean(analyticsPartialRef.current.get(tf)?.chartSeries?.length);
      setAnalyticsLoading(!chartsReady);
      debugEmployeeAnalytics("cache_applied", {
        requestedPeriod: tf,
        requestSeq: seq,
        chartsReady,
      });
    },
    [commitUiPayload],
  );

  const setAnalyticsTimeframeControlled = useCallback(
    (tf: EmployeeAnalyticsTimeframe) => {
      if (tf === tfRef.current) return;
      debugEmployeeAnalytics("period_switch", {
        requestedPeriod: tf,
        activePeriod: tfRef.current,
        currentSeq: uiRequestSeqRef.current,
      });
      abortInactiveTimeframes(tf);
      if (analyticsDeferTimerRef.current != null) {
        window.clearTimeout(analyticsDeferTimerRef.current);
        analyticsDeferTimerRef.current = null;
      }
      tfRef.current = tf;
      setAnalyticsTimeframe(tf);
      setEmployeePeriodLastTimeframe(tf);
      const seq = ++uiRequestSeqRef.current;

      hydratePeriodSessionCache(tf);

      if (isPeriodSessionReady(tf)) {
        setSummaryLoading(false);
        setAnalyticsLoading(false);
        setIsRevalidating(false);
        devSetHydrationPhase("metrics", "ready");
        devSetHydrationPhase("charts", "ready");
        devSetHydrationPhase("goals", "ready");
        commitUiPayload(tf, seq, false);
        markDashboardLiveSettled(hasSettledLiveUiRef);
      } else {
        const summaryPartial = summaryPartialRef.current.get(tf);
        if (
          summaryFetchedTfsRef.current.has(tf) &&
          summaryPartial &&
          isEmployeeSummaryPartialConfirmed(summaryPartial)
        ) {
          setSummaryLoading(false);
          devSetHydrationPhase("metrics", "ready");
          devSetHydrationPhase("goals", "ready");
          const analyticsSlice = analyticsPartialRef.current.get(tf);
          const chartsReady =
            !advancedAnalyticsEnabledRef.current ||
            hasEmployeeAnalyticsPayload(analyticsSlice);
          setAnalyticsLoading(!chartsReady);
          if (chartsReady) {
            devSetHydrationPhase("charts", "ready");
          } else {
            devSetHydrationPhase("charts", "loading");
          }
          commitUiPayload(tf, seq, false);
        } else {
          setIsRevalidating(true);
          setSummaryLoading(true);
          setAnalyticsLoading(true);
        }
      }

      void loadForRef.current(tf, {
        affectsUi: true,
        soft: canUsePeriodSwitchCache(hasSettledLiveUiRef.current),
      });
    },
    [abortInactiveTimeframes, hydratePeriodSessionCache, isPeriodSessionReady, commitUiPayload],
  );

  const loadFor = useCallback(
    async (
      tf: EmployeeAnalyticsTimeframe,
      opts?: {
        affectsUi?: boolean;
        silent?: boolean;
        soft?: boolean;
        forceNetwork?: boolean;
        stopAfterSummary?: boolean;
        analyticsOnly?: boolean;
      },
    ): Promise<void> => {
      if (!isActiveRef.current) return;

      const trustPeriodCache = canUsePeriodSwitchCache(hasSettledLiveUiRef.current);
      const summarySessionReady = isPeriodSummaryReady(tf);
      const analyticsSessionReady = isPeriodAnalyticsReady(tf);
      const periodSessionReady = summarySessionReady && analyticsSessionReady;
      const revalidate =
        opts?.forceNetwork === true ||
        !trustPeriodCache ||
        (opts?.soft === true && !summarySessionReady);

      const payloadVisibleOnScreen = () =>
        hasEmployeePayloadVisibleContent(payloadRef.current) ||
        Boolean(lastKnownGoodMetricsRef.current);
      const chartsVisibleOnScreen = () =>
        hasEmployeeChartOrTipsContent(payloadRef.current);
      const setSummaryLoadingUi = (next: boolean) => {
        if (next && revalidate && payloadVisibleOnScreen()) {
          setSummaryLoading(false);
          return;
        }
        setSummaryLoading(next);
      };
      const setAnalyticsLoadingUi = (next: boolean) => {
        if (next && revalidate && chartsVisibleOnScreen()) {
          setAnalyticsLoading(false);
          return;
        }
        setAnalyticsLoading(next);
      };

      hydratePeriodSessionCache(tf);

      const affectsUi = opts?.affectsUi === true && tf === tfRef.current;
      if (affectsUi) {
        abortInactiveTimeframes(tf);
        if (analyticsDeferTimerRef.current != null) {
          window.clearTimeout(analyticsDeferTimerRef.current);
          analyticsDeferTimerRef.current = null;
        }
      }
      const seq = affectsUi ? ++uiRequestSeqRef.current : 0;
      if (affectsUi) {
        if (!summarySessionReady) {
          startEmployeePeriodTimer(tf, "first-kpi-render");
        }
        debugEmployeeAnalytics("load_start", {
          requestedPeriod: tf,
          activePeriod: tfRef.current,
          requestSeq: seq,
          revalidate,
          summarySessionReady,
          analyticsSessionReady,
          periodSessionReady,
          stopAfterSummary: opts?.stopAfterSummary === true,
          analyticsOnly: opts?.analyticsOnly === true,
          soft: opts?.soft === true,
          forceNetwork: opts?.forceNetwork === true,
        });
      }
      const cached =
        affectsUi &&
        canUsePeriodSwitchCache(hasSettledLiveUiRef.current) &&
        opts?.soft
          ? hydrateFromSwr(tf)
          : null;

      const summaryPartial = summaryPartialRef.current.get(tf);
      const summaryFromMemory =
        trustPeriodCache &&
        summaryFetchedTfsRef.current.has(tf) &&
        Boolean(summaryPartial) &&
        isEmployeeSummaryPartialConfirmed(summaryPartial) &&
        (!revalidate || isEmployeeSummaryPartialConfirmed(summaryPartial));
      let summarySettled = summarySessionReady && !revalidate;
      let analyticsSettled =
        !advancedAnalyticsEnabledRef.current
          ? summarySettled
          : analyticsSessionReady && !revalidate;

      const existingInflight = loadInflightByTfRef.current.get(tf);
      if (existingInflight && !affectsUi) {
        return existingInflight;
      }
      if (existingInflight && affectsUi) {
        setError(null);
        const summaryReady = isPeriodSummaryReady(tf);
        const analyticsReady = isPeriodAnalyticsReady(tf);
        if (summaryReady) {
          commitUiPayload(tf, seq, false);
          setSummaryLoading(false);
          devSetHydrationPhase("metrics", "ready");
          devSetHydrationPhase("goals", "ready");
        } else {
          startEmployeePeriodTimer(tf, "first-kpi-render");
          setSummaryLoadingUi(!payloadVisibleOnScreen());
          if (!payloadVisibleOnScreen()) {
            devSetHydrationPhase("metrics", "loading");
          }
        }
        if (!analyticsReady && advancedAnalyticsEnabledRef.current) {
          setAnalyticsLoadingUi(true);
          devSetHydrationPhase("charts", "loading");
        } else {
          setAnalyticsLoading(false);
          devSetHydrationPhase("charts", "ready");
        }
        setIsRevalidating(
          !summaryReady || (!analyticsReady && advancedAnalyticsEnabledRef.current),
        );
        debugEmployeeAnalytics("inflight_attach", {
          requestedPeriod: tf,
          requestSeq: seq,
          summaryReady,
          analyticsReady,
          revalidate,
        });
        void existingInflight
          .then(() => {
            if (tf !== tfRef.current || uiRequestSeqRef.current !== seq) return;
            const committed = commitUiPayload(tf, seq, true);
            if (committed || isPeriodSummaryReady(tf)) {
              setSummaryLoading(false);
              setAnalyticsLoading(false);
              setIsRevalidating(false);
              devSetHydrationPhase("metrics", "ready");
              devSetHydrationPhase("charts", "ready");
              devSetHydrationPhase("goals", "ready");
              markDashboardLiveSettled(hasSettledLiveUiRef);
              scheduleInactivePrefetchRef.current(tf);
              return;
            }
            debugEmployeeAnalytics("inflight_attach_incomplete", {
              requestedPeriod: tf,
              requestSeq: seq,
            });
            if (loadInflightByTfRef.current.get(tf) === existingInflight) {
              loadInflightByTfRef.current.delete(tf);
            }
            if (!payloadVisibleOnScreen()) {
              setSummaryLoading(true);
            }
            void loadForRef.current(tf, { affectsUi: true, forceNetwork: true, silent: true });
          })
          .catch(() => {
            if (tf !== tfRef.current || uiRequestSeqRef.current !== seq) return;
            setIsRevalidating(false);
            debugEmployeeAnalytics("inflight_attach_error", {
              requestedPeriod: tf,
              requestSeq: seq,
            });
            if (loadInflightByTfRef.current.get(tf) === existingInflight) {
              loadInflightByTfRef.current.delete(tf);
            }
            if (!payloadVisibleOnScreen()) {
              setSummaryLoading(true);
            }
            void loadForRef.current(tf, { affectsUi: true, forceNetwork: true, silent: true });
          });
        return existingInflight;
      }

      if (affectsUi) {
        setError(null);
        if (periodSessionReady && !revalidate && trustPeriodCache) {
          setSummaryLoading(false);
          setAnalyticsLoading(false);
          setIsRevalidating(false);
          devSetHydrationPhase("metrics", "ready");
          devSetHydrationPhase("charts", "ready");
          devSetHydrationPhase("goals", "ready");
          commitUiPayload(tf, seq, false);
          markDashboardLiveSettled(hasSettledLiveUiRef);
          scheduleInactivePrefetchRef.current(tf);
          return;
        }
        if (summarySessionReady && !revalidate && trustPeriodCache) {
          commitUiPayload(tf, seq, false);
          setSummaryLoading(false);
          setIsRevalidating(false);
          devSetHydrationPhase("metrics", "ready");
          devSetHydrationPhase("goals", "ready");
          if (analyticsSessionReady || !advancedAnalyticsEnabledRef.current) {
            setAnalyticsLoading(false);
            devSetHydrationPhase("charts", "ready");
            markDashboardLiveSettled(hasSettledLiveUiRef);
            scheduleInactivePrefetchRef.current(tf);
            return;
          }
          setAnalyticsLoading(true);
          devSetHydrationPhase("charts", "loading");
        } else {
        const preserveVisibleUi =
          revalidate &&
          (hasEmployeePayloadVisibleContent(payloadRef.current) ||
            Boolean(lastKnownGoodMetricsRef.current));

        setIsRevalidating(true);
        if (preserveVisibleUi) {
          const targetPartial = summaryPartialRef.current.get(tf);
          if (
            summaryFetchedTfsRef.current.has(tf) &&
            targetPartial &&
            isEmployeeSummaryPartialConfirmed(targetPartial)
          ) {
            commitUiPayload(tf, seq, false);
          }
          setSummaryLoading(false);
          setAnalyticsLoading(false);
        } else if (summaryFromMemory && !opts?.soft) {
          commitUiPayload(tf, seq, true);
          setSummaryLoading(false);
          devSetHydrationPhase("metrics", "ready");
          if (!analyticsSettled) {
            setAnalyticsLoadingUi(true);
            if (!(revalidate && chartsVisibleOnScreen())) {
              devSetHydrationPhase("charts", "loading");
            }
          }
        } else if (cached) {
          applyCachedToUi(tf, seq);
          devSetHydrationPhase("metrics", "ready");
          if (analyticsPartialRef.current.get(tf) || !advancedAnalyticsEnabledRef.current) {
            devSetHydrationPhase("charts", "ready");
            devSetHydrationPhase("goals", "ready");
            setIsRevalidating(false);
          } else {
            devSetHydrationPhase("charts", "loading");
          }
        } else if (!opts?.soft) {
          setSummaryLoadingUi(!payloadVisibleOnScreen());
          setAnalyticsLoadingUi(
            !chartsVisibleOnScreen() && advancedAnalyticsEnabledRef.current,
          );
          if (!payloadVisibleOnScreen() && !(revalidate && payloadVisibleOnScreen())) {
            devSetHydrationPhase("metrics", "loading");
          }
          if (!chartsVisibleOnScreen() && !(revalidate && chartsVisibleOnScreen())) {
            devSetHydrationPhase("charts", "loading");
            devSetHydrationPhase("goals", "loading");
          }
        } else {
          setSummaryLoadingUi(!payloadVisibleOnScreen());
          setAnalyticsLoadingUi(!analyticsSettled && advancedAnalyticsEnabledRef.current);
          if (!payloadVisibleOnScreen() && !(revalidate && payloadVisibleOnScreen())) {
            devSetHydrationPhase("metrics", "loading");
          }
          if (!analyticsSettled && !(revalidate && chartsVisibleOnScreen())) {
            devSetHydrationPhase("charts", "loading");
          }
        }
        }
      }

      const prev = abortRef.current.get(tf);
      if (prev) {
        debugEmployeeAnalytics("abort_previous", {
          requestedPeriod: tf,
          requestSeq: seq,
          affectsUi,
        });
        prev.abort();
      }
      const controller = new AbortController();
      abortRef.current.set(tf, controller);

      const silent = opts?.silent === true || Boolean(cached);
      const stillActive = () =>
        !controller.signal.aborted &&
        (!affectsUi || (tf === tfRef.current && uiRequestSeqRef.current === seq));
      const logInactive = (phase: string) => {
        if (!affectsUi) return;
        if (controller.signal.aborted) {
          debugEmployeeAnalytics("load_aborted", {
            requestedPeriod: tf,
            activePeriod: tfRef.current,
            requestSeq: seq,
            currentSeq: uiRequestSeqRef.current,
            phase,
          });
          return;
        }
        if (tf !== tfRef.current || uiRequestSeqRef.current !== seq) {
          debugEmployeeAnalytics("load_stale", {
            requestedPeriod: tf,
            activePeriod: tfRef.current,
            requestSeq: seq,
            currentSeq: uiRequestSeqRef.current,
            phase,
          });
        }
      };
      const clearActivePeriodLoading = (
        summaryDone: boolean,
        analyticsDone: boolean,
      ): void => {
        if (!affectsUi || tf !== tfRef.current) return;
        const isCurrentGeneration = uiRequestSeqRef.current === seq;
        const aborted = controller.signal.aborted;
        if (!isCurrentGeneration) {
          if (!aborted) return;
          if (loadInflightByTfRef.current.has(tf)) return;
        }
        if (summaryDone) {
          setSummaryLoading(false);
          setIsRevalidating(false);
        }
        if (analyticsDone) setAnalyticsLoading(false);
        debugEmployeeAnalytics("finally_cleanup", {
          requestedPeriod: tf,
          activePeriod: tfRef.current,
          requestSeq: seq,
          currentSeq: uiRequestSeqRef.current,
          summaryDone,
          analyticsDone,
          aborted,
          isCurrentGeneration,
        });
      };

      const applyBundledAnalyticsFromSummary = (summaryData: EmployeeTipsResponse) => {
        if (typeof summaryData.totalEarningsEur === "number") {
          primeEmployeeAccountSnapshot({
            totalEarningsEur: summaryData.totalEarningsEur,
            availableBalanceEur: summaryData.availableBalanceEur ?? summaryData.paidOutEur ?? 0,
            paidOutEur: summaryData.paidOutEur ?? summaryData.availableBalanceEur ?? 0,
            totalSupporters: summaryData.totalSupporters ?? 0,
          });
        }
        if (summaryData.analyticsBundled !== true) return false;
        analyticsPartialRef.current.set(tf, {
          tips: summaryData.tips ?? [],
          chartSeries: summaryData.chartSeries ?? [],
          businessTimezone: summaryData.businessTimezone,
        });
        analyticsFetchedTfsRef.current.add(tf);
        return true;
      };

      const markSummaryNetworkResult = (
        timeframe: EmployeeAnalyticsTimeframe,
        summaryData: EmployeeTipsResponse,
      ): boolean => {
        summaryPartialRef.current.set(timeframe, summaryData);
        if (!isEmployeeSummaryPartialConfirmed(summaryData)) {
          return false;
        }
        summaryFetchedTfsRef.current.add(timeframe);
        networkSettledTfsRef.current.add(timeframe);
        return true;
      };

      const run = (async () => {
        try {
          if (opts?.analyticsOnly && !summarySettled) {
            summarySettled = isPeriodSummaryReady(tf);
          }
          if (opts?.analyticsOnly && !summarySettled) {
            debugEmployeeAnalytics("analytics_only_skipped", {
              requestedPeriod: tf,
              reason: "summary_not_ready",
            });
            return;
          }

          if (summarySettled && analyticsSettled) {
            if (affectsUi && stillActive()) {
              setSummaryLoading(false);
              setAnalyticsLoading(false);
              devSetHydrationPhase("metrics", "ready");
              devSetHydrationPhase("charts", "ready");
              devSetHydrationPhase("goals", "ready");
              commitUiPayload(tf, seq, true);
              markDashboardLiveSettled(hasSettledLiveUiRef);
            }
            return;
          }

          if (!summarySettled && !opts?.analyticsOnly) {
            startEmployeePeriodTimer(tf, "summary-fetch");
            const summaryData = await getTipsByEmployee(tf, {
              scope: "summary",
              signal: controller.signal,
              silent,
            });
            endEmployeePeriodTimer(tf, "summary-fetch");
            if (!stillActive()) {
              logInactive("summary_response");
              return;
            }
            summarySettled = markSummaryNetworkResult(tf, summaryData);
            if (summarySettled && applyBundledAnalyticsFromSummary(summaryData)) {
              analyticsSettled = true;
            }
          }

          if (!summarySettled && summaryFromMemory) {
            summarySettled = summaryFetchedTfsRef.current.has(tf);
          }

          if (affectsUi && summarySettled && stillActive()) {
            setSummaryLoading(false);
            setIsRevalidating(false);
            devSetHydrationPhase("metrics", "ready");
            devSetHydrationPhase("goals", "ready");
            if (!analyticsSettled && advancedAnalyticsEnabledRef.current) {
              setAnalyticsLoading(true);
              devSetHydrationPhase("charts", "loading");
            } else {
              setAnalyticsLoading(false);
              devSetHydrationPhase("charts", "ready");
            }
            commitUiPayload(tf, seq, true);
          }

          if (!stillActive()) {
            logInactive("post_summary");
            return;
          }

          if (opts?.stopAfterSummary) {
            if (summarySettled) {
              persistSwr(tf);
              debugEmployeeAnalytics("prefetch_summary_stored", {
                period: tf,
                summarySettled,
              });
            }
            return;
          }

          if (!analyticsSettled) {
            if (!advancedAnalyticsEnabledRef.current) {
              analyticsSettled = true;
              if (affectsUi && stillActive()) {
                setAnalyticsLoading(false);
                devSetHydrationPhase("charts", "ready");
                commitUiPayload(tf, seq, true);
              }
            } else {
              if (affectsUi && stillActive()) {
                setAnalyticsLoading(true);
                devSetHydrationPhase("charts", "loading");
              }
              startEmployeePeriodTimer(tf, "analytics-fetch");
              const analyticsData = await getTipsByEmployee(tf, {
                scope: "analytics",
                signal: controller.signal,
                silent,
              });
              endEmployeePeriodTimer(tf, "analytics-fetch");
              if (!stillActive()) {
                logInactive("analytics_response");
                return;
              }
              analyticsPartialRef.current.set(tf, analyticsData);
              analyticsFetchedTfsRef.current.add(tf);
              networkSettledTfsRef.current.add(tf);
              analyticsSettled = true;
              if (affectsUi && stillActive()) {
                setAnalyticsLoading(false);
                devSetHydrationPhase("charts", "ready");
                commitUiPayload(tf, seq, true);
                const merged = mergeEmployeeTipsResponse(
                  summaryPartialRef.current.get(tf),
                  analyticsData,
                );
                if (merged) syncTipsFromResponse(merged);
              }
            }
          } else if (affectsUi && advancedAnalyticsEnabledRef.current && stillActive()) {
            setAnalyticsLoading(false);
            devSetHydrationPhase("charts", "ready");
            devSetHydrationPhase("goals", "ready");
            commitUiPayload(tf, seq, true);
          }

          if (stillActive()) {
            if (!affectsUi && summarySettled && analyticsSettled) {
              persistSwr(tf);
            }
            markDashboardLiveSettled(hasSettledLiveUiRef);
            if (affectsUi && tf === tfRef.current) {
              scheduleInactivePrefetchRef.current(tf);
            }
            debugEmployeeAnalytics("load_complete", {
              requestedPeriod: tf,
              activePeriod: tfRef.current,
              requestSeq: seq,
              summarySettled,
              analyticsSettled,
            });
          }
        } catch (e) {
          if (isAbortError(e) || controller.signal.aborted) {
            logInactive("catch_abort");
            return;
          }
          if (affectsUi && uiRequestSeqRef.current === seq) {
            if (!summarySettled) {
              setError(toUserFriendlyMessage(e));
              devSetHydrationPhase("metrics", "error");
            } else if (!analyticsSettled) {
              devSetHydrationPhase("charts", "error");
            }
          }
        } finally {
          if (affectsUi && stillActive() && summarySettled) {
            commitUiPayload(tf, seq, true);
          }
          clearActivePeriodLoading(summarySettled, analyticsSettled);
          if (abortRef.current.get(tf) === controller) {
            abortRef.current.delete(tf);
          }
        }
      })();

      loadInflightByTfRef.current.set(tf, run);
      run.finally(() => {
        if (loadInflightByTfRef.current.get(tf) === run) {
          loadInflightByTfRef.current.delete(tf);
        }
      });
      return run;
    },
    [
      commitUiPayload,
      syncTipsFromResponse,
      hydratePeriodSessionCache,
      isPeriodSummaryReady,
      isPeriodAnalyticsReady,
      isPeriodSessionReady,
      persistSwr,
      hydrateFromSwr,
      applyCachedToUi,
      abortInactiveTimeframes,
    ],
  );

  loadForRef.current = loadFor;

  /** Phase 1: load only the active employee timeframe — no week/month background prefetch. */
  const scheduleInactivePrefetch = useCallback((_activeTf: EmployeeAnalyticsTimeframe) => {
    if (prefetchQueueRef.current != null) {
      window.clearTimeout(prefetchQueueRef.current);
      prefetchQueueRef.current = null;
    }
  }, []);
  scheduleInactivePrefetchRef.current = scheduleInactivePrefetch;

  useEffect(() => {
    const wasActive = wasDashboardEnabledRef.current;
    wasDashboardEnabledRef.current = isActive;

    if (isActive) return;
    if (!wasActive) return;

    if (analyticsDeferTimerRef.current != null) {
      window.clearTimeout(analyticsDeferTimerRef.current);
      analyticsDeferTimerRef.current = null;
    }
    abortRef.current.forEach((c) => c.abort());
    abortRef.current.clear();
    loadInflightByTfRef.current.clear();
    quietRefreshGenRef.current += 1;
    // Keep period snapshots for sidebar remounts. Logout still wipes via clearEmployeePeriodSwrStore.
    hasSettledLiveUiRef.current = isEmployeePeriodLiveSettled();
    setIsRevalidating(false);
    setError(null);
    devSetHydrationPhase("metrics", "idle");
    devSetHydrationPhase("charts", "idle");
    devSetHydrationPhase("goals", "idle");
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    const tf = tfRef.current;
    if (!hasSettledLiveUiRef.current) {
      const peek = asEmployeeSwrEntry(peekEmployeePeriodSnapshot(tf));
      if (peek) {
        summaryPartialRef.current.set(tf, peek.summary);
        analyticsPartialRef.current.set(tf, peek.analytics);
        if (isEmployeeSummaryPartialConfirmed(peek.summary)) {
          summaryFetchedTfsRef.current.add(tf);
          networkSettledTfsRef.current.add(tf);
        }
        if (
          peek.summary?.analyticsBundled === true ||
          hasEmployeeAnalyticsPayload(peek.analytics)
        ) {
          analyticsFetchedTfsRef.current.add(tf);
          networkSettledTfsRef.current.add(tf);
        }
        hasSettledLiveUiRef.current = true;
        markEmployeePeriodLiveSettled();
        setPayload(peek.payload);
        setDataTimeframe(tf);
        setLastKnownGoodMetrics(lastKnownMetricsFromPayload(peek.payload));
        setLastUpdatedAt(peek.at);
        setSummaryLoading(false);
        setAnalyticsLoading(
          peek.summary?.analyticsBundled !== true &&
            !hasEmployeeAnalyticsPayload(peek.analytics),
        );
      }
    }
    const needsInitialPeriodNetwork = !isPeriodSummaryReady(tf);
    if (needsInitialPeriodNetwork && !hasEmployeePayloadVisibleContent(payloadRef.current)) {
      setSummaryLoading(true);
      setAnalyticsLoading(true);
    }
    debugEmployeeAnalytics("mount_load_start", {
      requestedPeriod: tf,
      activePeriod: tfRef.current,
      currentSeq: uiRequestSeqRef.current,
      needsInitialPeriodNetwork,
    });
    void loadForRef.current(tf, {
      affectsUi: true,
      soft: !needsInitialPeriodNetwork,
      silent: !needsInitialPeriodNetwork,
      forceNetwork: needsInitialPeriodNetwork,
    });
    return () => {
      abortRef.current.get(tf)?.abort();
    };
    // Period-ready helpers are ref-stable; re-run only when the dashboard becomes active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;

    const prev = prevAdvancedAnalyticsRef.current;
    prevAdvancedAnalyticsRef.current = advancedAnalyticsEnabled;

    if (!shouldRefetchOnAnalyticsCapabilityUpgrade(prev, advancedAnalyticsEnabled)) return;

    const tf = tfRef.current;
    const analyticsSlice = analyticsPartialRef.current.get(tf);
    if (hasEmployeeAnalyticsPayload(analyticsSlice)) return;

    if (analyticsDeferTimerRef.current != null) {
      window.clearTimeout(analyticsDeferTimerRef.current);
      analyticsDeferTimerRef.current = null;
    }
    analyticsPartialRef.current.delete(tf);
    analyticsFetchedTfsRef.current.delete(tf);
    deleteEmployeePeriodSnapshot(tf);
    setAnalyticsLoading(true);
    devSetHydrationPhase("charts", "loading");
    debugEmployeeAnalytics("entitlement_refetch", {
      requestedPeriod: tf,
      activePeriod: tfRef.current,
      currentSeq: uiRequestSeqRef.current,
    });
    void loadForRef.current(tf, { affectsUi: true, soft: false, silent: false, forceNetwork: true });
  }, [advancedAnalyticsEnabled, isActive]);

  const refetchLive = useCallback(() => {
    clearEmployeeTipsClientCache(tfRef.current);
    void loadFor(tfRef.current, { affectsUi: true, soft: true, silent: true });
  }, [loadFor]);

  const refreshQuiet = useCallback(async () => {
    if (!isActiveRef.current) return;
    const tf = tfRef.current;
    const gen = ++quietRefreshGenRef.current;
    const stillThisQuiet = () =>
      isActiveRef.current && quietRefreshGenRef.current === gen && tf === tfRef.current;
    clearEmployeeTipsClientCache(tf);
    try {
      const summaryData = await getTipsByEmployee(tf, { scope: "summary", silent: true });
      if (!stillThisQuiet()) return;
      if (isEmployeeSummaryPartialConfirmed(summaryData)) {
        summaryFetchedTfsRef.current.add(tf);
        networkSettledTfsRef.current.add(tf);
      }
      summaryPartialRef.current.set(tf, summaryData);
      if (summaryData.analyticsBundled === true) {
        analyticsPartialRef.current.set(tf, {
          tips: summaryData.tips ?? [],
          chartSeries: summaryData.chartSeries ?? [],
          businessTimezone: summaryData.businessTimezone,
        });
        analyticsFetchedTfsRef.current.add(tf);
      }
      commitUiPayload(tf, uiRequestSeqRef.current, true);
      const merged = mergeEmployeeTipsResponse(
        summaryData,
        analyticsPartialRef.current.get(tf),
      );
      if (merged) syncTipsFromResponse(merged);
      if (
        summaryData.analyticsBundled !== true &&
        advancedAnalyticsEnabledRef.current
      ) {
        const analyticsData = await getTipsByEmployee(tf, { scope: "analytics", silent: true });
        if (!stillThisQuiet()) return;
        analyticsPartialRef.current.set(tf, analyticsData);
        analyticsFetchedTfsRef.current.add(tf);
        networkSettledTfsRef.current.add(tf);
        commitUiPayload(tf, uiRequestSeqRef.current, true);
        const mergedAfter = mergeEmployeeTipsResponse(summaryData, analyticsData);
        if (mergedAfter) syncTipsFromResponse(mergedAfter);
      }
    } catch (e) {
      if (isAbortError(e)) return;
      if (!isApiConnectivityError(e)) {
        logClientError("useEmployeeDashboardAnalytics.refreshQuiet", e);
      }
    }
  }, [commitUiPayload, syncTipsFromResponse]);

  const applyLiveTip = useCallback(
    (p: LiveNewTipPayload) => {
      if (!isActiveRef.current) return;
      if (!employeeId || p.employeeId !== employeeId) return;

      // Only reconcile the *currently visible* period immediately.
      // Authoritative server fetch still wins and will reconcile final state.
      const tf = tfRef.current;
      const prevMerged = mergeEmployeeTipsResponse(
        summaryPartialRef.current.get(tf),
        analyticsPartialRef.current.get(tf),
      );
      if (!prevMerged) return;

      const existing = prevMerged.tips ?? [];
      const nextTips = [p.tip, ...existing].slice(0, 50);

      const summaryNext: Partial<EmployeeTipsResponse> = {
        ...summaryPartialRef.current.get(tf),
        tips: nextTips,
        periodTipCount: (prevMerged.periodTipCount ?? existing.length) + 1,
        periodAmountEur: (prevMerged.periodAmountEur ?? 0) + p.tip.amount,
        currentMonthTotal: p.currentMonthTotal,
        monthlyGoal: p.monthlyGoal,
      };

      summaryPartialRef.current.set(tf, summaryNext);
      commitUiPayload(tf, uiRequestSeqRef.current, false);
    },
    [employeeId, commitUiPayload],
  );

  const valuesMatchAnalyticsPeriod = dataTimeframe === analyticsTimeframe;
  const hasLivePeriodSnapshot =
    lastUpdatedAt != null && valuesMatchAnalyticsPeriod && Boolean(dataTimeframe);

  /** Period-aligned payload only — avoids binding KPI cards to a prior timeframe. */
  const displayPayload = useMemo(() => {
    if (!payload || !valuesMatchAnalyticsPeriod) return null;
    return payload;
  }, [payload, valuesMatchAnalyticsPeriod]);

  /** Hero + charts may reuse the latest payload while the active period fetch is in flight. */
  const displayPayloadOrLatest = useMemo(() => {
    if (displayPayload) return displayPayload;
    if (!payload || !hasLivePeriodSnapshot) return null;
    if (hasEmployeePayloadVisibleContent(payload)) return payload;
    return null;
  }, [displayPayload, hasLivePeriodSnapshot, payload]);

  const displayMetrics = useMemo(() => {
    if (!displayPayload || !valuesMatchAnalyticsPeriod) return null;
    if (!isEmployeeSummaryFetched(displayPayload)) return null;
    return {
      periodTipCount: displayPayload.periodTipCount ?? 0,
      periodAmountEur: displayPayload.periodAmountEur ?? 0,
      monthlyGoal: displayPayload.monthlyGoal,
      currentMonthTotal: displayPayload.currentMonthTotal ?? 0,
      goalProgress: displayPayload.goalProgress,
      averageRating: displayPayload.averageRating,
      ratingCount: displayPayload.ratingCount ?? 0,
    };
  }, [
    displayPayload,
    valuesMatchAnalyticsPeriod,
    displayPayload?.periodTipCount,
    displayPayload?.periodAmountEur,
    displayPayload?.monthlyGoal,
    displayPayload?.currentMonthTotal,
    displayPayload?.goalProgress,
    displayPayload?.averageRating,
    displayPayload?.ratingCount,
  ]);

  const hasMetricsData = displayMetrics != null;

  const chartPayloadPending =
    advancedAnalyticsEnabled &&
    valuesMatchAnalyticsPeriod &&
    !hasEmployeeAnalyticsPayload(displayPayload) &&
    !hasEmployeeAnalyticsPayload(payload);

  const displayMetricsResolved = useMemo(() => {
    if (displayMetrics) return displayMetrics;
    if (!isActive) return null;
    if (isRevalidating && lastKnownGoodMetrics && valuesMatchAnalyticsPeriod) {
      return lastKnownGoodMetrics;
    }
    if (!valuesMatchAnalyticsPeriod) return null;
    return null;
  }, [
    displayMetrics,
    isActive,
    isRevalidating,
    lastKnownGoodMetrics,
    valuesMatchAnalyticsPeriod,
  ]);

  const hasStaleVisibleMetrics = useMemo(() => {
    if (hasMetricsData) return true;
    if (dataTimeframe === analyticsTimeframe && hasEmployeePayloadVisibleContent(payload)) {
      return true;
    }
    if (
      !summaryFetchedTfsRef.current.has(analyticsTimeframe) &&
      !hasSettledLiveUiRef.current
    ) {
      return false;
    }
    const swrHit = asEmployeeSwrEntry(
      getEmployeePeriodSnapshot(analyticsTimeframe, DASHBOARD_SWR_METRICS_TTL_MS) ??
        (isEmployeePeriodLiveSettled() ? peekEmployeePeriodSnapshot(analyticsTimeframe) : null),
    );
    return Boolean(
      swrHit?.payload &&
        isEmployeeSummaryFetched(swrHit.payload) &&
        isEmployeeSummaryPartialConfirmed(swrHit.summary),
    );
  }, [
    analyticsTimeframe,
    dataTimeframe,
    hasMetricsData,
    payload?.periodTipCount,
    payload?.periodAmountEur,
    dataRevision,
  ]);

  const { showMetricsSkeleton, isPeriodRefreshing } = deriveDashboardMetricLoading({
    enabled: isActive,
    hasMetricsData,
    valuesMatchPeriod: valuesMatchAnalyticsPeriod,
    summaryLoading,
    isRevalidating,
    hasStaleVisibleMetrics,
  });

  /** Align with business — summary response received (zeros are valid). */
  const isMetricsSettled =
    isActive &&
    valuesMatchAnalyticsPeriod &&
    hasMetricsData &&
    lastUpdatedAt != null &&
    !summaryLoading &&
    !isRevalidating;

  const isPeriodSyncing =
    isActive &&
    !isMetricsSettled &&
    (showMetricsSkeleton || isPeriodRefreshing || summaryLoading || isRevalidating);

  const metricsRefreshLastUpdatedAt = isMetricsSettled ? lastUpdatedAt : null;

  const hasVisibleMetrics = hasMetricsData || hasStaleVisibleMetrics;

  const isAnalyticsSettled =
    isActive &&
    valuesMatchAnalyticsPeriod &&
    hasMetricsData &&
    lastUpdatedAt != null &&
    !summaryLoading &&
    !analyticsLoading &&
    !isRevalidating &&
    !chartPayloadPending;

  const hasPeriodActivity = useMemo(
    () => hasEmployeePeriodActivity(displayPayload),
    [
      displayPayload?.periodAmountEur,
      displayPayload?.periodTipCount,
      displayPayload?.ratingCount,
    ],
  );

  const isAnalyticsInitialLoad =
    !hasEmployeeAnalyticsPayload(displayPayload) &&
    !hasEmployeeAnalyticsPayload(payload) &&
    (!isActive || analyticsLoading || chartPayloadPending);

  const analyticsTimeframeLoading = isPeriodRefreshing ? analyticsTimeframe : null;

  const isMetricsInitialLoad = showMetricsSkeleton;

  return {
    analyticsTimeframe,
    setAnalyticsTimeframe: setAnalyticsTimeframeControlled,
    displayPayload,
    displayPayloadOrLatest,
    displayMetrics: displayMetricsResolved,
    hasMetricsData,
    payload,
    valuesMatchAnalyticsPeriod,
    summaryLoading: showMetricsSkeleton,
    analyticsLoading: isAnalyticsInitialLoad,
    isInitialLoad: showMetricsSkeleton,
    isMetricsInitialLoad,
    isAnalyticsInitialLoad,
    isPeriodRefreshing,
    isPeriodSyncing,
    isMetricsSettled,
    hasVisibleMetrics,
    isAnalyticsSettled,
    hasPeriodActivity,
    analyticsTimeframeLoading,
    showMetricsSkeleton,
    isDashboardHydrating: showMetricsSkeleton,
    isRevalidating,
    dataRevision,
    lastUpdatedAt,
    metricsRefreshLastUpdatedAt,
    error,
    refreshQuiet,
    refetchLive,
    applyLiveTip,
  };
}
