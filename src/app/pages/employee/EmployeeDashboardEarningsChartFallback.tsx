import { DashboardChartSkeleton } from "../../components/dashboard/DashboardAnalyticsLoader";

export function EmployeeDashboardEarningsChartFallback() {
  return (
    <section className="employee-period-chart w-full min-w-0" aria-hidden>
      <div className="employee-period-chart__title-skel" />
      <div className="min-h-[200px] sm:min-h-[236px] lg:min-h-[248px]">
        <DashboardChartSkeleton variant="trend" minHeightClass="h-full min-h-0" className="h-full" />
      </div>
    </section>
  );
}
