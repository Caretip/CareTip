import type { NotificationPriority, Prisma } from "@prisma/client";
import type { EmailLocale } from "../../emails/i18nEmail.js";
import { resolveUserPreferredLocale } from "../../emails/i18nEmail.js";
import {
  localizeNotificationPayload,
  type NotificationTemplate,
} from "../../notifications/notificationI18n.js";
import { inferNotificationTemplate } from "../../notifications/notificationTemplateInfer.js";
import { prisma } from "../../prisma.js";
import { sanitizeLikeContainsSearch } from "../../utils/likeSearch.js";

const DEDUPE_WINDOW_MS = 60_000;
/** Login alerts — same user + device fingerprint within this window is one event. */
export const LOGIN_NOTIFICATION_DEDUPE_MS = 5 * 60 * 1000;

export type InboxNotificationDto = {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  priority: NotificationPriority;
  channels: string[];
  read: boolean;
  readAt: string | null;
  createdAt: string;
  url: string | null;
};

function metadataUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const url = (metadata as Record<string, unknown>).url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function parseLocaleTemplate(metadata: unknown): NotificationTemplate | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const raw = (metadata as Record<string, unknown>).localeTemplate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || !obj.id.trim()) return undefined;
  // Incomplete templates (id without usable params) must not enter render —
  // renderNotificationTemplate assumes params for most ids and would throw.
  if ("params" in obj) {
    if (obj.params == null || typeof obj.params !== "object" || Array.isArray(obj.params)) {
      return undefined;
    }
  }
  return raw as NotificationTemplate;
}

function resolveTemplate(
  row: { type: string; title: string; message: string; metadata: unknown },
): NotificationTemplate | undefined {
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  return (
    parseLocaleTemplate(row.metadata) ??
    inferNotificationTemplate({
      type: row.type,
      title: row.title,
      message: row.message,
      metadata: meta,
      url: metadataUrl(meta),
    })
  );
}

function localizedCopy(
  row: { type: string; title: string; message: string; metadata: unknown },
  locale: EmailLocale,
): { title: string; message: string } {
  const template = resolveTemplate(row);
  if (!template) return { title: row.title, message: row.message };
  try {
    const copy = localizeNotificationPayload(locale, {
      title: row.title,
      body: row.message,
      localeTemplate: template,
    });
    return {
      title: copy.title || row.title,
      message: copy.body || row.message,
    };
  } catch {
    // Never fail the whole inbox list because one row's template is corrupt.
    return { title: row.title, message: row.message };
  }
}

export function resolveNotificationLocale(
  localeParam: string | undefined,
  preferredLocale: string | null | undefined,
): EmailLocale {
  if (localeParam === "en" || localeParam === "de") return localeParam;
  return resolveUserPreferredLocale(preferredLocale);
}

export function toInboxDto(
  row: {
    id: string;
    type: string;
    title: string;
    message: string;
    metadata: unknown;
    priority: NotificationPriority;
    channels: string[];
    readAt: Date | null;
    createdAt: Date;
  },
  locale?: EmailLocale,
): InboxNotificationDto {
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const localized = locale
    ? localizedCopy(
        { type: row.type, title: row.title, message: row.message, metadata: row.metadata },
        locale,
      )
    : { title: row.title, message: row.message };
  return {
    id: row.id,
    type: row.type,
    title: localized.title,
    message: localized.message,
    metadata: meta,
    priority: row.priority,
    channels: row.channels,
    read: row.readAt != null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    url: metadataUrl(meta),
  };
}

export async function findRecentDuplicateNotification(
  userId: string,
  dedupeKey: string,
  windowMs: number = DEDUPE_WINDOW_MS,
): Promise<{ id: string } | null> {
  const since = new Date(Date.now() - windowMs);
  return prisma.notification.findFirst({
    where: { userId, dedupeKey, createdAt: { gte: since } },
    select: { id: true },
  });
}

export async function createInboxNotification(input: {
  userId: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  priority?: NotificationPriority;
  channels: string[];
  dedupeKey?: string;
}): Promise<InboxNotificationDto | null> {
  const title = input.title.trim();
  const message = input.message.trim();
  if (!title || !message) return null;

  if (input.dedupeKey) {
    const windowMs =
      input.type === "new_login" ? LOGIN_NOTIFICATION_DEDUPE_MS : DEDUPE_WINDOW_MS;
    const dup = await findRecentDuplicateNotification(input.userId, input.dedupeKey, windowMs);
    if (dup) return null;
  }

  const metadata = (input.metadata ?? {}) as Prisma.InputJsonValue;

  try {
    const row = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title,
        message,
        metadata,
        priority: input.priority ?? "normal",
        channels: input.channels,
        dedupeKey: input.dedupeKey ?? null,
      },
    });
    return toInboxDto(row);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "P2002" && input.dedupeKey) return null;
    throw err;
  }
}

const SUPPORT_TYPES = [
  "support_ticket_created",
  "support_ticket_reply",
  "support_ticket_status",
] as const;

export async function listUserNotifications(
  userId: string,
  options?: {
    limit?: number;
    cursor?: string;
    unreadOnly?: boolean;
    /** `support` = only support ticket alerts; `other` = exclude them */
    kind?: "support" | "other";
    search?: string;
    supportStatus?: string;
    locale?: EmailLocale;
  },
): Promise<{ items: InboxNotificationDto[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100);
  const search = sanitizeLikeContainsSearch(options?.search);
  const supportStatus = options?.supportStatus?.trim().toUpperCase();

  const rows = await prisma.notification.findMany({
    where: {
      userId,
      ...(options?.unreadOnly ? { readAt: null } : {}),
      ...(options?.kind === "support"
        ? { type: { in: [...SUPPORT_TYPES] } }
        : options?.kind === "other"
          ? { type: { notIn: [...SUPPORT_TYPES] } }
          : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { message: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(supportStatus
        ? {
            metadata: {
              path: ["status"],
              equals: supportStatus,
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map((row) => {
    try {
      return toInboxDto(row, options?.locale);
    } catch {
      return toInboxDto(row);
    }
  });
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationRead(
  userId: string,
  notificationId: string,
  locale?: EmailLocale,
): Promise<InboxNotificationDto | null> {
  const row = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (row.count === 0) {
    const existing = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    return existing ? toInboxDto(existing, locale) : null;
  }
  const updated = await prisma.notification.findUnique({ where: { id: notificationId } });
  return updated ? toInboxDto(updated, locale) : null;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function deleteUserNotification(
  userId: string,
  notificationId: string,
): Promise<{ deleted: boolean; unreadCount: number }> {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true },
  });
  if (!existing) {
    return { deleted: false, unreadCount: await getUnreadNotificationCount(userId) };
  }
  await prisma.notification.delete({ where: { id: notificationId } });
  return { deleted: true, unreadCount: await getUnreadNotificationCount(userId) };
}
