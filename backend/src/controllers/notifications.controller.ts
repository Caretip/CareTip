import type { Request, Response } from "express";
import { resolveRequestUserId } from "../middleware/auth.middleware.js";
import { prisma } from "../prisma.js";
import {
  deleteUserNotification,
  getUnreadNotificationCount,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  resolveNotificationLocale,
} from "../services/notifications/notificationInbox.service.js";
import { emitNotificationUnreadCount } from "../socket/socketEmitters.js";
import { clientSafeMessage, logServerError } from "../utils/httpErrors.js";

function userIdFromReq(req: Request): string | null {
  return resolveRequestUserId(req);
}

async function localeForRequest(req: Request, userId: string) {
  const localeParam = typeof req.query.locale === "string" ? req.query.locale.trim() : undefined;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferredLocale: true },
  });
  return resolveNotificationLocale(localeParam, user?.preferredLocale);
}

export async function listMine(req: Request, res: Response) {
  try {
    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const limit = Number(req.query.limit);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const unreadOnly = req.query.unreadOnly === "true" || req.query.unreadOnly === "1";

    const kind =
      req.query.kind === "support" || req.query.kind === "other"
        ? req.query.kind
        : undefined;
    const search = typeof req.query.q === "string" ? req.query.q : undefined;
    const supportStatus =
      typeof req.query.supportStatus === "string" ? req.query.supportStatus : undefined;

    const locale = await localeForRequest(req, userId);

    const result = await listUserNotifications(userId, {
      limit: Number.isFinite(limit) ? limit : 30,
      cursor,
      unreadOnly,
      kind,
      search,
      supportStatus,
      locale,
    });
    const unreadCount = await getUnreadNotificationCount(userId);
    return res.json({ ...result, unreadCount });
  } catch (err) {
    logServerError("notifications.listMine", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load notifications. Try again."),
    });
  }
}

export async function unreadCount(req: Request, res: Response) {
  try {
    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const count = await getUnreadNotificationCount(userId);
    return res.json({ unreadCount: count });
  } catch (err) {
    logServerError("notifications.unreadCount", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't load notification count."),
    });
  }
}

export async function markRead(req: Request, res: Response) {
  try {
    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: "Notification id is required" });

    const locale = await localeForRequest(req, userId);
    const notification = await markNotificationRead(userId, id, locale);
    if (!notification) return res.status(404).json({ message: "Notification not found" });

    const unreadCount = await getUnreadNotificationCount(userId);
    emitNotificationUnreadCount(userId, unreadCount);
    return res.json({ notification, unreadCount });
  } catch (err) {
    logServerError("notifications.markRead", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't update that notification."),
    });
  }
}

export async function markAllRead(req: Request, res: Response) {
  try {
    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const updated = await markAllNotificationsRead(userId);
    emitNotificationUnreadCount(userId, 0);
    return res.json({ updated, unreadCount: 0 });
  } catch (err) {
    logServerError("notifications.markAllRead", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't mark notifications as read."),
    });
  }
}

export async function deleteOne(req: Request, res: Response) {
  try {
    const userId = userIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: "Notification id is required" });

    const { deleted, unreadCount } = await deleteUserNotification(userId, id);
    if (!deleted) return res.status(404).json({ message: "Notification not found" });

    emitNotificationUnreadCount(userId, unreadCount);
    return res.json({ success: true, unreadCount });
  } catch (err) {
    logServerError("notifications.deleteOne", err);
    return res.status(500).json({
      message: clientSafeMessage(err, "We couldn't delete that notification."),
    });
  }
}
