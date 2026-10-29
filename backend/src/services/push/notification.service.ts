import { prisma } from "../../prisma.js";
import { employeeTipChannelColumnsReady } from "../notifications/employeeTipChannelColumns.js";
import { isFcmConfigured } from "./fcmAdmin.js";
import { listPushTokensForUser } from "./deviceTokens.service.js";
import { logPush, sendWebPushMulticast, stringifyPushData } from "./pushSend.js";
import type {
  NotificationPayload,
  NotificationType,
  SendNotificationBatchResult,
  SendNotificationOptions,
  SendNotificationResult,
} from "./notification.types.js";

const DEDUPE_WINDOW_MS = 60_000;
const recentSendKeys = new Map<string, number>();

function defaultUrlForType(type: NotificationType, role: string | null): string {
  switch (type) {
    case "tip_received":
    case "qr_payment_success":
      return role === "MANAGER" ? "/dashboard/tips/transactions" : "/employee/tip-history";
    case "payout_paid":
      return role === "MANAGER" ? "/dashboard/tips/transactions" : "/employee/tip-history";
    case "new_login":
      return role === "MANAGER"
        ? "/dashboard/settings?section=security"
        : "/employee/settings";
    case "employee_invited":
      return role === "MANAGER" ? "/dashboard/team/employees" : "/employee/dashboard";
    case "qr_scan":
      return "/dashboard/qr-studio/employees";
    case "admin_announcement":
    case "system_alert":
    case "support_ticket_created":
    case "support_ticket_reply":
    case "support_ticket_status":
      if (role === "SUPER_ADMIN") return "/platform-admin/notifications";
      return role === "MANAGER" ? "/dashboard/notifications" : "/employee/dashboard";
    default:
      if (role === "SUPER_ADMIN") return "/platform-admin/dashboard";
      return role === "MANAGER" ? "/dashboard" : "/employee/dashboard";
  }
}

function isDuplicateSend(dedupeKey: string): boolean {
  const now = Date.now();
  const last = recentSendKeys.get(dedupeKey);
  if (last != null && now - last < DEDUPE_WINDOW_MS) {
    return true;
  }
  recentSendKeys.set(dedupeKey, now);
  if (recentSendKeys.size > 5000) {
    for (const [key, ts] of recentSendKeys) {
      if (now - ts > DEDUPE_WINDOW_MS) recentSendKeys.delete(key);
    }
  }
  return false;
}

async function userWantsNotification(
  userId: string,
  type: NotificationType,
): Promise<boolean> {
  const tipColumnsReady = await employeeTipChannelColumnsReady();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      role: true,
      settings: {
        select: {
          tipReceivedNotifications: true,
          systemAlerts: true,
          notifyNewLogin: true,
        },
      },
      employee: {
        select: tipColumnsReady
          ? { pushNotifications: true, tipPushNotifications: true }
          : { pushNotifications: true },
      },
    },
  });
  if (!user?.isActive) return false;

  const settings = user.settings;
  const employeeRecord = user.employee as
    | { pushNotifications?: unknown; tipPushNotifications?: unknown }
    | null;
  const employeePush =
    typeof employeeRecord?.pushNotifications === "boolean" ? employeeRecord.pushNotifications : true;
  const employeeTipPush = tipColumnsReady
    ? typeof employeeRecord?.tipPushNotifications === "boolean"
      ? employeeRecord.tipPushNotifications
      : true
    : employeePush;

  if (user.role === "SUPER_ADMIN") {
    switch (type) {
      case "admin_announcement":
      case "system_alert":
      case "support_ticket_created":
      case "support_ticket_reply":
      case "support_ticket_status":
        return settings?.systemAlerts ?? true;
      case "new_login":
        return settings?.notifyNewLogin ?? true;
      default:
        return false;
    }
  }

  switch (type) {
    case "support_ticket_created":
    case "support_ticket_reply":
    case "support_ticket_status":
      if (user.role === "MANAGER") return settings?.systemAlerts ?? true;
      return false;
    case "tip_received":
      if (user.role === "EMPLOYEE") return employeeTipPush;
      if (user.role === "MANAGER") return settings?.tipReceivedNotifications ?? true;
      return false;
    case "qr_payment_success":
      if (user.role === "EMPLOYEE") return employeeTipPush;
      if (user.role === "MANAGER") return settings?.tipReceivedNotifications ?? true;
      return false;
    case "payout_paid":
    case "admin_announcement":
    case "system_alert":
    case "qr_scan":
    case "employee_invited":
      if (user.role === "EMPLOYEE") return employeePush;
      if (user.role === "MANAGER") return settings?.systemAlerts ?? true;
      return false;
    case "new_login":
      if (user.role === "EMPLOYEE") {
        return (settings?.notifyNewLogin ?? true) && employeePush;
      }
      return settings?.notifyNewLogin ?? true;
    default:
      return false;
  }
}

function buildFcmData(
  userId: string,
  payload: NotificationPayload,
  role: string | null,
): Record<string, string> {
  const timestamp = payload.timestamp ?? new Date().toISOString();
  const url = payload.url ?? defaultUrlForType(payload.type, role);
  return stringifyPushData({
    event: payload.type,
    category: payload.type,
    url,
    timestamp,
    userId,
    ...payload.metadata,
  });
}

/**
 * Sends a production push notification to one user (all registered devices).
 */
export async function sendNotification(
  userId: string,
  payload: NotificationPayload,
  options?: SendNotificationOptions,
): Promise<SendNotificationResult> {
  const base: SendNotificationResult = {
    userId,
    type: payload.type,
    skipped: true,
    tokenCount: 0,
    successCount: 0,
    failureCount: 0,
  };

  if (!isFcmConfigured()) {
    return { ...base, skipReason: "fcm_unconfigured" };
  }

  const dedupeKey =
    options?.dedupeKey ?? `${payload.type}:${userId}:${payload.metadata?.entityId ?? payload.title}`;

  if (isDuplicateSend(dedupeKey)) {
    logPush("info", "skipped (duplicate)", { userId, type: payload.type, dedupeKey });
    return { ...base, skipReason: "duplicate" };
  }

  if (!options?.bypassPreferences) {
    const allowed = await userWantsNotification(userId, payload.type);
    if (!allowed) {
      logPush("info", "skipped (preferences)", { userId, type: payload.type });
      return { ...base, skipReason: "preferences" };
    }
  }

  const tokens = await listPushTokensForUser(userId);
  if (tokens.length === 0) {
    return { ...base, skipReason: "no_tokens", tokenCount: 0 };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  const fcmData = buildFcmData(userId, payload, user?.role ?? null);
  const delivery = await sendWebPushMulticast(
    tokens,
    { title: payload.title, body: payload.body },
    fcmData,
  );

  if (!delivery) {
    return {
      ...base,
      skipped: false,
      tokenCount: tokens.length,
      failureCount: tokens.length,
    };
  }

  const stillValid = tokens.filter((t) => !delivery.invalidTokens.includes(t));
  if (stillValid.length > 0) {
    await prisma.pushDeviceToken.updateMany({
      where: { userId, token: { in: stillValid } },
      data: { lastUsedAt: new Date() },
    });
  }

  logPush("info", "notification delivered", {
    userId,
    type: payload.type,
    success: delivery.successCount,
    failure: delivery.failureCount,
    tokens: tokens.length,
  });

  return {
    userId,
    type: payload.type,
    skipped: false,
    tokenCount: tokens.length,
    successCount: delivery.successCount,
    failureCount: delivery.failureCount,
  };
}

/** Sends the same notification to multiple users (dedupe per user). */
export async function sendNotificationToUsers(
  userIds: string[],
  payload: NotificationPayload,
  options?: SendNotificationOptions & { dedupeKeyPrefix?: string },
): Promise<SendNotificationBatchResult> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const results: SendNotificationResult[] = [];

  for (const userId of unique) {
    const dedupeKey = options?.dedupeKeyPrefix
      ? `${options.dedupeKeyPrefix}:${userId}`
      : options?.dedupeKey;
    results.push(
      await sendNotification(userId, payload, {
        ...options,
        dedupeKey,
      }),
    );
  }

  return {
    results,
    totalSuccess: results.reduce((n, r) => n + r.successCount, 0),
    totalFailure: results.reduce((n, r) => n + r.failureCount, 0),
  };
}
