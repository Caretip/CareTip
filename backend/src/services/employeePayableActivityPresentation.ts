/**
 * Employee payable history kind from frozen row fields.
 * Never uses current Connect status or current Business payout mode.
 */

export type EmployeePayablePresentationKind =
  | "held"
  | "held_venue"
  | "transferring"
  | "transferred"
  | "destination_routed"
  | "refunded"
  | "failed"
  | "disputed";

export function employeePayablePresentationKind(row: {
  status: string;
  disputedOpenCents: number;
  chargeModel?: string | null;
  routingMode?: string | null;
}): EmployeePayablePresentationKind {
  if ((row.disputedOpenCents ?? 0) > 0) return "disputed";
  const status = row.status;
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

  if (venueDistribution) return "held_venue";
  if (status === "destination_settled") return "destination_routed";
  if (status === "transferred") return "transferred";
  if (status === "transferring") return "transferring";
  return "held";
}
