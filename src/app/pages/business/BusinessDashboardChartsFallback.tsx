import { businessUi } from "../../components/business/businessDashboardUi";
import { DashboardChartSkeleton } from "../../components/dashboard/DashboardAnalyticsLoader";

export function BusinessDashboardChartsFallback() {
  return (
    <div className={businessUi.analyticsChartsGrid} aria-hidden>
      <div className="flex min-h-0 w-full min-w-0">
        <section className="business-period-chart business-dashboard-chart-card w-full min-w-0">
          <div className="mb-3 h-4 w-36 rounded-sm bg-muted/60" />
          <DashboardChartSkeleton variant="trend" minHeightClass="business-overview-analytics__plot" className="h-auto" />
        </section>
      </div>
      <div className="flex min-h-0 w-full min-w-0">
        <section className="business-period-chart business-dashboard-chart-card business-overview-leaderboard w-full min-w-0">
          <div className="business-overview-leaderboard__head">
            <div>
              <div className="h-4 w-32 rounded-sm bg-muted/60" />
              <div className="mt-2 h-3 w-20 rounded-sm bg-muted/50" />
            </div>
            <div className="h-3 w-24 rounded-sm bg-muted/50" />
          </div>
          <div className="business-overview-leaderboard__list">
            {[0, 1, 2].map((row) => (
              <div key={row} className="business-overview-leaderboard__row">
                <span className="h-3 w-3 rounded-sm bg-muted/70" />
                <span className="h-8 w-8 rounded-md bg-muted/70" />
                <span className="h-3 w-24 max-w-full rounded-sm bg-muted/70" />
                <span className="h-3 w-12 rounded-sm bg-muted/70" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
