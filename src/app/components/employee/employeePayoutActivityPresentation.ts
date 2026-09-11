import type { EmployeePayableActivityItem, EmployeePayableActivityStatus } from "../../lib/api";

export type EmployeePayoutActivityKind =
  | "held"
  | "held_venue"
  | "transferring"
  | "transferred"
  | "destination_routed"
  | "refunded"
  | "failed"
  | "disputed";

export type EmployeePayoutActivityTone = "success" | "warning" | "neutral" | "danger";

/** Frozen payable status `held_business` — not the current Business setting. */
export function employeePayoutActivityKind(
  row: Pick<EmployeePayableActivityItem, "status" | "disputedOpenCents">,
): EmployeePayoutActivityKind {
  if ((row.disputedOpenCents ?? 0) > 0) return "disputed";
  const status: EmployeePayableActivityStatus = row.status;
  if (status === "refunded") return "refunded";
  if (status === "transfer_failed") return "failed";
  if (status === "destination_settled") return "destination_routed";
  if (status === "transferred") return "transferred";
  if (status === "transferring") return "transferring";
  if (status === "held_business") return "held_venue";
  return "held";
}

export function employeePayoutActivityTone(kind: EmployeePayoutActivityKind): EmployeePayoutActivityTone {
  if (kind === "transferred" || kind === "destination_routed") return "success";
  if (kind === "failed") return "danger";
  if (kind === "held_venue") return "neutral";
  if (kind === "held" || kind === "transferring" || kind === "disputed") {
    return "warning";
  }
  return "neutral";
}

/** Venue-distribution rows are complete as CareTip records — not a pending employee payout. */
export function employeePayoutActivityShowsStatusPill(kind: EmployeePayoutActivityKind): boolean {
  return kind !== "held_venue";
}

export function isEmployeeBusinessDistributionMode(mode: string | null | undefined): boolean {
  return mode === "business_distribution";
}

export function employeePayoutActivityKindKey(kind: EmployeePayoutActivityKind): string {
  return `employee.payouts.activityKind.${kind}`;
}

export function employeePayoutActivityStatusKey(kind: EmployeePayoutActivityKind): string {
  return `employee.payouts.activityStatus.${kind}`;
}
