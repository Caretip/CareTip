export type InboxNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  priority: "normal" | "high";
  channels: string[];
  read: boolean;
  readAt: string | null;
  createdAt: string;
  url: string | null;
};

export type NotificationsListResult = {
  items: InboxNotification[];
  nextCursor: string | null;
  unreadCount: number;
};

export type NotificationListParams = {
  limit?: number;
  cursor?: string | null;
  unreadOnly?: boolean;
  q?: string;
};
