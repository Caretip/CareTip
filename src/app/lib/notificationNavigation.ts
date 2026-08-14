import type { TFunction } from "i18next";
import type { InboxNotification } from "./api";
import { isSupportTicketNotification } from "./api";

export type InboxNavigationRole = "employee" | "business" | "platform_admin" | "admin" | string | undefined;

export type NotificationCategory =
  | "tips"
  | "payouts"
  | "team"
  | "feedback"
  | "goals"
  | "billing"
  | "verification"
  | "security"
  | "support"
  | "announcement"
  | "system"
  | "activity";

export type NotificationActionKey =
  | "viewTip"
  | "viewPayout"
  | "viewTeam"
  | "viewFeedback"
  | "viewBilling"
  | "reviewSecurity"
  | "viewTicket"
  | "viewDetails"
  | "viewQrCodes"
  | "viewDashboard"
  | "reviewBusiness";

function normalizePath(url: string): string {
  const path = url.split("?")[0]?.trim() || url;
  if (!path.startsWith("/")) return path;
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function metaString(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function templateId(notification: InboxNotification): string | undefined {
  return metaString(notification.metadata ?? {}, "templateId");
}

/** Routes that only repeat the default home/overview — not a meaningful deep link. */
export function isGenericInboxDestination(url: string, role?: InboxNavigationRole): boolean {
  const path = normalizePath(url);
  if (role === "employee") {
    return path === "/employee" || path === "/employee/dashboard";
  }
  if (role === "business") {
    return path === "/dashboard";
  }
  if (role === "platform_admin" || role === "admin") {
    return path === "/platform-admin" || path === "/platform-admin/dashboard";
  }
  return false;
}

export function getNotificationCategory(notification: InboxNotification): NotificationCategory {
  const type = notification.type;
  const tid = templateId(notification);

  if (type === "tip_received" || type === "qr_payment_success") return "tips";
  if (type === "payout_paid" || type === "payout_completed") return "payouts";
  if (type === "employee_invited") {
    return tid === "employee_activated" ? "team" : "team";
  }
  if (type === "qr_scan") return "activity";
  if (type === "new_login") return "security";
  if (isSupportTicketNotification(type)) return "support";
  if (type === "admin_announcement") return "announcement";
  if (tid === "verification_document_uploaded") return "verification";
  if (type === "system_alert") return "system";
  return "system";
}

/**
 * Actionable in-app route. Returns null when the inbox detail view is the destination
 * (welcome copy, announcements without a link, generic dashboard-only URLs).
 */
export function resolveInboxNotificationDestination(
  notification: InboxNotification,
  opts: { role?: InboxNavigationRole; isPlatformAdmin?: boolean },
): string | null {
  const meta = notification.metadata ?? {};
  const ticketId = metaString(meta, "ticketId");
  if (ticketId && isSupportTicketNotification(notification.type)) {
    const base = opts.isPlatformAdmin ? "/platform-admin/support" : "/dashboard/support";
    return `${base}/${ticketId}`;
  }

  const type = notification.type;
  const tid = templateId(notification);
  const role = opts.role;

  if (type === "tip_received" || type === "qr_payment_success") {
    if (role === "employee") return "/employee/tip-history";
    if (role === "business") return "/dashboard/tips/transactions";
  }

  if (type === "payout_paid" || type === "payout_completed") {
    if (role === "employee") return "/employee/tip-history";
    if (role === "business") return "/dashboard/tips/transactions";
  }

  if (type === "employee_invited") {
    if (tid === "employee_activated") {
      if (role === "employee") return null;
      return null;
    }
    if (role === "business") return "/dashboard/team/employees";
  }

  if (type === "qr_scan" && role === "business") {
    return "/dashboard/qr-studio/employees";
  }

  if (type === "new_login") {
    if (role === "business") return "/dashboard/settings?section=security";
    if (role === "employee") return "/employee/settings";
    if (opts.isPlatformAdmin) return "/platform-admin/system/settings";
  }

  if (tid === "verification_document_uploaded" && opts.isPlatformAdmin) {
    const businessId = metaString(meta, "businessId");
    if (businessId) return `/platform-admin/businesses/${businessId}`;
    return "/platform-admin/businesses/kyc-verification";
  }

  const raw = notification.url?.trim() ?? metaString(meta, "url");
  if (!raw) return null;
  if (isGenericInboxDestination(raw, role)) return null;

  if (type === "admin_announcement" || type === "system_alert") {
    if (normalizePath(raw) === "/dashboard/notifications" || normalizePath(raw) === "/platform-admin/notifications") {
      return null;
    }
  }

  return raw;
}

export function resolveInboxNotificationActionKey(
  notification: InboxNotification,
  opts: { role?: InboxNavigationRole; isPlatformAdmin?: boolean },
): NotificationActionKey | null {
  if (!resolveInboxNotificationDestination(notification, opts)) return null;

  const type = notification.type;
  const tid = templateId(notification);

  if (type === "tip_received" || type === "qr_payment_success") return "viewTip";
  if (type === "payout_paid" || type === "payout_completed") return "viewTip";
  if (type === "employee_invited" && tid !== "employee_activated") return "viewTeam";
  if (type === "qr_scan") return "viewQrCodes";
  if (type === "new_login") return "reviewSecurity";
  if (isSupportTicketNotification(type)) return "viewTicket";
  if (tid === "verification_document_uploaded") return "reviewBusiness";
  if (type === "admin_announcement" || type === "system_alert") return "viewDetails";

  return "viewDetails";
}

export function inboxNotificationActionLabel(
  notification: InboxNotification,
  opts: { role?: InboxNavigationRole; isPlatformAdmin?: boolean },
  t: TFunction,
): string | null {
  const key = resolveInboxNotificationActionKey(notification, opts);
  if (!key) return null;
  return t(`notifications.actions.${key}`);
}

export function inboxNotificationCategoryLabel(category: NotificationCategory, t: TFunction): string {
  return t(`notifications.categories.${category}`);
}

export function inboxNotificationHasOpenAction(
  notification: InboxNotification,
  opts: { role?: InboxNavigationRole; isPlatformAdmin?: boolean },
): boolean {
  return resolveInboxNotificationDestination(notification, opts) != null;
}

export function formatNotificationRelativeTime(iso: string, locale: string, t: TFunction): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return t("notifications.bell.justNow");
  if (diffMins < 60) return t("notifications.bell.minutesAgo", { count: diffMins });
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return t("notifications.bell.hoursAgo", { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return t("notifications.bell.daysAgo", { count: diffDays });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}
