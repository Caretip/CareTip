import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getBusinessFinancialSummary,
  type BusinessFinancialSummaryBundle,
  type BusinessFinancialPeriod,
} from "../lib/api";
import { toUserFriendlyMessage } from "../lib/errorMessages";
import { markAnalyticsPerformance } from "../lib/businessAnalytics/analyticsPerformanceMarks";

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
              markAnalyticsPerformance("analytics.financial.ledger.ready");
            })
            .catch((err) => {
              if (!stillCurrent()) return;
              throw err;
            });

          const connectPromise = getBusinessFinancialSummary(requestedPeriod, { section: "connect" })
            .then((connectPart) => {
              if (!stillCurrent()) return;
              setData((prev) => mergeConnectSlice(prev, connectPart, requestedPeriod));
              setConnectLoading(false);
              markAnalyticsPerformance("analytics.financial.connect.ready");
            })
            .catch((err) => {
              if (!stillCurrent()) return;
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

          await Promise.all([ledgerPromise, connectPromise]);
          void reconciliationPromise.catch(() => {
            if (!stillCurrent()) return;
            setReconciliationLoading(false);
          });
        } else {
          const bundle = await getBusinessFinancialSummary(requestedPeriod, {
            includeReconciliation,
          });
          if (!stillCurrent() || bundle.period !== requestedPeriod) return;
          setData(bundle);
          setLedgerLoading(false);
          setConnectLoading(false);
        }
      } catch (err) {
        if (!stillCurrent()) return;
        setError(toUserFriendlyMessage(err));
        setLedgerLoading(false);
        setConnectLoading(false);
        setReconciliationLoading(false);
      } finally {
        if (!stillCurrent()) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [enabled, period, progressive, includeReconciliation],
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
      return;
    }
    void load();
  }, [enabled, load, period]);

  const valuesMatchPeriod = data?.period === period;

  return {
    data,
    valuesMatchPeriod,
    loading: progressive ? ledgerLoading || connectLoading : loading,
    ledgerLoading: progressive ? ledgerLoading || !valuesMatchPeriod : loading || !valuesMatchPeriod,
    connectLoading: progressive ? connectLoading || !valuesMatchPeriod : loading || !valuesMatchPeriod,
    reconciliationLoading:
      progressive && includeReconciliation
        ? reconciliationLoading || !valuesMatchPeriod
        : false,
    refreshing,
    error,
    reload: () => load({ quiet: true }),
  };
}
