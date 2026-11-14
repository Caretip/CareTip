import type { EmployeePayableActivityItem, EmployeePayableActivityStatus } from "../../lib/api";

export type EmployeePayoutActivityKind =
  | "held"
  | "held_venue"
  /** Business recorded an off-platform distribution for this tip — not a Stripe/bank payout. */
  | "venue_distributed"
  | "transferring"
  | "transferred"
  | "destination_routed"
  | "refunded"
  | "failed"
  | "disputed";

export type EmployeePayoutActivityTone = "success" | "warning" | "neutral" | "danger";

/**
 * Frozen payable fields plus that row's own distribution allocations —
 * not the current Business setting or Connect state.
 */
export function employeePayoutActivityKind(
  row: Pick<EmployeePayableActivityItem, "status" | "disputedOpenCents"> & {
    presentationKind?: EmployeePayoutActivityKind | null;
    chargeModel?: string | null;
    routingMode?: string | null;
    distributedCents?: number | null;
  },
): EmployeePayoutActivityKind {
  if (row.presentationKind) return row.presentationKind;
  if ((row.disputedOpenCents ?? 0) > 0) return "disputed";
  const status: EmployeePayableActivityStatus = row.status;
  if (status === "refunded") return "refunded";
  if (status === "transfer_failed") return "failed";
  const venueDistribution =
    row.chargeModel === "destination_business" ||
    status === "held_business" ||
    (row.routingMode === "business_distribution" &&
      row.chargeModel !== "destination_employee" &&
      status !== "transferred" &&
      status !== "destination_settled" &&
      status !== "transferring");
  if (venueDistribution) return (row.distributedCents ?? 0) > 0 ? "venue_distributed" : "held_venue";
  if (status === "destination_settled") return "destination_routed";
  if (status === "transferred") return "transferred";
  if (status === "transferring") return "transferring";
  return "held";
}

export function employeePayoutActivityTone(kind: EmployeePayoutActivityKind): EmployeePayoutActivityTone {
  if (kind === "transferred" || kind === "destination_routed" || kind === "venue_distributed") return "success";
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

export function employeePayoutActivityDisplayAt(
  row: Pick<EmployeePayableActivityItem, "createdAt" | "updatedAt" | "activityAt" | "status">,
): string {
  if (row.activityAt) return row.activityAt;
  if (row.status === "transfer_failed" || row.status === "transferring") {
    return row.updatedAt ?? row.createdAt;
  }
  return row.createdAt;
}

export function employeePayoutActivityKindKey(kind: EmployeePayoutActivityKind): string {
  return `employee.payouts.activityKind.${kind}`;
}

export function employeePayoutActivityStatusKey(kind: EmployeePayoutActivityKind): string {
  return `employee.payouts.activityStatus.${kind}`;
}
