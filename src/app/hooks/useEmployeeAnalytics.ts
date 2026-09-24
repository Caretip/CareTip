import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getEmployeeAnalytics,
  type EmployeeAnalyticsBundle,
  type EmployeeAnalyticsPeriod,
} from "../lib/api";
import { toUserFriendlyMessage } from "../lib/errorMessages";
import {
  deriveEmployeeTransferStatus,
  shouldPollEmployeeTransferStatus,
} from "../components/employee/employeeTransferStatusPresentation";
import { useDashboardTabRefocus } from "./useDashboardTabRefocus";

const TRANSFER_STATUS_POLL_MS = 45_000;

export function useEmployeeAnalytics(enabled: boolean, period: EmployeeAnalyticsPeriod) {
  const [data, setData] = useState<EmployeeAnalyticsBundle | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!enabled) return;
      if (opts?.quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const bundle = await getEmployeeAnalytics(period);
        setData(bundle);
        setLastFetchedAt(Date.now());
      } catch (err) {
        setError(toUserFriendlyMessage(err, { audience: "employee" }));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [enabled, period],
  );

  const reload = useCallback(() => load({ quiet: true }), [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useDashboardTabRefocus(reload, enabled);

  const transferStatusKind = useMemo(
    () => (data?.reconciliation ? deriveEmployeeTransferStatus(data.reconciliation).kind : null),
    [data?.reconciliation],
  );

  const shouldPoll = Boolean(
    enabled && transferStatusKind && shouldPollEmployeeTransferStatus(transferStatusKind),
  );

  const pollRef = useRef(reload);
  pollRef.current = reload;

  useEffect(() => {
    if (!shouldPoll) return;
    const id = window.setInterval(() => {
      void pollRef.current();
    }, TRANSFER_STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [shouldPoll]);

  return {
    data,
    loading,
    refreshing,
    error,
    lastFetchedAt,
    reload,
    transferStatusKind,
  };
}
