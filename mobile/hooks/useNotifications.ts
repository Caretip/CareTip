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

export function useUnreadNotificationCount(enabled = true) {
  const { connected } = useSocket();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  return useQuery({
    queryKey: keys.notificationUnread,
    queryFn: fetchUnreadNotificationCount,
    enabled: Boolean(userId) && enabled,
    /** Prefer Socket.IO invalidation; poll only when disconnected. */
    refetchInterval: connected ? false : 120_000,
  });
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
      void queryClient.invalidateQueries({ queryKey: keys.notificationUnread });
    },
  });

  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
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
