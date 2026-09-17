/**
 * Business Stripe payout KPI visibility.
 * Balance cards require an authoritative connected Stripe account.
 */

export type BusinessPayoutMetricsMode = "loading" | "setup" | "metrics" | "unavailable";

export function businessPayoutMetricsMode(input: {
  loading: boolean;
  eligibility: { connected: boolean } | null;
}): BusinessPayoutMetricsMode {
  if (input.loading) return "loading";
  if (!input.eligibility) return "unavailable";
  if (!input.eligibility.connected) return "setup";
  return "metrics";
}
