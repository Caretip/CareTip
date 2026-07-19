import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchMyNotifications,
  fetchMyUnreadNotificationCount,
  deleteNotificationApi,
  markAllNotificationsReadApi,
  markNotificationReadApi,
  type InboxNotification,
} from "../lib/api";
import {
  localizeInboxNotification,
  localizeInboxNotifications,
} from "../lib/localizeInboxNotification";
import { isProtectedApiReady } from "../lib/authRestore";
import { isApiConnectivityError } from "../lib/errorMessages";
import { logClientError } from "../lib/clientLog";
import { useSocketInstance, useDeferSocketConnect } from "./useSocket";
import { trackNotificationRefetch } from "../lib/realtime/realtimeMetrics";
import {
  publishNotificationInboxPatch,
  subscribeNotificationInboxPatches,
} from "../lib/realtime/notificationInboxRealtime";
import { devSetHydrationPhase } from "../lib/dashboardDevDebug";
import {
  patchDefaultInboxSessionCache,
  readInboxSessionCache,
  writeInboxSessionCache,
} from "../lib/notificationInboxCache";

function setUnreadIfChanged(
  setUnreadCount: Dispatch<SetStateAction<number>>,
  next: number,
): void {
  setUnreadCount((prev) => (prev === next ? prev : next));
}

export type NotificationListFilters = {
  kind?: "support" | "other";
  q?: string;
  supportStatus?: string;
};

type UseNotificationsOptions = {
  /** Caller intends notifications when the user is signed in (role checks, etc.). */
  enabled: boolean;
  /** Fetch / keep list warm when true (panel open, inbox page). */
  loadList?: boolean;
  /** Server-side inbox filters (My Inbox page). */
  listFilters?: NotificationListFilters;
};

export function useNotifications({
  enabled,
  loadList = false,
  listFilters,
}: UseNotificationsOptions) {
  const { t, i18n } = useTranslation();
  const uiLocale: "en" | "de" = i18n.resolvedLanguage?.toLowerCase().startsWith("de") ? "de" : "en";
  const apiReady = isProtectedApiReady();
  const active = enabled && apiReady;
  const socketReady = useDeferSocketConnect(active);
  // Interest only — do not subscribe to socket status (avoids Bell re-renders on connect).
  useSocketInstance(socketReady);
  const [unreadCount, setUnreadCount] = useState(() => {
    const cached = readInboxSessionCache(JSON.stringify({}));
    return cached?.unreadCount ?? 0;
  });
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const prevLocaleRef = useRef(uiLocale);
  const itemsRef = useRef<InboxNotification[]>([]);
  const unreadCountRef = useRef(0);
  itemsRef.current = items;
  unreadCountRef.current = unreadCount;

  const refreshUnread = useCallback(async () => {
    if (!active) return;
    devSetHydrationPhase("notifications", "loading");
    try {
      trackNotificationRefetch();
      const { unreadCount: count } = await fetchMyUnreadNotificationCount();
      setUnreadIfChanged(setUnreadCount, count);
      devSetHydrationPhase("notifications", "ready");
    } catch (err) {
      if (!isApiConnectivityError(err)) {
        logClientError("useNotifications.refreshUnread", err);
      }
      devSetHydrationPhase("notifications", "error");
    }
  }, [active]);

  const filterKey = JSON.stringify(listFilters ?? {});

  const loadNotifications = useCallback(
    async (opts?: {
      append?: boolean;
      cursor?: string | null;
      reset?: boolean;
      /** Background warm — never flash a loading skeleton. */
      quiet?: boolean;
    }) => {
      if (!active) return;
      const cachedInbox = readInboxSessionCache(filterKey);
      const hasVisible = itemsRef.current.length > 0;
      const useCachedFirst =
        !opts?.append && !opts?.cursor && cachedInbox !== null && !hasVisible;

      if (useCachedFirst && cachedInbox) {
        setItems(localizeInboxNotifications(cachedInbox.items, t, i18n.language));
        setUnreadIfChanged(setUnreadCount, cachedInbox.unreadCount);
        setNextCursor(cachedInbox.nextCursor);
        setLoading(false);
        loadedRef.current = true;
      } else if (!opts?.quiet && (!hasVisible || opts?.append)) {
        setLoading(true);
      }

      try {
        const res = await fetchMyNotifications({
          limit: 25,
          cursor: opts?.cursor ?? undefined,
          kind: listFilters?.kind,
          q: listFilters?.q,
          supportStatus: listFilters?.supportStatus,
          locale: uiLocale,
        });
        setUnreadIfChanged(setUnreadCount, res.unreadCount);
        setNextCursor(res.nextCursor);
        const nextItems = localizeInboxNotifications(res.items, t, i18n.language);
        setItems((prev) =>
          opts?.append && !opts?.reset ? [...prev, ...nextItems] : nextItems,
        );
        if (!opts?.append && !opts?.cursor) {
          writeInboxSessionCache(filterKey, {
            items: res.items,
            unreadCount: res.unreadCount,
            nextCursor: res.nextCursor,
          });
        }
        loadedRef.current = true;
      } catch (err) {
        if (!isApiConnectivityError(err)) {
          logClientError("useNotifications.load", err);
        }
      } finally {
        setLoading(false);
      }
    },
    [active, filterKey, listFilters?.kind, listFilters?.q, listFilters?.supportStatus, uiLocale, t, i18n.language],
  );

  const loadNotificationsRef = useRef(loadNotifications);
  loadNotificationsRef.current = loadNotifications;

  const markRead = useCallback(
    async (id: string) => {
      const snapshotItems = itemsRef.current;
      const snapshotUnread = unreadCountRef.current;
      const target = snapshotItems.find((n) => n.id === id);
      if (target?.read) return;

      const readAt = new Date().toISOString();
      const wasUnread = target ? !target.read : snapshotUnread > 0;
      const nextUnread = wasUnread ? Math.max(0, snapshotUnread - 1) : snapshotUnread;

      publishNotificationInboxPatch({ type: "read", id, unreadCount: nextUnread, readAt });
      patchDefaultInboxSessionCache((cache) => ({
        ...cache,
        unreadCount: nextUnread,
        items: cache.items.map((n) =>
          n.id === id ? { ...n, read: true, readAt } : n,
        ),
      }));

      try {
        const res = await markNotificationReadApi(id, uiLocale);
        setUnreadIfChanged(setUnreadCount, res.unreadCount);
        const localized = localizeInboxNotification(res.notification, t, i18n.language);
        setItems((prev) =>
          prev.map((n) =>
            n.id === id ? { ...localized, read: true, readAt: res.notification.readAt } : n,
          ),
        );
        publishNotificationInboxPatch({
          type: "unread_count",
          unreadCount: res.unreadCount,
        });
      } catch (err) {
        logClientError("useNotifications.markRead", err);
        if (target) {
          publishNotificationInboxPatch({
            type: "restore",
            notification: target,
            unreadCount: snapshotUnread,
          });
        } else {
          publishNotificationInboxPatch({
            type: "unread_count",
            unreadCount: snapshotUnread,
          });
        }
      }
    },
    [uiLocale, t, i18n.language],
  );

  const markAllRead = useCallback(async () => {
    const snapshotItems = itemsRef.current;
    const snapshotUnread = unreadCountRef.current;
    if (snapshotUnread === 0 && snapshotItems.every((n) => n.read)) return;

    const readAt = new Date().toISOString();
    publishNotificationInboxPatch({ type: "read_all", unreadCount: 0, readAt });
    patchDefaultInboxSessionCache((cache) => ({
      ...cache,
      unreadCount: 0,
      items: cache.items.map((n) => ({
        ...n,
        read: true,
        readAt: n.readAt ?? readAt,
      })),
    }));

    try {
      const res = await markAllNotificationsReadApi();
      setUnreadIfChanged(setUnreadCount, res.unreadCount);
      publishNotificationInboxPatch({
        type: "unread_count",
        unreadCount: res.unreadCount,
      });
    } catch (err) {
      logClientError("useNotifications.markAllRead", err);
      publishNotificationInboxPatch({
        type: "snapshot",
        items: snapshotItems,
        unreadCount: snapshotUnread,
      });
    }
  }, []);

  const deleteNotification = useCallback(async (id: string) => {
    const snapshotItems = itemsRef.current;
    const snapshotUnread = unreadCountRef.current;
    const target = snapshotItems.find((n) => n.id === id);
    const nextUnread = Math.max(
      0,
      snapshotUnread - (target && !target.read ? 1 : 0),
    );

    publishNotificationInboxPatch({ type: "deleted", id, unreadCount: nextUnread });
    patchDefaultInboxSessionCache((cache) => ({
      ...cache,
      unreadCount: nextUnread,
      items: cache.items.filter((n) => n.id !== id),
    }));

    try {
      const res = await deleteNotificationApi(id);
      setUnreadIfChanged(setUnreadCount, res.unreadCount);
      publishNotificationInboxPatch({
        type: "unread_count",
        unreadCount: res.unreadCount,
      });
    } catch (err) {
      logClientError("useNotifications.deleteNotification", err);
      if (target) {
        publishNotificationInboxPatch({
          type: "restore",
          notification: target,
          unreadCount: snapshotUnread,
        });
      } else {
        publishNotificationInboxPatch({
          type: "unread_count",
          unreadCount: snapshotUnread,
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setUnreadCount(0);
      setItems([]);
      loadedRef.current = false;
      devSetHydrationPhase("notifications", "idle");
      return;
    }
    /* Fast badge — list fetch also returns unreadCount when it lands. */
    void refreshUnread();
  }, [active, refreshUnread]);

  /* Phase 1: closed bell — unread badge only; do not hydrate list into Bell state. */
  useEffect(() => {
    if (!active || loadList) return;
    const cached = readInboxSessionCache(filterKey);
    if (cached) {
      setUnreadIfChanged(setUnreadCount, cached.unreadCount);
    }
  }, [active, loadList, filterKey]);

  useEffect(() => {
    if (!active || !loadList) return;
    const cachedInbox = readInboxSessionCache(filterKey);
    if (cachedInbox) {
      setItems(localizeInboxNotifications(cachedInbox.items, t, i18n.language));
      setUnreadIfChanged(setUnreadCount, cachedInbox.unreadCount);
      setNextCursor(cachedInbox.nextCursor);
      loadedRef.current = true;
    }
    /* Keep any already-warmed list visible — never clear-to-empty on open. */
    void loadNotifications({ reset: true, quiet: itemsRef.current.length > 0 || Boolean(cachedInbox) });
  }, [active, loadList, loadNotifications, filterKey, t, i18n.language]);

  useEffect(() => {
    if (!active) return;

    return subscribeNotificationInboxPatches((patch) => {
      if (patch.type === "unread_count") {
        setUnreadIfChanged(setUnreadCount, patch.unreadCount);
        return;
      }
      if (patch.type === "read") {
        setUnreadIfChanged(setUnreadCount, patch.unreadCount);
        if (!loadList) return;
        setItems((prev) =>
          prev.map((n) =>
            n.id === patch.id ? { ...n, read: true, readAt: patch.readAt } : n,
          ),
        );
        return;
      }
      if (patch.type === "read_all") {
        setUnreadIfChanged(setUnreadCount, patch.unreadCount);
        if (!loadList) return;
        setItems((prev) =>
          prev.map((n) => ({
            ...n,
            read: true,
            readAt: n.readAt ?? patch.readAt,
          })),
        );
        return;
      }
      if (patch.type === "deleted") {
        setUnreadIfChanged(setUnreadCount, patch.unreadCount);
        if (!loadList) return;
        setItems((prev) => prev.filter((n) => n.id !== patch.id));
        return;
      }
      if (patch.type === "restore") {
        setUnreadIfChanged(setUnreadCount, patch.unreadCount);
        if (!loadList) return;
        setItems((prev) => {
          const localized = localizeInboxNotification(patch.notification, t, i18n.language);
          const idx = prev.findIndex((n) => n.id === localized.id);
          if (idx === -1) return [localized, ...prev].slice(0, 50);
          const next = [...prev];
          next[idx] = localized;
          return next;
        });
        return;
      }
      if (patch.type === "snapshot") {
        setUnreadIfChanged(setUnreadCount, patch.unreadCount);
        if (!loadList) return;
        setItems(localizeInboxNotifications(patch.items, t, i18n.language));
        return;
      }
      if (patch.type === "created") {
        if (typeof patch.unreadCount === "number") {
          setUnreadIfChanged(setUnreadCount, patch.unreadCount);
        }
        if (!loadList) return;
        const localized = localizeInboxNotification(patch.notification, t, i18n.language);
        setItems((prev) => {
          if (prev.some((n) => n.id === localized.id)) return prev;
          return [localized, ...prev].slice(0, 50);
        });
        return;
      }
      if (patch.type === "sync_request" && loadList && loadedRef.current) {
        void loadNotificationsRef.current({ reset: true, quiet: true });
      }
    });
  }, [active, loadList, t, i18n.language]);

  useEffect(() => {
    if (!active) return;
    setItems((prev) => (prev.length ? localizeInboxNotifications(prev, t, i18n.language) : prev));
  }, [active, i18n.language, t]);

  useEffect(() => {
    if (!active || !loadedRef.current) {
      prevLocaleRef.current = uiLocale;
      return;
    }
    if (prevLocaleRef.current === uiLocale) return;
    prevLocaleRef.current = uiLocale;
    void loadNotifications({ reset: true, quiet: true });
  }, [active, uiLocale, loadNotifications]);

  return {
    unreadCount,
    items,
    loading,
    nextCursor,
    connected: false,
    refreshUnread,
    loadNotifications,
    markRead,
    markAllRead,
    deleteNotification,
  };
}
