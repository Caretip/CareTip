import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBusinessActivity } from "@/services/api/activityService";
import { fetchBusinessProfile } from "@/services/api/businessService";
import type { ActivityCenterFilter, BusinessActivityFeedItem } from "@/types/activity";
import { isWithinVenueLocalDay, resolveBusinessTimezone } from "@/utils/businessVenueTime";
import { friendlyErrorMessage } from "@/utils/friendlyError";

const PAGE_SIZE = 30;
const MAX_IN_MEMORY = 120;

function activityFilterToApiSource(filter: ActivityCenterFilter): "TIPS" | "QR" | "PAYMENTS" | "all" {
  if (filter === "today" || filter === "all") return "all";
  return filter;
}

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

function matchesActivityFilter(
  item: BusinessActivityFeedItem,
  filter: ActivityCenterFilter,
  timeZone: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "today") return isWithinVenueLocalDay(item.occurredAt, timeZone);
  return item.source === filter;
}

export function useActivityCenterFeed(enabled: boolean) {
  const [filter, setFilter] = useState<ActivityCenterFilter>("all");
  const [pool, setPool] = useState<BusinessActivityFeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [venueTimezone, setVenueTimezone] = useState(resolveBusinessTimezone());
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorsRef = useRef<Record<string, string | null>>({});

  const items = useMemo(
    () => pool.filter((item) => matchesActivityFilter(item, filter, venueTimezone)),
    [pool, filter, venueTimezone],
  );

  const syncSource = useCallback(
    async (sourceKey: string, apiSource: ReturnType<typeof activityFilterToApiSource>, replacePool = false) => {
      const result = await fetchBusinessActivity({
        limit: PAGE_SIZE,
        source: apiSource,
      });
      cursorsRef.current[sourceKey] = result.nextCursor;
      setNextCursor(result.nextCursor);
      setPool((prev) => mergeById(prev, result.items, replacePool ? "replace" : "prepend"));
    },
    [],
  );

  const bootstrap = useCallback(async () => {
    setError(null);
    try {
      const profile = await fetchBusinessProfile();
      const tz = resolveBusinessTimezone(
        typeof profile.timezone === "string" ? profile.timezone : null,
      );
      setVenueTimezone(tz);
      await syncSource("all", "all", true);
      if (filter !== "all") {
        await syncSource(filter, activityFilterToApiSource(filter));
      }
    } catch (e) {
      setError(friendlyErrorMessage(e, "Failed to load activity"));
    } finally {
      setIsInitialLoading(false);
    }
  }, [filter, syncSource]);

  useEffect(() => {
    if (!enabled) return;
    void bootstrap();
  }, [enabled, bootstrap]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await syncSource("all", "all", true);
      if (filter !== "all") {
        await syncSource(filter, activityFilterToApiSource(filter));
      }
    } catch (e) {
      setError(friendlyErrorMessage(e, "Failed to refresh"));
    } finally {
      setIsRefreshing(false);
    }
  }, [filter, syncSource]);

  const loadOlder = useCallback(async () => {
    const sourceKey = filter === "today" ? "all" : filter;
    const cursor = cursorsRef.current[sourceKey] ?? nextCursor;
    if (!cursor || isLoadingOlder) return;

    setIsLoadingOlder(true);
    try {
      const result = await fetchBusinessActivity({
        limit: PAGE_SIZE,
        cursor,
        source: activityFilterToApiSource(filter),
      });
      cursorsRef.current[sourceKey] = result.nextCursor;
      setNextCursor(result.nextCursor);
      setPool((prev) => mergeById(prev, result.items, "append"));
    } catch (e) {
      setError(friendlyErrorMessage(e, "Failed to load more"));
    } finally {
      setIsLoadingOlder(false);
    }
  }, [filter, isLoadingOlder, nextCursor]);

  const hasMore = useMemo(() => {
    const sourceKey = filter === "today" ? "all" : filter;
    const cursor = cursorsRef.current[sourceKey] ?? nextCursor;
    if (!cursor) return false;
    if (filter === "today" && items.length > 0) {
      const oldest = items[items.length - 1];
      if (oldest && !isWithinVenueLocalDay(oldest.occurredAt, venueTimezone)) {
        return false;
      }
    }
    return Boolean(cursor);
  }, [filter, items, nextCursor, venueTimezone]);

  const changeFilter = useCallback(
    async (next: ActivityCenterFilter) => {
      setFilter(next);
      if (next !== "all" && next !== "today") {
        try {
          await syncSource(next, activityFilterToApiSource(next));
        } catch {
          /* pool filter still applies */
        }
      }
    },
    [syncSource],
  );

  return {
    filter,
    setFilter: changeFilter,
    items,
    venueTimezone,
    isInitialLoading,
    isRefreshing,
    isLoadingOlder,
    error,
    hasMore,
    refresh,
    loadOlder,
  };
}
