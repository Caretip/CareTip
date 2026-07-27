import type { BusinessActivityFeedItem } from "./api";

export type QrSourceCategory = "business" | "employee" | "location" | "table" | "venue" | "qr";

const QR_SOURCE_LABEL_FALLBACK: Record<QrSourceCategory, string> = {
  business: "Business QR",
  employee: "Employee QR",
  location: "Location QR",
  table: "Table QR",
  venue: "Venue QR",
  qr: "QR",
};

export function getQrScanSourceCategory(scanType: unknown): QrSourceCategory {
  const raw = typeof scanType === "string" ? scanType.trim() : "";
  if (!raw) return "qr";

  const s = raw.toLowerCase();

  // Business QR
  if (s === "business_directory" || s === "business_id" || s === "business_profile" || s.startsWith("business_")) {
    return "business";
  }

  // Employee QR (includes legacy variants)
  if (
    s === "employee_directory" ||
    s === "employee_profile" ||
    s.startsWith("employee_") ||
    s === "employee"
  ) {
    return "employee";
  }

  // Locations / tables / venue
  if (s === "location" || s.startsWith("location_")) return "location";
  if (s === "table" || s.startsWith("table_") || s === "table_id" || s === "table_slug") return "table";
  if (s === "venue" || s.startsWith("venue_")) return "venue";

  return "qr";
}

/**
 * Central activity name translator — ensures UI never prints internal backend
 * QR identifiers (e.g. `business_directory`, `employee_directory`).
 */
export function translateActivitySource(
  activity: Pick<BusinessActivityFeedItem, "type" | "params">,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { title: string; subtitle: string | null } | null {
  if (activity.type !== "qr.scanned") return null;

  const scanType = activity.params?.scanType;
  const category = getQrScanSourceCategory(scanType);

  const qrSourceLabel = t(`business.activityCenter.qrSource.${category}`, {
    defaultValue: QR_SOURCE_LABEL_FALLBACK[category],
  });

  const employeeName =
    typeof activity.params?.employeeName === "string" ? activity.params.employeeName.trim() : "";

  const title = t("business.activityCenter.qrTitle.scanned", {
    qrSource: qrSourceLabel,
    defaultValue: `${qrSourceLabel} scanned`,
  });

  const subtitle =
    category === "employee" && employeeName
      ? t("business.activityCenter.qrSubtitle.guestViewedEmployeeNamed", {
          name: employeeName,
          defaultValue: `Guest viewed ${employeeName}`,
        })
      : category === "employee"
        ? t("business.activityCenter.qrSubtitle.guestOpenedEmployeeProfile", {
            defaultValue: "Guest opened your employee profile",
          })
        : t("business.activityCenter.qrSubtitle.guestScannedYourQr", {
            qrSource: qrSourceLabel,
            defaultValue: `Guest scanned your ${qrSourceLabel}`,
          });

  return { title, subtitle };
}

