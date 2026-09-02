/**
 * Coordinated dashboard hydration — grouped data phases without rewriting fetch logic.
 *
 * HERO: account balances / operational pulse (single snapshot, no staggered values)
 * METRICS: period KPI cards (summary scope — commit together)
 * ANALYTICS: charts, distributions (analytics scope)
 * GOALS: goal progress / staff goals (analytics or summary goal fields)
 */

export type DashboardHydrationGroup = "hero" | "metrics" | "analytics" | "goals";

/**
 * Fresh-first: never paint in-memory SWR on first paint or period change.
 * Background sync only after the UI has shown a successful live response once.
 */
export function canUseDashboardSwrCache(opts: {
  hasSettledLiveUi: boolean;
  soft?: boolean;
}): boolean {
  return Boolean(opts.hasSettledLiveUi && opts.soft);
}

/** After first live paint, allow session SWR + partial maps on period switches (not cold load). */
export function canUsePeriodSwitchCache(hasSettledLiveUi: boolean): boolean {
  return hasSettledLiveUi;
}

export function markDashboardLiveSettled(ref: { current: boolean }): void {
  ref.current = true;
}

/** KPI cards: skeleton on cold load and while the dashboard is not yet active. Period switches use refresh shimmer. */
export function deriveDashboardMetricLoading(opts: {
  enabled: boolean;
  hasMetricsData: boolean;
  valuesMatchPeriod: boolean;
  summaryLoading: boolean;
  isRevalidating: boolean;
  /** Cached KPIs or bundle data available while the active period revalidates. */
  hasStaleVisibleMetrics?: boolean;
}): {
  showMetricsSkeleton: boolean;
  isPeriodRefreshing: boolean;
} {
  const {
    enabled,
    hasMetricsData,
    valuesMatchPeriod,
    summaryLoading,
    isRevalidating,
    hasStaleVisibleMetrics = false,
  } = opts;
  if (!enabled) {
    return {
      showMetricsSkeleton: !hasMetricsData && !hasStaleVisibleMetrics,
      isPeriodRefreshing: false,
    };
  }

  const periodSwitchInFlight =
    isRevalidating || (!valuesMatchPeriod && hasStaleVisibleMetrics);

  const showMetricsSkeleton =
    !hasMetricsData && summaryLoading && !hasStaleVisibleMetrics;

  const isPeriodRefreshing =
    (hasMetricsData && isRevalidating) || periodSwitchInFlight;

  return { showMetricsSkeleton, isPeriodRefreshing };
}
