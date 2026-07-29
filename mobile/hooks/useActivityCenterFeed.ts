/**
 * Activity Center feed — REST SSOT + activity.created only (web parity).
 * GET /api/business/activity with per-source cursors; Today filter is client-side.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useSocket } from "@/components/providers/SocketProvider";
import { subscribeActivityCreated } from "@/lib/realtime/subscribeActivityCreated";
import { fetchBusinessActivity } from "@/services/api/activityService";
import { fetchBusinessProfile } from "@/services/api/businessService";
import { queryClient, queryKeys } from "@/services/api/queryClient";
import type { BusinessProfile } from "@/types/business";
import type {
  ActivityCenterFilter,
  ActivityEventSource,
  BusinessActivityFeedItem,
} from "@/types/activity";
import { activityFilterToApiSource } from "@/utils/activityCenterFilters";
import { isWithinVenueLocalDay, resolveBusinessTimezone } from "@/utils/businessVenueTime";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { shouldProcessRealtimeEvent } from "@/utils/realtimeEventDedupe";
import { useI18n } from "@/hooks/useI18n";

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

type UseActivityCenterFeedOptions = {
  enabled: boolean;
  businessId?: string | null;
};

export function useActivityCenterFeed({ enabled, businessId }: UseActivityCenterFeedOptions) {
  const { t } = useI18n();
  const [filter, setFilterState] = useState<ActivityCenterFilter>("all");
  const [pool, setPool] = useState<BusinessActivityFeedItem[]>([]);
  const [cursorsByApiSource, setCursorsByApiSource] = useState<
    Partial<Record<"all" | ActivityEventSource, string | null>>
  >({});
  const [venueTimezone, setVenueTimezone] = useState(resolveBusinessTimezone());
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filterRef = useRef(filter);
  filterRef.current = filter;
  const timezoneRef = useRef(venueTimezone);
  timezoneRef.current = venueTimezone;
  const syncInFlightRef = useRef<Set<string>>(new Set());
  const bootstrappedRef = useRef(false);

  const { socket, connected } = useSocket();

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
      else if (!soft) setIsRefreshing(true);
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
      } catch (e) {
        if (!bootstrappedRef.current) {
          setError(friendlyErrorMessage(e, t("activity.loadError"), t));
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
    setIsRefreshing(true);
    try {
      await syncApiSource(activityFilterToApiSource(filterRef.current), { soft: true });
    } finally {
      setIsRefreshing(false);
    }
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
    } catch (e) {
      setError(friendlyErrorMessage(e, t("activity.loadMoreError"), t));
    } finally {
      setIsLoadingOlder(false);
    }
  }, [enabled, isLoadingOlder, cursorsByApiSource, filter]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const cached = queryClient.getQueryData<BusinessProfile>(queryKeys.businessProfile);
        if (cached?.timezone) {
          if (cancelled) return;
          setVenueTimezone(
            resolveBusinessTimezone(
              typeof cached.timezone === "string" ? cached.timezone : null,
            ),
          );
          return;
        }
        const profile = await fetchBusinessProfile();
        if (cancelled) return;
        const tz = resolveBusinessTimezone(
          typeof profile.timezone === "string" ? profile.timezone : null,
        );
        setVenueTimezone(tz);
      } catch {
        /* keep default venue TZ */
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
    });
  }, [socket, enabled, businessId]);

  useEffect(() => {
    if (!enabled || connected) return;
    const id = setInterval(() => {
      void catchUp();
    }, DISCONNECTED_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, connected, catchUp]);

  useEffect(() => {
    if (!enabled) return;
    const onAppState = (next: AppStateStatus) => {
      if (next === "active") void catchUp();
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, [enabled, catchUp]);

  const changeFilter = useCallback((next: ActivityCenterFilter) => {
    setFilterState(next);
  }, []);

  return {
    filter,
    setFilter: changeFilter,
    items,
    venueTimezone,
    nextCursor,
    isInitialLoading,
    isRefreshing,
    isLoadingOlder,
    error,
    hasMore,
    refresh: catchUp,
    loadOlder,
  };
}
