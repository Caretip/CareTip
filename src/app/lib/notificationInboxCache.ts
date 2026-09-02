import type { InboxNotification } from "./api";
import {
  getPageSessionCache,
  invalidatePageSessionCacheByPrefix,
  peekPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_HIGH_MS,
} from "./pageSessionCache";

const INBOX_CACHE_PREFIX = "notifications:inbox:";

type InboxCachePayload = {
  items: InboxNotification[];
  unreadCount: number;
  nextCursor: string | null;
};

export function inboxSessionCacheKey(filterKey = "{}"): string {
  return `${INBOX_CACHE_PREFIX}${filterKey}`;
}

export function peekInboxSessionCache(
  filterKey = "{}",
): InboxCachePayload | null {
  return peekPageSessionCache<InboxCachePayload>(inboxSessionCacheKey(filterKey));
}

export function readInboxSessionCache(
  filterKey = "{}",
): InboxCachePayload | null {
  return getPageSessionCache<InboxCachePayload>(
    inboxSessionCacheKey(filterKey),
    PAGE_CACHE_TTL_HIGH_MS,
  );
}

export function writeInboxSessionCache(
  filterKey: string,
  payload: InboxCachePayload,
): void {
  setPageSessionCache(inboxSessionCacheKey(filterKey), payload);
}

/**
 * Keep the default (unfiltered) bell cache warm after optimistic mutations.
 * Drop filtered inbox keys — they reconcile on next fetch.
 */
export function patchDefaultInboxSessionCache(
  mutate: (payload: InboxCachePayload) => InboxCachePayload,
): void {
  const defaults = readInboxSessionCache("{}");
  invalidatePageSessionCacheByPrefix(INBOX_CACHE_PREFIX);
  if (defaults) {
    writeInboxSessionCache("{}", mutate(defaults));
  }
}

export function invalidateAllInboxSessionCaches(): void {
  invalidatePageSessionCacheByPrefix(INBOX_CACHE_PREFIX);
}
