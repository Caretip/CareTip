import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Coins,
  CreditCard,
  Lock,
  Megaphone,
  MessageSquare,
  QrCode,
  ShieldCheck,
  Star,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import type { InboxNotification } from "./api";
import type { NotificationCategory } from "./notificationNavigation";
import { getNotificationCategory } from "./notificationNavigation";

export type InboxDateBucket = "today" | "yesterday" | "thisWeek" | "earlier";

export type InboxCategoryFilter = "all" | "unread" | NotificationCategory;

/**
 * CareTip notification icon system.
 *
 * Every ordinary category shares one brand treatment (CareTip orange #eb992c on a soft orange
 * tint) and keeps its own icon shape for recognition. Colour only changes when the notification's
 * actual state carries meaning (see resolveNotificationTone), never per category.
 * Consumers: the inbox feed (employee, manager, platform admin) and the bell dropdown.
 */
export type NotificationIconTone = "brand" | "success" | "warning" | "error";

/** Shared box treatment per tone; size and radius stay with each consumer's layout. */
export const NOTIFICATION_TONE_STYLE: Record<NotificationIconTone, { iconClass: string; bgClass: string }> = {
  brand: {
    iconClass: "text-primary",
    bgClass: "bg-primary/[0.11] ring-1 ring-inset ring-primary/20 dark:bg-primary/[0.16] dark:ring-primary/25",
  },
  success: {
    iconClass: "text-emerald-700 dark:text-emerald-400",
    bgClass: "bg-emerald-500/10 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-400/12 dark:ring-emerald-400/25",
  },
  warning: {
    iconClass: "text-amber-700 dark:text-amber-400",
    bgClass: "bg-amber-500/10 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-400/12 dark:ring-amber-400/25",
  },
  error: {
    iconClass: "text-destructive dark:text-red-400",
    bgClass: "bg-destructive/10 ring-1 ring-inset ring-destructive/20 dark:bg-destructive/15 dark:ring-destructive/30",
  },
};

/** Category → icon shape. Colour is not defined here on purpose. */
const CATEGORY_ICON: Record<NotificationCategory, LucideIcon> = {
  tips: Coins,
  payouts: Wallet,
  team: Users,
  feedback: Star,
  goals: Target,
  billing: CreditCard,
  verification: ShieldCheck,
  security: Lock,
  support: MessageSquare,
  announcement: Megaphone,
  system: Bell,
  activity: QrCode,
};

export type NotificationIconStyle = { icon: LucideIcon; iconClass: string; bgClass: string; tone: NotificationIconTone };

/** Brand treatment for a category (unknown categories fall back to the bell). */
export function getNotificationCategoryStyle(
  category: NotificationCategory | string | undefined,
  tone: NotificationIconTone = "brand",
): NotificationIconStyle {
  const icon = (category && CATEGORY_ICON[category as NotificationCategory]) || Bell;
  return { icon, tone, ...NOTIFICATION_TONE_STYLE[tone] };
}

function metaValue(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = meta?.[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Semantic tone from the notification's real state only. Ordinary notifications stay brand.
 * - error: payout failed or returned by the bank, verification not approved
 * - warning: suspicious sign-in, inactivity warning, cancelled payout, payout operations incident
 * - success: payout sent to the bank, verification approved
 */
export function resolveNotificationTone(n: Pick<InboxNotification, "type" | "metadata">): NotificationIconTone {
  const meta = n.metadata as Record<string, unknown> | undefined;
  const stage = metaValue(meta, "payoutStage");
  const templateId = metaValue(meta, "templateId");
  if (stage === "failed" || stage === "returned") return "error";
  if (templateId === "business_verification_rejected") return "error";
  if (stage === "canceled") return "warning";
  if (templateId === "employee_inactivity_warning" || templateId === "scheduled_payout_ops_incident") return "warning";
  if (n.type === "new_login" && metaValue(meta, "suspicious") === "true") return "warning";
  if (stage === "paid") return "success";
  if (templateId === "business_verification_approved") return "success";
  return "brand";
}

/** Icon shape from the category, colour from the state. */
export function getNotificationIconStyle(n: InboxNotification): NotificationIconStyle {
  return getNotificationCategoryStyle(getNotificationCategory(n), resolveNotificationTone(n));
}

export function getNotificationDateBucket(iso: string, now = new Date()): InboxDateBucket {
  const d = new Date(iso);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  if (d >= startOfToday) return "today";
  if (d >= startOfYesterday) return "yesterday";
  if (d >= startOfWeek) return "thisWeek";
  return "earlier";
}

const BUCKET_ORDER: InboxDateBucket[] = ["today", "yesterday", "thisWeek", "earlier"];

export function groupNotificationsByDate(
  items: InboxNotification[],
): { bucket: InboxDateBucket; items: InboxNotification[] }[] {
  const map = new Map<InboxDateBucket, InboxNotification[]>();
  for (const item of items) {
    const bucket = getNotificationDateBucket(item.createdAt);
    const arr = map.get(bucket) ?? [];
    arr.push(item);
    map.set(bucket, arr);
  }
  return BUCKET_ORDER.filter((b) => map.has(b)).map((bucket) => ({
    bucket,
    items: map.get(bucket)!,
  }));
}

export function filterInboxNotifications(
  items: InboxNotification[],
  categoryFilter: InboxCategoryFilter,
): InboxNotification[] {
  if (categoryFilter === "all") return items;
  if (categoryFilter === "unread") return items.filter((n) => !n.read);
  return items.filter((n) => getNotificationCategory(n) === categoryFilter);
}

/** Primary filter chips shown in the inbox header. */
export const INBOX_FILTER_CHIPS: InboxCategoryFilter[] = [
  "all",
  "unread",
  "tips",
  "team",
  "security",
  "support",
  "system",
];
