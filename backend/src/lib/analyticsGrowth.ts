/**
 * Comparable period-over-period growth for business analytics.
 * Returns null when there is no prior volume to compare (avoids a fake 100%).
 */
export function comparableTipGrowthPercent(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  if (!(prior > 0)) return null;
  return Math.round(((current - prior) / prior) * 100);
}
