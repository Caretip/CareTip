/**
 * ARCHITECTURE INVARIANT — Activity Center feed hook
 * --------------------------------------------------
 * Allowed dependencies only:
 *   - fetchBusinessActivity → GET /api/business/activity
 *   - subscribeActivityCreated → activity.created
 *
 * Forbidden (do not import):
 *   - useBusinessTipsModuleData / listBusinessTips
 *   - useBusinessAnalytics
 *   - subscribeTipReceived / tip.received / tip_received
 *   - useLiveActivityStream
 *   - Transactions / Analytics data loaders
 *
 * SSOT: BusinessActivityEvent. See docs/ARCHITECTURE_ACTIVITY_CENTER.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchBusinessActivity,
  type ActivityEventSource,
  type BusinessActivityFeedItem,
} from "../lib/api";
import { shouldProcessRealtimeEvent } from "../lib/realtime/realtimeEventDedupe";
import { subscribeActivityCreated } from "../lib/realtime/subscribeActivityCreated";
import { useRealtimeReconnect } from "../lib/realtime/useRealtimeReconnect";
import { useDashboardTabRefocus } from "./useDashboardTabRefocus";
import { useSocket, useDeferSocketConnect } from "./useSocket";

export type ActivitySourceFilter = ActivityEventSource | "all";

const PAGE_SIZE = 30;
const MAX_IN_MEMORY = 120;
const DISCONNECTED_POLL_MS = 45_000;

function sortByOccurredAtDesc(items: BusinessActivityFeedItem[]): BusinessActivityFeedItem[] {
  return [...items].sort((a, b) => {
    const ta = Date.parse(a.occurredAt);
    const tb = Date.parse(b.occurredAt);
    if (tb !== ta) return tb - ta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

function mergeById(
  existing: BusinessActivityFeedItem[],
  incoming: BusinessActivityFeedItem[],
  mode: "prepend" | "append" | "replace",
): BusinessActivityFeedItem[] {
  if (mode === "replace") {
    return sortByOccurredAtDesc(incoming).slice(0, MAX_IN_MEMORY);
  }
  const map = new Map<string, BusinessActivityFeedItem>();
  if (mode === "prepend") {
    for (const row of incoming) map.set(row.id, row);
    for (const row of existing) {
      if (!map.has(row.id)) map.set(row.id, row);
    }
  } else {
    for (const row of existing) map.set(row.id, row);
    for (const row of incoming) {
      if (!map.has(row.id)) map.set(row.id, row);
    }
  }
  return sortByOccurredAtDesc([...map.values()]).slice(0, MAX_IN_MEMORY);
}

export function matchesSourceFilter(
  item: BusinessActivityFeedItem,
  source: ActivitySourceFilter,
): boolean {
  if (source === "all") return true;
  return item.source === source;
}

type UseActivityCenterFeedOptions = {
  enabled: boolean;
  businessId?: string | null;
  source: ActivitySourceFilter;
};

/**
 * Activity Center feed — REST SSOT + activity.created only.
 * Filter changes apply locally from the in-memory pool first, then soft-sync the API.
 */
export function useActivityCenterFeed({ enabled, businessId, source }: UseActivityCenterFeedOptions) {
  /** Mixed pool of loaded events (all sources); UI filters this for instant chip/dropdown response. */
  const [pool, setPool] = useState<BusinessActivityFeedItem[]>([]);
  const [cursorsBySource, setCursorsBySource] = useState<
    Partial<Record<ActivitySourceFilter, string | null>>
  >({});
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const syncInFlightRef = useRef<Set<string>>(new Set());
  const bootstrappedRef = useRef(false);

  const socketReady = useDeferSocketConnect(enabled);
  const { socket, connected } = useSocket(socketReady);

  const items = useMemo(
    () => pool.filter((row) => matchesSourceFilter(row, source)),
    [pool, source],
  );

  const nextCursor = cursorsBySource[source] ?? null;
  const hasMore = Boolean(nextCursor);

  const markLive = useCallback((id: string) => {
    setLiveIds((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setLiveIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 12_000);
  }, []);

  const syncSource = useCallback(
    async (target: ActivitySourceFilter, opts?: { soft?: boolean; replacePool?: boolean }) => {
      if (!enabled) return;
      const key = target;
      if (syncInFlightRef.current.has(key)) return;
      syncInFlightRef.current.add(key);

      const soft = opts?.soft !== false;
      const showFullLoad = !soft && !bootstrappedRef.current;
      if (showFullLoad) setIsInitialLoading(true);
      else setIsRefreshing(true);
      setError(null);

      try {
        const result = await fetchBusinessActivity({
          limit: PAGE_SIZE,
          source: target,
        });
        setPool((prev) =>
          opts?.replacePool
            ? mergeById([], result.items, "replace")
            : mergeById(prev, result.items, "prepend"),
        );
        setCursorsBySource((prev) => ({ ...prev, [target]: result.nextCursor }));
        bootstrappedRef.current = true;
      } catch (err) {
        if (!bootstrappedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load activity");
        }
      } finally {
        syncInFlightRef.current.delete(key);
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    },
    [enabled],
  );

  const catchUp = useCallback(async () => {
    if (!enabled) return;
    await syncSource(sourceRef.current, { soft: true });
  }, [enabled, syncSource]);

  const loadOlder = useCallback(async () => {
    if (!enabled || isLoadingOlder) return;
    const cursor = cursorsBySource[source];
    if (!cursor) return;
    setIsLoadingOlder(true);
    try {
      const result = await fetchBusinessActivity({
        limit: PAGE_SIZE,
        cursor,
        source,
      });
      setPool((prev) => mergeById(prev, result.items, "append"));
      setCursorsBySource((prev) => ({ ...prev, [source]: result.nextCursor }));
    } catch {
      // Soft fail
    } finally {
      setIsLoadingOlder(false);
    }
  }, [enabled, isLoadingOlder, cursorsBySource, source]);

  // Bootstrap once with "all" so local filters are instant, then soft-sync active source.
  useEffect(() => {
    if (!enabled) {
      setPool([]);
      setCursorsBySource({});
      setIsInitialLoading(false);
      bootstrappedRef.current = false;
      return;
    }
    void (async () => {
      await syncSource("all", { soft: false, replacePool: true });
      if (sourceRef.current !== "all") {
        void syncSource(sourceRef.current, { soft: true });
      }
    })();
  }, [enabled, syncSource]);

  // Filter change: local filter is instant via `items` memo; soft-sync that source in background.
  const prevSourceRef = useRef(source);
  useEffect(() => {
    if (!enabled || !bootstrappedRef.current) return;
    if (prevSourceRef.current === source) return;
    prevSourceRef.current = source;
    void syncSource(source, { soft: true });
  }, [enabled, source, syncSource]);

  useEffect(() => {
    if (!socket || !enabled) return;
    return subscribeActivityCreated(socket, (item, meta) => {
      const dedupeId = meta?.eventId ?? item.id;
      if (!shouldProcessRealtimeEvent(dedupeId)) return;
      if (!shouldProcessRealtimeEvent(`activity-row:${item.id}`)) return;
      if (businessId && meta?.businessId && meta.businessId !== businessId) return;
      setPool((prev) => mergeById(prev, [item], "prepend"));
      if (matchesSourceFilter(item, sourceRef.current)) {
        markLive(item.id);
      }
    });
  }, [socket, enabled, businessId, markLive]);

  useRealtimeReconnect(() => {
    void catchUp();
  }, enabled);

  useDashboardTabRefocus(() => {
    void catchUp();
  }, enabled);

  useEffect(() => {
    if (!enabled || connected) return;
    const id = window.setInterval(() => {
      void catchUp();
    }, DISCONNECTED_POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, connected, catchUp]);

  return {
    items,
    liveIds,
    nextCursor,
    hasMore,
    isInitialLoading,
    isRefreshing,
    isLoadingOlder,
    error,
    loadOlder,
    refresh: catchUp,
  };
}
