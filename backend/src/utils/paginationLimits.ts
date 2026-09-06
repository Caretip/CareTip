/** Caps for list pagination — unbounded skip is an API-cost issue (API-03). */
export const MAX_LIST_SKIP = 10_000;

export function parseBoundedSkip(raw: unknown, max = MAX_LIST_SKIP): number {
  const n = Math.max(0, Number(raw ?? 0) || 0);
  return Math.min(n, max);
}
