/** German locale formatting for EUR amounts shown across the app. */
const DE = "de-DE" as const;

export function formatEur(
  amount: number,
  options: { minFrac?: number; maxFrac?: number } = {},
): string {
  const minFrac = options.minFrac ?? 2;
  const maxFrac = options.maxFrac ?? minFrac;
  return `€${amount.toLocaleString(DE, {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  })}`;
}

export function formatOptionalEur(
  amount: number | null | undefined,
  options: { minFrac?: number; maxFrac?: number } = {},
): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return formatEur(amount, options);
}
