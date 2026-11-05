import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getBusinessFinancialSummary,
  type BusinessFinancialSummaryBundle,
  type BusinessFinancialPeriod,
} from "../lib/api";
import { toUserFriendlyMessage } from "../lib/errorMessages";
import { markAnalyticsPerformance } from "../lib/businessAnalytics/analyticsPerformanceMarks";
import { reportDashboardLoadFailure } from "../lib/dashboardLoadDiagnostics";

export type UseBusinessFinancialSummaryOpts = {
  /** Fetch ledger and connect slices in parallel for progressive hero rendering. */
  progressive?: boolean;
  /** Load reconciliation only for analytics surfaces (not hero-critical). */
  includeReconciliation?: boolean;
};

function mergeLedgerSlice(
  base: BusinessFinancialSummaryBundle | null,
  partial: BusinessFinancialSummaryBundle,
  expectedPeriod: BusinessFinancialPeriod,
): BusinessFinancialSummaryBundle {
  if (partial.period !== expectedPeriod) return base ?? partial;
  if (!base || base.period !== expectedPeriod) return partial;
  return {
    ...base,
    period: partial.period,
    periodBasis: partial.periodBasis,
    lifetime: partial.lifetime,
    periodMetrics: partial.periodMetrics,
    routing: partial.routing,
  };
}

function mergeConnectSlice(
  base: BusinessFinancialSummaryBundle | null,
  partial: BusinessFinancialSummaryBundle,
  expectedPeriod: BusinessFinancialPeriod,
): BusinessFinancialSummaryBundle {
  if (!base || base.period !== expectedPeriod) {
    return { ...partial, period: expectedPeriod };
  }
  return {
    ...base,
    stripe: partial.stripe,
    payouts: partial.payouts,
  };
}

function mergeReconciliationSlice(
  base: BusinessFinancialSummaryBundle | null,
  partial: BusinessFinancialSummaryBundle,
  expectedPeriod: BusinessFinancialPeriod,
): BusinessFinancialSummaryBundle {
  if (!base || base.period !== expectedPeriod) {
    return { ...partial, period: expectedPeriod };
  }
  return {
    ...base,
    reconciliation: partial.reconciliation,
  };
}

export function useBusinessFinancialSummary(
  enabled: boolean,
  period: BusinessFinancialPeriod = "all",
  opts?: UseBusinessFinancialSummaryOpts,
) {
  const progressive = opts?.progressive === true;
  const includeReconciliation = opts?.includeReconciliation === true;
  const [data, setData] = useState<BusinessFinancialSummaryBundle | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(enabled && progressive);
  const [connectLoading, setConnectLoading] = useState(enabled && progressive);
  const [reconciliationLoading, setReconciliationLoading] = useState(
    enabled && progressive && includeReconciliation,
  );
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Each section response zero-fills the other section's fields, so `data` alone cannot say which
   * values are real. A failed slice must render as unavailable, never as its placeholder zeros.
   */
  const [ledgerFailed, setLedgerFailed] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const loadGenRef = useRef(0);
  const periodRef = useRef(period);

  const load = useCallback(
    async (loadOpts?: { quiet?: boolean }) => {
      if (!enabled) return;
      const requestedPeriod = periodRef.current;
      const gen = ++loadGenRef.current;
      const stillCurrent = () =>
        gen === loadGenRef.current && periodRef.current === requestedPeriod;

      if (loadOpts?.quiet) setRefreshing(true);
      else {
        setLoading(true);
        if (progressive) {
          setLedgerLoading(true);
          setConnectLoading(true);
          if (includeReconciliation) setReconciliationLoading(true);
        }
        setLedgerFailed(false);
        setConnectFailed(false);
      }
      setError(null);

      try {
        if (progressive) {
          markAnalyticsPerformance("analytics.financial.request");
          const ledgerPromise = getBusinessFinancialSummary(requestedPeriod, { section: "ledger" })
            .then((ledgerPart) => {
              if (!stillCurrent() || ledgerPart.period !== requestedPeriod) return;
              setData((prev) => mergeLedgerSlice(prev, ledgerPart, requestedPeriod));
              setLedgerLoading(false);
              setLedgerFailed(false);
              markAnalyticsPerformance("analytics.financial.ledger.ready");
            })
            .catch((err) => {
              if (!stillCurrent()) return;
              setLedgerFailed(true);
              setLedgerLoading(false);
              reportDashboardLoadFailure("financialSummary", err, { section: "ledger" });
              throw err;
            });

          const connectPromise = getBusinessFinancialSummary(requestedPeriod, { section: "connect" })
            .then((connectPart) => {
              if (!stillCurrent()) return;
              setData((prev) => mergeConnectSlice(prev, connectPart, requestedPeriod));
              setConnectLoading(false);
              setConnectFailed(false);
              markAnalyticsPerformance("analytics.financial.connect.ready");
            })
            .catch((err) => {
              if (!stillCurrent()) return;
              setConnectFailed(true);
              setConnectLoading(false);
              reportDashboardLoadFailure("financialSummary", err, { section: "connect" });
              throw err;
            });

          const reconciliationPromise =
            includeReconciliation
              ? Promise.all([ledgerPromise, connectPromise])
                  .then(() => {
                    if (!stillCurrent()) return;
                    return getBusinessFinancialSummary(requestedPeriod, { section: "reconciliation" });
                  })
                  .then((reconciliationPart) => {
                    if (!reconciliationPart || !stillCurrent()) return;
                    setData((prev) => mergeReconciliationSlice(prev, reconciliationPart, requestedPeriod));
                    setReconciliationLoading(false);
                    markAnalyticsPerformance("analytics.financial.reconciliation.ready");
                  })
                  .catch((err) => {
                    if (!stillCurrent()) return;
                    throw err;
                  })
              : Promise.resolve();

          void reconciliationPromise.catch(() => {
            if (!stillCurrent()) return;
            setReconciliationLoading(false);
          });
          // allSettled: a failed slice must not end the other slice's loading state early.
          const settled = await Promise.allSettled([ledgerPromise, connectPromise]);
          const rejected = settled.find((r) => r.status === "rejected");
          if (rejected) throw rejected.reason;
        } else {
          const bundle = await getBusinessFinancialSummary(requestedPeriod, {
            includeReconciliation,
          });
          if (!stillCurrent() || bundle.period !== requestedPeriod) return;
          setData(bundle);
          setLedgerLoading(false);
          setConnectLoading(false);
          setLedgerFailed(false);
          setConnectFailed(false);
        }
      } catch (err) {
        if (!stillCurrent()) return;
        setError(toUserFriendlyMessage(err));
        if (!progressive) {
          setLedgerFailed(true);
          setConnectFailed(true);
          reportDashboardLoadFailure("financialSummary", err, { section: "bundle" });
        }
        setLedgerLoading(false);
        setConnectLoading(false);
        setReconciliationLoading(false);
      } finally {
        if (stillCurrent()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [enabled, progressive, includeReconciliation],
  );

  useLayoutEffect(() => {
    periodRef.current = period;
    if (!enabled) return;
    setData((prev) => (prev && prev.period === period ? prev : null));
  }, [enabled, period]);

  useEffect(() => {
    if (!enabled) {
      loadGenRef.current += 1;
      setLedgerLoading(false);
      setConnectLoading(false);
      setReconciliationLoading(false);
      setLoading(false);
      setRefreshing(false);
      setLedgerFailed(false);
      setConnectFailed(false);
      return;
    }
    void load();
  }, [enabled, load, period]);

  const valuesMatchPeriod = data?.period === period;

  return {
    data,
    valuesMatchPeriod,
    loading: progressive ? ledgerLoading || connectLoading : loading,
    ledgerLoading:
      (progressive ? ledgerLoading : loading) || (!valuesMatchPeriod && !ledgerFailed),
    connectLoading:
      (progressive ? connectLoading : loading) || (!valuesMatchPeriod && !connectFailed),
    ledgerFailed,
    connectFailed,
    reconciliationLoading:
      progressive && includeReconciliation
        ? reconciliationLoading || !valuesMatchPeriod
        : false,
    refreshing,
    error,
    reload: () => load({ quiet: true }),
    /** User-initiated retry after a failure: shows loading again rather than the failed state. */
    retry: () => load(),
  };
}
