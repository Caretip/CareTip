/**
 * Stripe Connect payout `method` field (instant vs standard bank payout).
 * Authoritative when mirrored on StripeConnectPayout / EmployeeStripePayout.
 */
export type ConnectPayoutMethodKind = "instant" | "standard" | "unknown";

export function normalizeConnectPayoutMethod(
  raw: string | null | undefined,
): ConnectPayoutMethodKind {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "instant") return "instant";
  if (v === "standard") return "standard";
  return "unknown";
}
