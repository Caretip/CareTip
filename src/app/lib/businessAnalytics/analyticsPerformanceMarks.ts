/** Client-side marks for analytics performance validation (Playwright / devtools). */
export type AnalyticsPerformanceMark =
  | "analytics.route.mount"
  | "analytics.summary.request"
  | "analytics.summary.ready"
  | "analytics.deferred.request"
  | "analytics.deferred.ready"
  | "analytics.stats.request"
  | "analytics.stats.ready"
  | "analytics.tipsFeed.ready"
  | "analytics.qr.ready"
  | "analytics.financial.request"
  | "analytics.financial.ledger.ready"
  | "analytics.financial.connect.ready"
  | "analytics.financial.reconciliation.ready"
  | "analytics.overview.render"
  | "analytics.revenue.render"
  | "analytics.operational.render";

declare global {
  interface Window {
    __CARETIP_ANALYTICS_PERF__?: Record<string, number>;
  }
}

export function markAnalyticsPerformance(mark: AnalyticsPerformanceMark): void {
  const ts = performance.now();
  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    performance.mark(mark);
  }
  if (typeof window !== "undefined") {
    const bag = window.__CARETIP_ANALYTICS_PERF__ ?? {};
    bag[mark] = ts;
    window.__CARETIP_ANALYTICS_PERF__ = bag;
  }
}
