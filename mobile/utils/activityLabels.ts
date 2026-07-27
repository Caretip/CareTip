import { t } from "@/i18n";
import type { BusinessActivityFeedItem } from "@/types/activity";

export type QrSourceCategory = "business" | "employee" | "location" | "table" | "venue" | "qr";

function qrSourceLabel(category: QrSourceCategory): string {
  switch (category) {
    case "business":
      return t("qr.businessQr");
    case "employee":
      return t("qr.employeeQr");
    case "location":
      return t("qr.locationQr");
    case "table":
      return t("qr.tableQr");
    case "venue":
      return t("activity.venueQr");
    default:
      return t("activity.filterQr");
  }
}

/** Never surface raw backend scan type strings in UI. */
export function getQrScanSourceCategory(scanType: unknown): QrSourceCategory {
  const raw = typeof scanType === "string" ? scanType.trim() : "";
  if (!raw) return "qr";
  const s = raw.toLowerCase();
  if (
    s === "business_directory" ||
    s === "business_id" ||
    s === "business_profile" ||
    s.startsWith("business_")
  ) {
    return "business";
  }
  if (
    s === "employee_directory" ||
    s === "employee_profile" ||
    s === "employee_qr" ||
    s.startsWith("employee_") ||
    s === "employee"
  ) {
    return "employee";
  }
  if (s === "location" || s === "location_qr" || s.startsWith("location_")) return "location";
  if (
    s === "table" ||
    s === "table_qr" ||
    s.startsWith("table_") ||
    s === "table_id" ||
    s === "table_slug"
  ) {
    return "table";
  }
  if (s === "venue" || s.startsWith("venue_")) return "venue";
  return "qr";
}

export function getQrScanSourceLabel(scanType: unknown): string {
  return qrSourceLabel(getQrScanSourceCategory(scanType));
}

export function translateActivitySource(
  activity: Pick<BusinessActivityFeedItem, "type" | "params">,
): { title: string; subtitle: string | null } | null {
  if (activity.type !== "qr.scanned") return null;

  const category = getQrScanSourceCategory(activity.params?.scanType);
  const source = qrSourceLabel(category);
  const employeeName =
    typeof activity.params?.employeeName === "string" ? activity.params.employeeName.trim() : "";

  const title = t("activity.qrScannedTitle", { source });

  const subtitle =
    category === "employee" && employeeName
      ? t("activity.guestViewed", { name: employeeName })
      : category === "employee"
        ? t("activity.guestOpenedProfile")
        : t("activity.guestScanned", { source });

  return { title, subtitle };
}

const ACTIVITY_TYPE_KEYS: Record<string, string> = {
  "tip.received": "activity.tipReceived",
  "qr.scanned": "activity.qrScanned",
  "goal.achieved": "activity.goalAchieved",
  "payment.failed": "activity.paymentFailed",
  "payment.refunded": "activity.paymentRefunded",
  "payment.received": "activity.paymentReceived",
  payment_refund: "activity.paymentRefunded",
  payment_received: "activity.paymentReceived",
  "employee.invited": "activity.employeeInvited",
  "employee.joined": "activity.employeeJoined",
};

function humanizeKey(value: string): string {
  return value
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getActivityTitle(item: BusinessActivityFeedItem): string {
  const qr = translateActivitySource(item);
  if (qr) return qr.title;

  const key = ACTIVITY_TYPE_KEYS[item.type];
  if (key) return t(key);

  if (item.titleKey && !item.titleKey.includes(".")) {
    return humanizeKey(item.titleKey);
  }

  return humanizeKey(item.type);
}

export function getActivitySubtitle(item: BusinessActivityFeedItem): string | null {
  const qr = translateActivitySource(item);
  if (qr) return qr.subtitle;

  const p = item.params;
  const employeeName = typeof p.employeeName === "string" ? p.employeeName.trim() : "";
  const goalName = typeof p.goalName === "string" ? p.goalName.trim() : "";
  const channel = typeof p.channel === "string" ? humanizeKey(p.channel) : "";
  const reason = typeof p.reason === "string" ? p.reason.trim() : "";

  if (employeeName) return employeeName;
  if (goalName) return goalName;
  if (channel) return channel;
  if (reason) return reason;
  return null;
}

export function getActivityAmount(item: BusinessActivityFeedItem): number | null {
  const amount = item.params?.amountEur;
  if (typeof amount === "number" && Number.isFinite(amount)) return amount;
  if (typeof amount === "string" && amount.trim() && Number.isFinite(Number(amount))) {
    return Number(amount);
  }
  return null;
}
