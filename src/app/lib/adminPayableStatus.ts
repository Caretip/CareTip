import type { TFunction } from "i18next";
import type { PlatformAdminStatusTone } from "../components/platform/PlatformAdminDesignPrimitives";

/** EmployeeTipPayable.status (+ no_payable) for Platform Admin global transactions. */
export function adminPayableStatusLabel(status: string, t: TFunction): string {
  const key = `admin.globalTransactionsPage.payableStatus.${status}`;
  const label = t(key);
  return label === key ? status.replace(/_/g, " ") : label;
}

export function adminPayableStatusTone(status: string): PlatformAdminStatusTone {
  if (status === "transferred" || status === "destination_settled") return "success";
  if (status === "transfer_failed" || status === "refunded") return "failure";
  if (status === "no_payable") return "neutral";
  if (status === "transfer_in_progress") return "pending";
  return "attention";
}

export function adminPayableStatusBadgeClass(status: string): string {
  if (status === "transferred" || status === "destination_settled") {
    return "bg-success/15 text-success dark:bg-success/25";
  }
  if (status === "transfer_failed" || status === "refunded") {
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  }
  if (status === "no_payable") {
    return "bg-muted text-muted-foreground";
  }
  return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
}
