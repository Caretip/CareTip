import type { NotificationPriority } from "@prisma/client";
import { localizeNotificationPayload } from "../../notifications/notificationI18n.js";
import { prisma } from "../../prisma.js";
import { sendLocalizedUserNotificationEmail } from "../localizedNotificationEmail.service.js";
import { sendNotification } from "../push/notification.service.js";
import type { NotificationPayload, NotificationType } from "../push/notification.types.js";
import {
  createInboxNotification,
  getUnreadNotificationCount,
  type InboxNotificationDto,
} from "./notificationInbox.service.js";
import {
  emitNotificationCreated,
  emitNotificationUnreadCount,
} from "../../socket/socketEmitters.js";
import { logServerError } from "../../utils/httpErrors.js";

export type DeliveryChannel = "in_app" | "push" | "email";

export type DeliverNotificationInput = {
  userId: string;
  payload: NotificationPayload;
  channels?: Partial<Record<DeliveryChannel, boolean>>;
  priority?: NotificationPriority;
  dedupeKey?: string;
  bypassPreferences?: boolean;
};

const DEFAULT_CHANNELS: Record<DeliveryChannel, boolean> = {
  in_app: true,
  push: true,
  email: false,
};

function resolveChannels(
  type: NotificationType,
  overrides?: Partial<Record<DeliveryChannel, boolean>>,
): DeliveryChannel[] {
  const base = { ...DEFAULT_CHANNELS };
  if (type === "new_login") base.email = true;
  const merged = { ...base, ...overrides };
  return (Object.keys(merged) as DeliveryChannel[]).filter((k) => merged[k]);
}

export async function deliverUserNotification(
  input: DeliverNotificationInput,
): Promise<{ notification: InboxNotificationDto | null; skipped: boolean }> {
  const channels = resolveChannels(input.payload.type, input.channels);
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, preferredLocale: true },
  });

  const localized = localizeNotificationPayload(user?.preferredLocale, {
    title: input.payload.title,
    body: input.payload.body,
    localeTemplate: input.payload.localeTemplate,
  });

  const deliveryPayload = {
    ...input.payload,
    title: localized.title,
    body: localized.body,
  };

  const dedupeKey =
    input.dedupeKey ??
    `${deliveryPayload.type}:${input.userId}:${deliveryPayload.metadata?.entityId ?? deliveryPayload.title}`;

  const metadata: Record<string, unknown> = {
    ...(deliveryPayload.metadata ?? {}),
    ...(deliveryPayload.url ? { url: deliveryPayload.url } : {}),
    ...(input.payload.localeTemplate
      ? {
          localeTemplate: input.payload.localeTemplate,
          templateId: input.payload.localeTemplate.id,
          ...("params" in input.payload.localeTemplate && input.payload.localeTemplate.params
            ? { templateParams: input.payload.localeTemplate.params }
            : {}),
        }
      : {}),
  };

  let notification: InboxNotificationDto | null = null;

  if (channels.includes("in_app")) {
    notification = await createInboxNotification({
      userId: input.userId,
      type: deliveryPayload.type,
      title: deliveryPayload.title,
      message: deliveryPayload.body,
      metadata,
      priority: input.priority ?? "normal",
      channels,
      dedupeKey,
    });
    if (!notification) return { notification: null, skipped: true };

    const unread = await getUnreadNotificationCount(input.userId);
    const businessId =
      metadata && typeof metadata === "object" && "businessId" in metadata
        ? String((metadata as { businessId?: unknown }).businessId ?? "")
        : null;
    emitNotificationCreated(
      input.userId,
      { notification, unreadCount: unread },
      businessId && businessId.trim() ? businessId : null,
    );
    emitNotificationUnreadCount(input.userId, unread);
    if (process.env.NODE_ENV !== "production") {
      console.debug("[notifications] socket emit", {
        userId: input.userId,
        notificationId: notification.id,
        type: notification.type,
        unreadCount: unread,
      });
    }
  }

  if (channels.includes("push")) {
    const pushPayload =
      notification?.id
        ? {
            ...deliveryPayload,
            metadata: {
              ...(deliveryPayload.metadata ?? {}),
              notificationId: notification.id,
            },
          }
        : deliveryPayload;
    void sendNotification(input.userId, pushPayload, {
      bypassPreferences: input.bypassPreferences,
      dedupeKey: `push:${dedupeKey}`,
    }).catch((err) => {
      logServerError("notifications.deliverUserNotification.push", err);
    });
  }

  if (channels.includes("email")) {
    if (user?.email) {
      void sendLocalizedUserNotificationEmail({
        to: user.email,
        userId: input.userId,
        preferredLocale: user.preferredLocale,
        title: deliveryPayload.title,
        bodyText: deliveryPayload.body,
        actionUrl: deliveryPayload.url ?? null,
      }).catch(() => undefined);
    }
  }

  return { notification, skipped: false };
}

export async function deliverNotificationToUsers(
  userIds: string[],
  payload: NotificationPayload,
  options?: Omit<DeliverNotificationInput, "userId" | "payload"> & {
    dedupeKeyPrefix?: string;
  },
): Promise<{ delivered: number; skipped: number }> {
  const unique = [...new Set(userIds.filter(Boolean))];
  let delivered = 0;
  let skipped = 0;
  for (const userId of unique) {
    const dedupeKey = options?.dedupeKeyPrefix
      ? `${options.dedupeKeyPrefix}:${userId}`
      : options?.dedupeKey;
    const result = await deliverUserNotification({
      userId,
      payload,
      channels: options?.channels,
      priority: options?.priority,
      dedupeKey,
      bypassPreferences: options?.bypassPreferences,
    });
    if (result.skipped) skipped += 1;
    else delivered += 1;
  }
  return { delivered, skipped };
}
