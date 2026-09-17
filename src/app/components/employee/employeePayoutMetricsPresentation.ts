/**
 * Employee payout KPI visibility — Mode A/B aware.
 * Balance cards require an authoritative connected Stripe account with retrieved balances.
 */

export type EmployeePayoutMetricsMode = "loading" | "setup" | "metrics" | "hidden";

export function employeePayoutMetricsMode(input: {
  loading: boolean;
  /** BUSINESS_RECEIVES — personal Stripe is not the tip destination. */
  businessDistribution: boolean;
  connected: boolean | null;
}): EmployeePayoutMetricsMode {
  if (input.loading) return "loading";
  if (input.connected === true) return "metrics";
  if (input.businessDistribution) return "hidden";
  // Unconnected or eligibility failed closed: never invent €0 cards.
  if (input.connected === false) return "setup";
  return "metrics";
}
