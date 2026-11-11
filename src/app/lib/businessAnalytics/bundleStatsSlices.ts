import type { BusinessDashboardStats } from "../api";

/** Kept apart from the service so the store can use them without loading the analytics stack. */
/** Whether period stats include above-fold authoritative fields (KPIs, prior, employees). */
export function bundleHasAboveFoldStats(stats: BusinessDashboardStats | undefined): boolean {
  if (!stats) return false;
  return stats.priorPeriod != null && Array.isArray(stats.employees);
}

/** Whether period stats include deferred lower-page analytics (charts, rankings, shifts, goals). */
export function bundleHasDeferredStats(stats: BusinessDashboardStats | undefined): boolean {
  if (!stats) return false;
  return (
    (stats.dailyTipDistribution != null && stats.dailyTipDistribution.length > 0) ||
    stats.locationRankings != null ||
    stats.tableRankings != null ||
    stats.avgTipsPerShift != null ||
    (stats.employeeGoals != null && stats.employeeGoals.length > 0) ||
    stats.peakHour != null
  );
}
