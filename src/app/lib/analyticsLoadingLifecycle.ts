import type { BusinessAnalyticsDTO } from "./businessAnalytics/types";

/** True when a successful analytics payload has been committed to UI state. */
export function hasVisibleAnalyticsData(dto: BusinessAnalyticsDTO | null): boolean {
  return dto != null && dto.fetchedAt > 0;
}

/** True when period stats (overview/revenue/ops/locations) are available. */
export function hasVisiblePeriodStats(dto: BusinessAnalyticsDTO | null): boolean {
  return dto != null && dto.fetchedAt > 0 && dto.stats != null;
}

/**
 * Period-scoped analytics sections must not paint values from a different selected period.
 * Skeleton until the committed DTO matches the toggle, or the slice is still loading.
 */
export function derivePeriodScopedSectionLoading(opts: {
  valuesMatchPeriod: boolean;
  sliceReady: boolean;
  fetchInFlight: boolean;
}): boolean {
  if (!opts.valuesMatchPeriod) return true;
  return !opts.sliceReady && opts.fetchInFlight;
}

/**
 * Analytics surfaces mirror dashboard hydration:
 * - cold load → skeleton only when nothing is visible yet
 * - period switch / refresh → keep values + subtle updating indicator
 */
export function deriveAnalyticsLoadingLifecycle(opts: {
  hasVisibleAnalyticsData: boolean;
  isColdLoading: boolean;
  isTimeframeLoading: boolean;
  valuesMatchPeriod: boolean;
  /** Above-fold period stats committed for the selected period. */
  periodStatsReady: boolean;
}): {
  isInitialAnalyticsLoading: boolean;
  isAnalyticsRefreshing: boolean;
} {
  const {
    hasVisibleAnalyticsData: hasVisible,
    isColdLoading,
    isTimeframeLoading,
    valuesMatchPeriod,
    periodStatsReady,
  } = opts;

  const bundleFetchInFlight = isColdLoading || isTimeframeLoading;

  const isInitialAnalyticsLoading = !hasVisible && bundleFetchInFlight;

  // Global "Updating…" tracks primary period stats only — deferred QR/tips/rankings hydrate separately.
  const isAnalyticsRefreshing =
    hasVisible &&
    derivePeriodScopedSectionLoading({
      valuesMatchPeriod,
      sliceReady: periodStatsReady,
      fetchInFlight: bundleFetchInFlight,
    });

  return { isInitialAnalyticsLoading, isAnalyticsRefreshing };
}
