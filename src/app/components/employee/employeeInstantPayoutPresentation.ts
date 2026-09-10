import type { EmployeeInstantPayoutEligibility, InstantPayoutReason } from "../../lib/api";

export type EmployeeInstantUiMode = "hidden" | "threshold" | "ready" | "blocked";

/** Instant CTA is a Connect action; not connected is handled by the Stripe account section. */
export function employeeInstantUiMode(
  eligibility: Pick<EmployeeInstantPayoutEligibility, "eligible" | "reason"> | null,
): EmployeeInstantUiMode {
  if (!eligibility) return "hidden";
  if (eligibility.reason === "not_connected" || eligibility.reason === "stripe_not_configured") {
    return "hidden";
  }
  if (eligibility.eligible) return "ready";
  if (eligibility.reason === "below_minimum" || eligibility.reason === "zero_balance") {
    return "threshold";
  }
  return "blocked";
}

export function employeeInstantShowCta(mode: EmployeeInstantUiMode): boolean {
  return mode === "ready" || mode === "threshold";
}

export function employeeInstantCtaEnabled(mode: EmployeeInstantUiMode): boolean {
  return mode === "ready";
}

export function employeeInstantShowEligiblePill(mode: EmployeeInstantUiMode): boolean {
  return mode === "ready" || mode === "threshold";
}

export function employeeInstantBlockedReasonKey(reason: InstantPayoutReason): string {
  if (reason === "no_instant_destination") return "employee.payouts.instant.reason.no_instant_destination";
  if (reason === "payouts_disabled") return "employee.payouts.instant.reason.payouts_disabled";
  if (reason === "country_unsupported") return "employee.payouts.instant.reason.country_unsupported";
  if (reason === "business_closed") return "employee.payouts.instant.reason.business_closed";
  return "employee.payouts.instant.unavailable";
}

/**
 * Employee-facing Instant rate is the configured 2.5% target (250 bps).
 * Do not use displayedFeeBps — that is fee/gross and can show ~244 bps.
 * Do not compute a fee from the receive amount.
 */
export function employeeInstantFeePercentLabel(
  eligibility: Pick<EmployeeInstantPayoutEligibility, "feeConfigured" | "platformFeeCents" | "targetTotalFeeBps">,
): string | null {
  if (!eligibility.feeConfigured || eligibility.platformFeeCents <= 0) return null;
  if (eligibility.targetTotalFeeBps === 250) return "2.5%";
  return null;
}
