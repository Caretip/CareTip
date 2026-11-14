/**
 * Employee payable history kind from frozen row fields plus that row's own
 * distribution allocations (EmployeeTipDistributionAllocation).
 * Never uses current Connect status or current Business payout mode.
 */

export type EmployeePayablePresentationKind =
  | "held"
  | "held_venue"
  /** Business recorded an off-platform distribution against this payable. Not a Stripe payout. */
  | "venue_distributed"
  | "transferring"
  | "transferred"
  | "destination_routed"
  | "refunded"
  | "failed"
  | "disputed";

/**
 * Off-platform distribution progress for a venue-routed payable.
 * Display only — derived from allocations; never a stored payable status.
 */
export type EmployeePayableDistributionState = "not_applicable" | "awaiting" | "partial" | "distributed";

function isVenueDistributionRow(row: {
  status: string;
  chargeModel?: string | null;
  routingMode?: string | null;
}): boolean {
  const status = row.status;
  return (
    row.chargeModel === "destination_business" ||
    status === "held_business" ||
    (row.routingMode === "business_distribution" &&
      row.chargeModel !== "destination_employee" &&
      status !== "transferred" &&
      status !== "destination_settled" &&
      status !== "transferring")
  );
}

export function employeePayablePresentationKind(row: {
  status: string;
  disputedOpenCents: number;
  chargeModel?: string | null;
  routingMode?: string | null;
  /** Sum of distribution allocations recorded by the business for this payable. */
  distributedCents?: number | null;
}): EmployeePayablePresentationKind {
  if ((row.disputedOpenCents ?? 0) > 0) return "disputed";
  const status = row.status;
  if (status === "refunded") return "refunded";
  if (status === "transfer_failed") return "failed";

  if (isVenueDistributionRow(row)) {
    return (row.distributedCents ?? 0) > 0 ? "venue_distributed" : "held_venue";
  }
  if (status === "destination_settled") return "destination_routed";
  if (status === "transferred") return "transferred";
  if (status === "transferring") return "transferring";
  return "held";
}

/**
 * @param obligationCents remainingPayableCents(row) — net of refunds/reversals/disputes, before allocations.
 * @param distributedCents sum of allocations for this payable.
 */
export function employeePayableDistributionState(row: {
  status: string;
  chargeModel?: string | null;
  routingMode?: string | null;
  obligationCents: number;
  distributedCents: number;
}): EmployeePayableDistributionState {
  if (!isVenueDistributionRow(row)) return "not_applicable";
  const distributed = Math.max(0, row.distributedCents);
  const obligation = Math.max(0, row.obligationCents);
  if (distributed <= 0) return obligation > 0 ? "awaiting" : "not_applicable";
  return distributed >= obligation ? "distributed" : "partial";
}
