import type { AnalyticsTimeframe } from "./types";

/** Average tip from period volume / successful tip count. */
export function averageTipValue(volume: number, tipCount: number): number {
  if (!(tipCount > 0) || !Number.isFinite(volume)) return 0;
  return volume / tipCount;
}

/**
 * Growth vs the equal-length prior window (backend `queryPriorPeriodTipTotals`).
 * Returns null when there is no comparable prior volume (do not display 100%).
 */
export function comparableGrowthPercent(currentTotal: number, priorTotal: number): number | null {
  if (!(priorTotal > 0) || !Number.isFinite(currentTotal) || !Number.isFinite(priorTotal)) {
    return null;
  }
  return Math.round(((currentTotal - priorTotal) / priorTotal) * 100);
}

/**
 * Show “this week” as extra context on month/year only when it is not the same total as the selected period.
 * (Early-month venues often have week === month; repeating the same € is misleading.)
 */
export function shouldShowCurrentWeekContext(opts: {
  timeframe: AnalyticsTimeframe;
  periodTotal: number;
  periodCount: number;
  weekTotal: number;
  weekCount: number;
}): boolean {
  if (opts.timeframe === "week") return false;
  const sameVolume = Math.abs(opts.weekTotal - opts.periodTotal) < 0.005;
  const sameCount = opts.weekCount === opts.periodCount;
  return !(sameVolume && sameCount);
}

export function analyticsStoreKey(businessId: string | null | undefined, timeframe: AnalyticsTimeframe): string {
  const tenant = businessId && businessId.trim() ? businessId.trim() : "session";
  return `business-analytics:${tenant}:${timeframe}`;
}
