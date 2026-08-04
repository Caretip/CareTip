/** Display helpers — formatting only, no business rules. */

/**
 * CareTip money / count display — always en-US grouping/decimals for a consistent product UI:
 * €20.00 · €1,240.50 · €15,240.00 · 1,240
 *
 * Locale-aware copy (dates, labels) still uses `uiLocaleTag()` elsewhere.
 */
const MONEY_LOCALE = "en-US" as const;

export function formatEur(amount: number | null | undefined): string {
  const value = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return `€${value.toLocaleString(MONEY_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Whole-euro display when cents are never meaningful (counts of euros). Prefers €1,240. */
export function formatEurCompact(amount: number | null | undefined): string {
  const value = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  const isWhole = Math.abs(value - Math.round(value)) < 0.000_001;
  return `€${value.toLocaleString(MONEY_LOCALE, {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Whole numbers use the same en-US grouping as money (1,240 — never 1.240). */
export function formatCount(value: number | null | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(MONEY_LOCALE).format(n);
}

export function formatRating(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

export function formatGrowthPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

/** Mask UUID segments in guest-facing URLs for display (QR payload stays full). */
export function maskIdsInUrl(url: string): string {
  return url.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    (id) => `${id.slice(0, 8)}…`,
  );
}
