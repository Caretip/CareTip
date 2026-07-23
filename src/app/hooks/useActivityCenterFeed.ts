/**
 * ARCHITECTURE INVARIANT — Activity Center feed hook
 * --------------------------------------------------
 * Allowed dependencies only:
 *   - fetchBusinessActivity → GET /api/business/activity
 *   - subscribeActivityCreated → activity.created
 *   - businessVenueTime (calendar labels / Today filter — not tip KPIs)
 *   - fetchBusinessProfile (venue timezone only)
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
  fetchBusinessProfile,
  type ActivityEventSource,
  type BusinessActivityFeedItem,
} from "../lib/api";
import {
  activityFilterToApiSource,
  type ActivityCenterFilter,
} from "../lib/activityCenterFilters";
import { setBusinessActivitySearchSnapshot } from "../lib/businessActivitySearchSnapshot";
import {
  DEFAULT_BUSINESS_TIMEZONE,
  isWithinVenueLocalDay,
  resolveBusinessTimezone,
  setCachedBusinessVenueTimezone,
} from "../lib/businessVenueTime";
import { shouldProcessRealtimeEvent } from "../lib/realtime/realtimeEventDedupe";
import { subscribeActivityCreated } from "../lib/realtime/subscribeActivityCreated";
import { useRealtimeReconnect } from "../lib/realtime/useRealtimeReconnect";
import { useDashboardTabRefocus } from "./useDashboardTabRefocus";
import { useSocket, useDeferSocketConnect } from "./useSocket";

/** @deprecated Prefer ActivityCenterFilter — kept for type aliases. */
export type ActivitySourceFilter = ActivityEventSource | "all";

export type { ActivityCenterFilter };

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

export function matchesActivityFilter(
  item: BusinessActivityFeedItem,
  filter: ActivityCenterFilter,
  timeZone: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "today") return isWithinVenueLocalDay(item.occurredAt, timeZone);
  return item.source === filter;
}

/** @deprecated Use matchesActivityFilter */
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
  filter: ActivityCenterFilter;
};

/**
 * Activity Center feed — REST SSOT + activity.created only.
 * Filter changes apply locally from the in-memory pool first, then soft-sync the API.
 */
export function useActivityCenterFeed({ enabled, businessId, filter }: UseActivityCenterFeedOptions) {
  const [pool, setPool] = useState<BusinessActivityFeedItem[]>([]);
  const [cursorsByApiSource, setCursorsByApiSource] = useState<
    Partial<Record<"all" | ActivityEventSource, string | null>>
  >({});
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [venueTimezone, setVenueTimezone] = useState(DEFAULT_BUSINESS_TIMEZONE);

  const filterRef = useRef(filter);
  filterRef.current = filter;
  const timezoneRef = useRef(venueTimezone);
  timezoneRef.current = venueTimezone;
  const syncInFlightRef = useRef<Set<string>>(new Set());
  const bootstrappedRef = useRef(false);

  const socketReady = useDeferSocketConnect(enabled);
  const { socket, connected } = useSocket(socketReady);

  const items = useMemo(
    () => pool.filter((row) => matchesActivityFilter(row, filter, venueTimezone)),
    [pool, filter, venueTimezone],
  );

  const apiSource = activityFilterToApiSource(filter);
  const nextCursor = cursorsByApiSource[apiSource] ?? null;

  const hasMore = useMemo(() => {
    if (!nextCursor) return false;
    if (filter !== "today") return true;
    const oldest = pool.length > 0 ? pool[pool.length - 1] : null;
    if (!oldest) return true;
    return isWithinVenueLocalDay(oldest.occurredAt, venueTimezone);
  }, [nextCursor, filter, pool, venueTimezone]);

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

  const syncApiSource = useCallback(
    async (
      target: "all" | ActivityEventSource,
      opts?: { soft?: boolean; replacePool?: boolean },
    ) => {
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
        setCursorsByApiSource((prev) => ({ ...prev, [target]: result.nextCursor }));
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
    await syncApiSource(activityFilterToApiSource(filterRef.current), { soft: true });
  }, [enabled, syncApiSource]);

  const loadOlder = useCallback(async () => {
    if (!enabled || isLoadingOlder) return;
    const target = activityFilterToApiSource(filter);
    const cursor = cursorsByApiSource[target];
    if (!cursor) return;
    setIsLoadingOlder(true);
    try {
      const result = await fetchBusinessActivity({
        limit: PAGE_SIZE,
        cursor,
        source: target,
      });
      setPool((prev) => mergeById(prev, result.items, "append"));
      setCursorsByApiSource((prev) => ({ ...prev, [target]: result.nextCursor }));
    } catch {
      // Soft fail
    } finally {
      setIsLoadingOlder(false);
    }
  }, [enabled, isLoadingOlder, cursorsByApiSource, filter]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const profile = await fetchBusinessProfile({ silent: true });
        if (cancelled) return;
        const tz = resolveBusinessTimezone(profile.timezone);
        setCachedBusinessVenueTimezone(tz);
        setVenueTimezone(tz);
      } catch {
        // Keep default venue TZ
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setPool([]);
      setCursorsByApiSource({});
      setIsInitialLoading(false);
      bootstrappedRef.current = false;
      return;
    }
    void (async () => {
      await syncApiSource("all", { soft: false, replacePool: true });
      const active = activityFilterToApiSource(filterRef.current);
      if (active !== "all") {
        void syncApiSource(active, { soft: true });
      }
    })();
  }, [enabled, syncApiSource]);

  const prevFilterRef = useRef(filter);
  useEffect(() => {
    if (!enabled || !bootstrappedRef.current) return;
    if (prevFilterRef.current === filter) return;
    prevFilterRef.current = filter;
    const target = activityFilterToApiSource(filter);
    void syncApiSource(target, { soft: true });
  }, [enabled, filter, syncApiSource]);

  useEffect(() => {
    if (!socket || !enabled) return;
    return subscribeActivityCreated(socket, (item, meta) => {
      const dedupeId = meta?.eventId ?? item.id;
      if (!shouldProcessRealtimeEvent(dedupeId)) return;
      if (!shouldProcessRealtimeEvent(`activity-row:${item.id}`)) return;
      if (businessId && meta?.businessId && meta.businessId !== businessId) return;
      setPool((prev) => mergeById(prev, [item], "prepend"));
      if (matchesActivityFilter(item, filterRef.current, timezoneRef.current)) {
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

  useEffect(() => {
    if (!enabled) {
      setBusinessActivitySearchSnapshot([]);
      return;
    }
    setBusinessActivitySearchSnapshot(pool);
  }, [enabled, pool]);

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
    venueTimezone,
  };
}
