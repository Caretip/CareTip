import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearEmployeeAccountClientCache,
  getEmployeeAccountSnapshot,
  type EmployeeAccountSnapshot,
} from "../lib/api";
import {
  createDashboardSwrStore,
  DASHBOARD_SWR_BALANCE_TTL_MS,
} from "../lib/dashboardSwrCache";
import { canUseDashboardSwrCache, markDashboardLiveSettled } from "../lib/dashboardHydration";
import { isAbortError, isApiConnectivityError } from "../lib/errorMessages";
import { logClientError } from "../lib/clientLog";
import { devSetHydrationPhase } from "../lib/dashboardDevDebug";

const ACCOUNT_SWR_KEY = "employee:account";
const accountSwrStore = createDashboardSwrStore<EmployeeAccountSnapshot>();

export function clearEmployeeAccountSwrStore(): void {
  accountSwrStore.clear();
}

/** Prime hero balances from summary scope (avoids a separate account round-trip). */
export function primeEmployeeAccountSnapshot(snapshot: EmployeeAccountSnapshot): void {
  if (typeof snapshot.totalEarningsEur !== "number") return;
  accountSwrStore.set(ACCOUNT_SWR_KEY, snapshot);
}

/**
 * Hero account balances — short-lived SWR with immediate background revalidation.
 */
export function useEmployeeAccountSummary(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<EmployeeAccountSnapshot | null>(
    () => accountSwrStore.peek(ACCOUNT_SWR_KEY),
  );
  const [loading, setLoading] = useState(() => !accountSwrStore.peek(ACCOUNT_SWR_KEY));
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const hasSettledLiveUiRef = useRef(false);
  const loadAccountRef = useRef<(opts?: { soft?: boolean }) => Promise<void>>(async () => {});

  const loadAccount = useCallback(
    async (opts?: { soft?: boolean }) => {
      if (!enabled) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const useCache = canUseDashboardSwrCache({
        hasSettledLiveUi: hasSettledLiveUiRef.current,
        soft: opts?.soft,
      });
      const cached = useCache
        ? accountSwrStore.get(ACCOUNT_SWR_KEY, DASHBOARD_SWR_BALANCE_TTL_MS) ??
          accountSwrStore.peek(ACCOUNT_SWR_KEY)
        : accountSwrStore.peek(ACCOUNT_SWR_KEY);
      setIsRevalidating(true);

      if (cached) {
        setSnapshot(cached);
        setLoading(false);
      } else if (!opts?.soft) {
        setSnapshot(null);
        setLoading(true);
        devSetHydrationPhase("hero", "loading");
      } else {
        setLoading(!snapshotRef.current);
        if (!snapshotRef.current) {
          devSetHydrationPhase("hero", "loading");
        } else {
          devSetHydrationPhase("hero", "ready");
        }
      }

      try {
        const data = await getEmployeeAccountSnapshot({
          signal: controller.signal,
          silent: Boolean(cached || opts?.soft),
        });
        if (controller.signal.aborted) return;
        accountSwrStore.set(ACCOUNT_SWR_KEY, data);
        setSnapshot(data);
        setLastUpdatedAt(Date.now());
        setDataRevision((n) => n + 1);
        setLoading(false);
        devSetHydrationPhase("hero", "ready");
        markDashboardLiveSettled(hasSettledLiveUiRef);
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) return;
        if (!isApiConnectivityError(err)) {
          logClientError("useEmployeeAccountSummary", err);
        }
        devSetHydrationPhase("hero", "error");
        setLoading(false);
      } finally {
        if (!controller.signal.aborted) setIsRevalidating(false);
      }
    },
    [enabled],
  );

  loadAccountRef.current = loadAccount;

  const refetchLive = useCallback(() => {
    clearEmployeeAccountClientCache();
    void loadAccount({ soft: true });
  }, [loadAccount]);

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsRevalidating(false);
      devSetHydrationPhase("hero", "idle");
      return;
    }

    const primed =
      accountSwrStore.peek(ACCOUNT_SWR_KEY) ??
      accountSwrStore.get(ACCOUNT_SWR_KEY, DASHBOARD_SWR_BALANCE_TTL_MS);
    if (primed) {
      setSnapshot(primed);
      setLoading(false);
      hasSettledLiveUiRef.current = true;
      devSetHydrationPhase("hero", "ready");
      void loadAccountRef.current({ soft: true });
    } else {
      void loadAccountRef.current();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [enabled]);

  const displayAccount = loading && !snapshot ? null : snapshot;

  const isInitialLoad = loading && !snapshot;

  const refreshQuiet = useCallback(async () => {
    if (!enabled) return;
    await loadAccount({ soft: true });
  }, [enabled, loadAccount]);

  return {
    displayAccount,
    snapshot,
    loading: isInitialLoad,
    isInitialLoad,
    isRevalidating,
    isPeriodRefreshing: isRevalidating && Boolean(snapshot) && !isInitialLoad,
    dataRevision,
    lastUpdatedAt,
    refreshQuiet,
    refetchLive,
  };
}
