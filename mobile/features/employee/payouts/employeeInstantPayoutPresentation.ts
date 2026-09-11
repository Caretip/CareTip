export type InstantPayoutReason =
  | "not_connected"
  | "stripe_not_configured"
  | "business_closed"
  | "payouts_disabled"
  | "country_unsupported"
  | "no_instant_destination"
  | "zero_balance"
  | "below_minimum"
  | "eligible";

export type EmployeeInstantUiMode = "hidden" | "threshold" | "ready" | "blocked";

/** Instant CTA is a Connect action; not connected is handled by the Stripe account section. */
export function employeeInstantUiMode(
  eligibility: { eligible: boolean; reason: string } | null,
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

/** Instant uses Stripe Instant balance only. Hide under venue distribution unless Instant is ready. */
export function employeeInstantVisibleForTipRouting(
  businessDistribution: boolean,
  mode: EmployeeInstantUiMode,
): boolean {
  if (businessDistribution) return mode === "ready";
  return mode !== "hidden";
}

export function employeePayoutShowConnectPrompt(
  businessDistribution: boolean,
  connectionState: string,
): boolean {
  return !businessDistribution && connectionState === "not_connected";
}

export function employeePayoutShowSetupPrompt(
  businessDistribution: boolean,
  connectionState: string,
): boolean {
  if (businessDistribution) return false;
  return connectionState === "setup_required" || connectionState === "action_required";
}

/**
 * Employee-facing Instant rate is the configured 2.5% target (250 bps).
 * Do not use displayedFeeBps. Do not compute a fee from the receive amount.
 */
export function employeeInstantFeePercentLabel(
  eligibility: Pick<{ feeConfigured: boolean; platformFeeCents: number; targetTotalFeeBps: number }, "feeConfigured" | "platformFeeCents" | "targetTotalFeeBps">,
): string | null {
  if (!eligibility.feeConfigured || eligibility.platformFeeCents <= 0) return null;
  if (eligibility.targetTotalFeeBps === 250) return "2.5%";
  return null;
}

export type EmployeePayoutActivityKind =
  | "held"
  | "held_venue"
  | "transferring"
  | "transferred"
  | "destination_routed"
  | "refunded"
  | "failed"
  | "disputed";

export function employeePayoutActivityKind(row: {
  status: string;
  disputedOpenCents: number;
}): EmployeePayoutActivityKind {
  if ((row.disputedOpenCents ?? 0) > 0) return "disputed";
  const status = row.status;
  if (status === "refunded") return "refunded";
  if (status === "transfer_failed") return "failed";
  if (status === "destination_settled") return "destination_routed";
  if (status === "transferred") return "transferred";
  if (status === "transferring") return "transferring";
  if (status === "held_business") return "held_venue";
  return "held";
}

export function employeePayoutActivityTone(
  kind: EmployeePayoutActivityKind,
): "success" | "warning" | "danger" | "neutral" {
  if (kind === "transferred" || kind === "destination_routed") return "success";
  if (kind === "failed") return "danger";
  if (kind === "held_venue") return "neutral";
  if (kind === "held" || kind === "transferring" || kind === "disputed") {
    return "warning";
  }
  return "neutral";
}

export function employeePayoutActivityShowsStatusPill(kind: EmployeePayoutActivityKind): boolean {
  return kind !== "held_venue";
}

export function isEmployeeBusinessDistributionMode(mode: string | null | undefined): boolean {
  return mode === "business_distribution";
}

export function bankPayoutStatusTone(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  const s = status.toLowerCase();
  if (s === "paid") return "success";
  if (s === "failed" || s === "canceled") return "danger";
  if (s === "pending" || s === "in_transit") return "warning";
  return "neutral";
}
