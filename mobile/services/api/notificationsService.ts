import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { NotificationListParams, NotificationsListResult } from "@/types/notifications";

export async function fetchNotifications(
  params: NotificationListParams = {},
): Promise<NotificationsListResult> {
  const { data } = await apiClient.get<NotificationsListResult>(API_ENDPOINTS.notifications.list, {
    params: {
      limit: params.limit ?? 30,
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.unreadOnly ? { unreadOnly: "true" } : {}),
      ...(params.q?.trim() ? { q: params.q.trim() } : {}),
    },
  });
  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextCursor: data.nextCursor ?? null,
    unreadCount: data.unreadCount ?? 0,
  };
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const { data } = await apiClient.get<{ unreadCount: number }>(
    API_ENDPOINTS.notifications.unreadCount,
  );
  return data.unreadCount ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.patch(API_ENDPOINTS.notifications.read(id));
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post(API_ENDPOINTS.notifications.readAll);
}

export async function deleteNotification(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.notifications.delete(id));
}
