/**
 * Stripe Balance Settings API — payout schedule + settlement timing (Accounts v1 + v2).
 * @see https://docs.stripe.com/api/balance-settings/retrieve
 * @see https://docs.stripe.com/connect/manage-payout-schedule
 */
export const STRIPE_BALANCE_SETTINGS_API_VERSION = "2025-09-30.clover" as const;

/** GET/POST /v1/balance_settings with Stripe-Account header (not /v1/balance_settings/{id}). */
export const STRIPE_BALANCE_SETTINGS_PATH = "/v1/balance_settings" as const;

/**
 * Live-mode DE accounts still receive this per-account override when it is not already set.
 * Test-mode eligible German Express accounts use Stripe's platform T+3 default instead.
 * See manage payout schedule: delay_days_override up to 31.
 */
export const STRIPE_CONNECT_DE_SETTLEMENT_DELAY_DAYS_OVERRIDE = 3;

/**
 * Stripe clears an explicit settlement override when this field is an empty string.
 * Do not send 0. Public docs describe the result as the account's lowest available delay,
 * which is not a guarantee that delay_days stays 3.
 */
export const STRIPE_SETTLEMENT_DELAY_DAYS_OVERRIDE_CLEAR = "" as const;

/** Target override for connected accounts in this country; null = do not POST settlement override. */
export function connectSettlementDelayDaysOverrideTarget(
  country: string | null | undefined,
): number | null {
  const c = (country ?? "").trim().toLowerCase();
  if (c === "de") return STRIPE_CONNECT_DE_SETTLEMENT_DELAY_DAYS_OVERRIDE;
  return null;
}
