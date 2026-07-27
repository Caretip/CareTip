import { t, uiLocaleTag } from "@/i18n";
import type { TipStatus } from "@/types/tips";

export { uiLocaleTag };

/** Business tips ledger uses "Success"; employee tip history uses "Paid" (web parity). */
export function formatTipStatus(
  status: string | TipStatus,
  audience: "business" | "employee" = "employee",
): string {
  if (status === "success") {
    return audience === "business" ? t("status.success") : t("status.paid");
  }
  if (status === "pending") return t("status.pending");
  if (status === "failed") return t("status.failed");
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const NOTIFICATION_TYPE_KEYS = [
  "tip_received",
  "qr_payment_success",
  "payout_paid",
  "payout_completed",
  "payment_refund",
  "qr_scan",
  "new_login",
  "employee_invited",
  "system_alert",
  "admin_announcement",
] as const;

export function formatNotificationType(type: string): string {
  if ((NOTIFICATION_TYPE_KEYS as readonly string[]).includes(type)) {
    return t(`notificationTypes.${type}`);
  }
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatUserRole(role: string | undefined | null): string {
  switch (role) {
    case "MANAGER":
      return t("roles.manager");
    case "EMPLOYEE":
      return t("roles.employee");
    case "SUPER_ADMIN":
      return t("roles.admin");
    default:
      return t("roles.account");
  }
}
