/** EUR bounds for guest tips — mirrors backend `tipAmountLimits.ts`. */
export const MIN_TIP_AMOUNT_EUR = 1;
export const MAX_TIP_AMOUNT_EUR = 500;

export function isTipAmountInRangeEur(amount: number): boolean {
  return (
    Number.isFinite(amount) &&
    amount >= MIN_TIP_AMOUNT_EUR &&
    amount <= MAX_TIP_AMOUNT_EUR
  );
}
