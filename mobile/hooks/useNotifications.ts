import { useEffect } from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deleteNotification,
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/services/api/notificationsService";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { useSocket } from "@/components/providers/SocketProvider";
import { syncOsNotificationBadge } from "@/utils/notificationBadge";

export function useUnreadNotificationCount(enabled = true) {
  const { connected } = useSocket();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const query = useQuery({
    queryKey: keys.notificationUnread,
    queryFn: fetchUnreadNotificationCount,
    enabled: Boolean(userId) && enabled,
    /** Prefer Socket.IO invalidation; poll only when disconnected. */
    refetchInterval: connected ? false : 120_000,
  });

  useEffect(() => {
    if (!enabled || !userId || typeof query.data !== "number") return;
    void syncOsNotificationBadge(query.data);
  }, [enabled, userId, query.data]);

  return query;
}

export function useNotificationsFeed(search = "") {
  const queryClient = useQueryClient();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();

  const query = useInfiniteQuery({
    queryKey: [...keys.notifications, search] as const,
    queryFn: ({ pageParam }) =>
      fetchNotifications({
        limit: 30,
        cursor: pageParam ?? null,
        q: search.trim() || undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(userId),
  });

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: keys.notifications });
      await queryClient.cancelQueries({ queryKey: keys.notificationUnread });
      const prevUnread = queryClient.getQueryData<number>(keys.notificationUnread);
      if (typeof prevUnread === "number") {
        queryClient.setQueryData(keys.notificationUnread, Math.max(0, prevUnread - 1));
        void syncOsNotificationBadge(Math.max(0, prevUnread - 1));
      }
      queryClient.setQueriesData({ queryKey: keys.notifications }, (old: unknown) => {
        if (!old || typeof old !== "object" || !("pages" in old)) return old;
        const data = old as {
          pages: Array<{ items: Array<{ id: string; readAt?: string | null }> }>;
        };
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item,
            ),
          })),
        };
      });
      return { prevUnread };
    },
    onError: (_err, _id, ctx) => {
      if (typeof ctx?.prevUnread === "number") {
        queryClient.setQueryData(keys.notificationUnread, ctx.prevUnread);
        void syncOsNotificationBadge(ctx.prevUnread);
      }
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
      void queryClient.invalidateQueries({ queryKey: keys.notificationUnread });
    },
  });

  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: keys.notificationUnread });
      const prevUnread = queryClient.getQueryData<number>(keys.notificationUnread);
      queryClient.setQueryData(keys.notificationUnread, 0);
      void syncOsNotificationBadge(0);
      return { prevUnread };
    },
    onError: (_err, _v, ctx) => {
      if (typeof ctx?.prevUnread === "number") {
        queryClient.setQueryData(keys.notificationUnread, ctx.prevUnread);
        void syncOsNotificationBadge(ctx.prevUnread);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
      void queryClient.invalidateQueries({ queryKey: keys.notificationUnread });
    },
  });

  const remove = useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
      void queryClient.invalidateQueries({ queryKey: keys.notificationUnread });
    },
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return {
    ...query,
    items,
    markRead,
    markAllRead,
    remove,
  };
}
