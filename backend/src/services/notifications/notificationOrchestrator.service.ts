import type { NotificationPriority } from "@prisma/client";
import { localizeNotificationPayload } from "../../notifications/notificationI18n.js";
import { resolveUserPreferredLocale } from "../../emails/i18nEmail.js";
import { prisma } from "../../prisma.js";
import { sendLocalizedUserNotificationEmail } from "../localizedNotificationEmail.service.js";
import { employeeTipEmailCopy } from "./employeeTipNotificationPrefs.js";
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
  /**
   * Tip email uses a short private message. In-app and push keep the normal template.
   * Only the employee tip path sets this.
   */
  emailPrivacy?: "employee_tip";
  /** Browser push for an employee tip omits guest name and amount. */
  pushPrivacy?: "employee_tip";
};

const DEFAULT_CHANNELS: Record<DeliveryChannel, boolean> = {
  in_app: true,
  push: true,
  email: false,
};

/** Hidden dedupe rows must not keep guest identity or payment amounts. */
function metadataForHiddenEmployeeTip(metadata: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...metadata, inboxHidden: true };
  delete next.customerName;
  delete next.amount;
  delete next.templateParams;
  const template = next.localeTemplate;
  if (template && typeof template === "object") {
    const copy = { ...(template as Record<string, unknown>) };
    delete copy.params;
    next.localeTemplate = copy;
  }
  return next;
}

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
  const wantsInbox = channels.includes("in_app");
  const wantsSideChannel = channels.includes("push") || channels.includes("email");
  if (!wantsInbox && !wantsSideChannel) {
    return { notification: null, skipped: true };
  }

  // A hidden anchor keeps the existing userId+dedupeKey uniqueness when the
  // employee turned the inbox off but still wants push or email. Duplicate
  // webhooks then skip every channel. The anchor is not an inbox item.
  notification = await createInboxNotification({
    userId: input.userId,
    type: wantsInbox ? deliveryPayload.type : "delivery_anchor",
    title: wantsInbox ? deliveryPayload.title : "CareTip",
    message: wantsInbox ? deliveryPayload.body : "Delivery recorded.",
    metadata: wantsInbox
      ? metadata
      : input.emailPrivacy === "employee_tip" || input.pushPrivacy === "employee_tip"
        ? metadataForHiddenEmployeeTip(metadata)
        : { ...metadata, inboxHidden: true },
    priority: input.priority ?? "normal",
    channels,
    dedupeKey,
    visibleInInbox: wantsInbox,
  });
  if (!notification) return { notification: null, skipped: true };

  if (wantsInbox) {
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
    console.info("[notifications] delivered", {
      notificationId: notification.id,
      type: notification.type,
      userId: input.userId,
      unreadCount: unread,
      channels,
    });
  }

  if (channels.includes("push")) {
    const privatePush =
      input.pushPrivacy === "employee_tip"
        ? employeeTipEmailCopy(resolveUserPreferredLocale(user?.preferredLocale) === "de" ? "de" : "en")
        : null;
    const pushMeta: Record<string, string> = {};
    for (const [key, value] of Object.entries(deliveryPayload.metadata ?? {})) {
      if (typeof value === "string") pushMeta[key] = value;
    }
    if (privatePush) {
      delete pushMeta.customerName;
      delete pushMeta.amount;
    }
    if (notification?.id) pushMeta.notificationId = notification.id;
    const pushPayload = {
      ...(privatePush
        ? { ...deliveryPayload, title: privatePush.title, body: privatePush.bodyText }
        : deliveryPayload),
      metadata: pushMeta,
    };
    void sendNotification(input.userId, pushPayload, {
      bypassPreferences: input.bypassPreferences,
      dedupeKey: `push:${dedupeKey}`,
    }).catch((err) => {
      logServerError("notifications.deliverUserNotification.push", err);
    });
  }

  if (channels.includes("email")) {
    if (user?.email) {
      const privateEmail =
        input.emailPrivacy === "employee_tip"
          ? employeeTipEmailCopy(resolveUserPreferredLocale(user.preferredLocale) === "de" ? "de" : "en")
          : null;
      void sendLocalizedUserNotificationEmail({
        to: user.email,
        userId: input.userId,
        preferredLocale: user.preferredLocale,
        title: privateEmail?.title ?? deliveryPayload.title,
        bodyText: privateEmail?.bodyText ?? deliveryPayload.body,
        actionUrl: deliveryPayload.url ?? null,
      })
        .then((result) => {
          console.info("[notifications] email", {
            notificationId: notification?.id ?? null,
            type: deliveryPayload.type,
            userId: input.userId,
            accepted: result.accepted,
            outcome: result.outcome,
            messageId: result.messageId ?? null,
          });
        })
        .catch((err) => {
          logServerError("notifications.deliverUserNotification.email", err);
        });
    }
  }

  return { notification: wantsInbox ? notification : null, skipped: false };
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
