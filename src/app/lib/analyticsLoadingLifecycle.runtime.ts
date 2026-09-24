import {
  deriveAnalyticsLoadingLifecycle,
  derivePeriodScopedSectionLoading,
} from "./analyticsLoadingLifecycle";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// Primary stats ready while deferred bundle still in flight — must not show global refresh.
const deferredHydration = deriveAnalyticsLoadingLifecycle({
  hasVisibleAnalyticsData: true,
  isColdLoading: false,
  isTimeframeLoading: true,
  valuesMatchPeriod: true,
  periodStatsReady: true,
});
assert(!deferredHydration.isAnalyticsRefreshing, "deferred hydration must not keep Updating… active");

// Period switch before above-fold lands — should show refresh.
const periodSwitch = deriveAnalyticsLoadingLifecycle({
  hasVisibleAnalyticsData: true,
  isColdLoading: false,
  isTimeframeLoading: true,
  valuesMatchPeriod: false,
  periodStatsReady: false,
});
assert(periodSwitch.isAnalyticsRefreshing, "period switch should show Updating…");

// Stable page — no refresh indicator.
const stable = deriveAnalyticsLoadingLifecycle({
  hasVisibleAnalyticsData: true,
  isColdLoading: false,
  isTimeframeLoading: false,
  valuesMatchPeriod: true,
  periodStatsReady: true,
});
assert(!stable.isAnalyticsRefreshing, "stable analytics must clear Updating…");
assert(!stable.isInitialAnalyticsLoading, "stable analytics must not be initial loading");

// Cold load — skeleton only, not refresh.
const cold = deriveAnalyticsLoadingLifecycle({
  hasVisibleAnalyticsData: false,
  isColdLoading: true,
  isTimeframeLoading: false,
  valuesMatchPeriod: false,
  periodStatsReady: false,
});
assert(cold.isInitialAnalyticsLoading, "cold load uses initial loading");
assert(!cold.isAnalyticsRefreshing, "cold load must not use refresh indicator");

// Period-scoped helper: mismatch shows section loading without fetch.
assert(
  derivePeriodScopedSectionLoading({
    valuesMatchPeriod: false,
    sliceReady: true,
    fetchInFlight: false,
  }),
  "period mismatch keeps section loading",
);

console.log("analytics-loading-lifecycle.runtime: OK");
