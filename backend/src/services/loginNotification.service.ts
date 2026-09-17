import { createHash } from "node:crypto";
import type { Request } from "express";
import { prisma } from "../prisma.js";
import { resolveUserPreferredLocale, type EmailLocale } from "../emails/i18nEmail.js";
import { sendNewLoginAlertEmail } from "./loginAlertEmail.service.js";
import { onLoginSecurityAlert } from "./push/notification.triggers.js";
import { LOGIN_NOTIFICATION_DEDUPE_MS } from "./notifications/notificationInbox.service.js";
import { effectiveNotifyNewLogin } from "./notifications/userNotificationSettingsDefaults.js";

const recentLoginNotifications = new Map<string, number>();

export function buildLoginDeviceFingerprint(
  ip: string | null | undefined,
  userAgent: string | null | undefined,
): string {
  const payload = `${(ip ?? "").trim().toLowerCase()}|${(userAgent ?? "").trim().slice(0, 512)}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function loginDedupeKey(userId: string, deviceFingerprint: string): string {
  return `login:${userId}:${deviceFingerprint}`;
}

function shouldSkipDuplicateLoginNotification(userId: string, deviceFingerprint: string): boolean {
  const key = loginDedupeKey(userId, deviceFingerprint);
  const now = Date.now();
  const last = recentLoginNotifications.get(key);
  if (last != null && now - last < LOGIN_NOTIFICATION_DEDUPE_MS) {
    return true;
  }
  recentLoginNotifications.set(key, now);
  if (recentLoginNotifications.size > 10_000) {
    for (const [k, ts] of recentLoginNotifications) {
      if (now - ts > LOGIN_NOTIFICATION_DEDUPE_MS) recentLoginNotifications.delete(k);
    }
  }
  return false;
}

/** New device when the user has prior login notifications but not from this fingerprint. */
async function isSuspiciousLogin(userId: string, deviceFingerprint: string): Promise<boolean> {
  const priorLogin = await prisma.notification.findFirst({
    where: { userId, type: "new_login" },
    select: { id: true },
  });
  if (!priorLogin) return false;

  const sameDevice = await prisma.notification.findFirst({
    where: {
      userId,
      type: "new_login",
      metadata: {
        path: ["deviceFingerprint"],
        equals: deviceFingerprint,
      },
    },
    select: { id: true },
  });
  return sameDevice == null;
}

export function extractLoginRequestContext(req: Request): {
  ip: string | null;
  userAgent: string;
} {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    null;
  const userAgent = String(req.headers["user-agent"] ?? "");
  return { ip, userAgent };
}

export type PostLoginNotificationInput = {
  userId: string;
  email: string;
  ip: string | null;
  userAgent: string;
  explicitLocale?: string | null;
  clientTimeZone?: string | null;
};

/**
 * Single login → at most one email + one inbox record (5-minute idempotency per user/device).
 * Normal login: "New sign in" email. New device: "Sign-in activity" security alert email.
 * Missing UserSettings row uses schema defaults (notifyNewLogin = true).
 */
export async function handlePostLoginNotifications(input: PostLoginNotificationInput): Promise<void> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId: input.userId },
    select: { notifyNewLogin: true },
  });
  if (!effectiveNotifyNewLogin(settings)) return;

  const deviceFingerprint = buildLoginDeviceFingerprint(input.ip, input.userAgent);
  if (shouldSkipDuplicateLoginNotification(input.userId, deviceFingerprint)) {
    return;
  }

  const suspicious = await isSuspiciousLogin(input.userId, deviceFingerprint);

  const userRow = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { preferredLocale: true },
  });
  const locale: EmailLocale = resolveUserPreferredLocale(
    input.explicitLocale ?? userRow?.preferredLocale ?? null,
  );

  await sendNewLoginAlertEmail({
    to: input.email,
    userId: input.userId,
    ip: input.ip,
    userAgent: input.userAgent,
    explicitLocale: input.explicitLocale,
    timeZone: input.clientTimeZone,
    variant: suspicious ? "suspicious" : "normal",
  });

  onLoginSecurityAlert(input.userId, {
    deviceFingerprint,
    suspicious,
    dedupeKey: loginDedupeKey(input.userId, deviceFingerprint),
    locale,
  });
}
