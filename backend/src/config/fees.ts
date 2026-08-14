/** Platform fee on tip gross amount (shown in admin). Authoritative tip Connect fee. */
export const CARETIP_FEE_PERCENT = 10;

/** Fixed CareTip application-fee add-on in EUR minor units (49 = €0.49). */
export const CARETIP_FEE_FIXED_CENTS_EUR = 49;

/**
 * Integer-cent CareTip application fee on a guest tip.
 * Percent is floored so the variable part never rounds up past the documented rate.
 * The €0.49 add-on is taken from the tip (not added to the guest charge).
 * Fee must be at least 1 cent and strictly less than the charge (destination remainder).
 */
export function calculateTipPlatformFeeCents(tipAmountCents: number): number {
  if (!Number.isInteger(tipAmountCents) || !Number.isFinite(tipAmountCents) || tipAmountCents <= 0) {
    throw new Error("Invalid tip amount for platform fee");
  }
  const feeCents =
    Math.floor((tipAmountCents * CARETIP_FEE_PERCENT) / 100) + CARETIP_FEE_FIXED_CENTS_EUR;
  if (feeCents < 1) {
    throw new Error("Platform fee would be zero for this tip amount");
  }
  if (feeCents >= tipAmountCents) {
    throw new Error("Platform fee cannot consume the full tip");
  }
  return feeCents;
}
