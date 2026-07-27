import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  deleteNotification,
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/services/api/notificationsService";
import { queryKeys } from "@/services/api/queryClient";
import { useSocket } from "@/components/providers/SocketProvider";

export function useUnreadNotificationCount(enabled = true) {
  const { connected } = useSocket();
  return useQuery({
    queryKey: queryKeys.notificationUnread,
    queryFn: fetchUnreadNotificationCount,
    enabled,
    /** Prefer Socket.IO invalidation; poll only when disconnected. */
    refetchInterval: connected ? false : 120_000,
  });
}

export function useNotificationsFeed(search = "") {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: [...queryKeys.notifications, search] as const,
    queryFn: ({ pageParam }) =>
      fetchNotifications({
        limit: 30,
        cursor: pageParam ?? null,
        q: search.trim() || undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationUnread });
    },
  });

  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationUnread });
    },
  });

  const remove = useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationUnread });
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
