import { useCallback, useEffect, useState } from "react";
import {
  getEmployeeAnalytics,
  type EmployeeAnalyticsBundle,
  type EmployeeAnalyticsPeriod,
} from "../lib/api";
import { toUserFriendlyMessage } from "../lib/errorMessages";

export function useEmployeeAnalytics(enabled: boolean, period: EmployeeAnalyticsPeriod) {
  const [data, setData] = useState<EmployeeAnalyticsBundle | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!enabled) return;
      if (opts?.quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const bundle = await getEmployeeAnalytics(period);
        setData(bundle);
      } catch (err) {
        setError(toUserFriendlyMessage(err, { audience: "employee" }));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [enabled, period],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, refreshing, error, reload: () => load({ quiet: true }) };
}
