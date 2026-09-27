import type { FinanceStatusTone } from "../components/finance/FinanceStatusDot";

/** Row shape from GET employee analytics (`tipRecords`). */
export type EmployeeAnalyticsTipRecordView = {
  employeeEarningsEur: number | null;
  routingMode: string | null;
  payoutStatusLabel: string;
};

export type EmployeeTipRoutingDestination = "direct_to_employee" | "business_distribution" | "unknown";

/** Direct employee share in EUR; business-routed tips have no direct payable → 0. */
export function employeeAnalyticsTipRecordEarningsEur(
  employeeEarningsEur: number | null,
): number {
  return employeeEarningsEur ?? 0;
}

export function employeeAnalyticsTipRecordRoutingDestination(
  routingMode: string | null,
): EmployeeTipRoutingDestination {
  if (routingMode === "business_distribution") return "business_distribution";
  if (routingMode === "direct_to_employee") return "direct_to_employee";
  return "unknown";
}

/** i18n key under `employee.analytics.routingDestination.*` */
export function employeeAnalyticsTipRecordRoutingI18nKey(
  routingMode: string | null,
): string {
  const dest = employeeAnalyticsTipRecordRoutingDestination(routingMode);
  if (dest === "business_distribution") return "employee.analytics.routingDestination.business";
  if (dest === "direct_to_employee") return "employee.analytics.routingDestination.stripe";
  return "employee.analytics.routingDestination.unknown";
}

/** i18n key under `employee.analytics.payoutStatus.*` */
export function employeeAnalyticsTipRecordPayoutStatusI18nKey(payoutStatusLabel: string): string {
  return `employee.analytics.payoutStatus.${payoutStatusLabel}`;
}

export function employeeAnalyticsTipRecordPayoutStatusTone(
  payoutStatusLabel: string,
): FinanceStatusTone {
  switch (payoutStatusLabel) {
    case "transferred":
    case "destination_settled":
    case "paid_to_business":
      return "success";
    case "pending_release":
    case "transferring":
    case "held_platform":
      return "warning";
    case "release_failed":
    case "transfer_failed":
      return "danger";
    default:
      return "neutral";
  }
}
