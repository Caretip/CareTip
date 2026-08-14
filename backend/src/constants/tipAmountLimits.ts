/** EUR bounds for guest tips — shared by checkout, payment intents, and legacy tip APIs. */
export const MIN_TIP_AMOUNT_EUR = 1;
export const MAX_TIP_AMOUNT_EUR = 500;

export function assertTipAmountInRangeEur(amount: number): void {
  if (Number.isNaN(amount) || amount < MIN_TIP_AMOUNT_EUR) {
    throw new Error("Amount too small");
  }
  if (amount > MAX_TIP_AMOUNT_EUR) {
    throw new Error("Amount exceeds maximum allowed tip");
  }
}
