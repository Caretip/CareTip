import { useTranslation } from "react-i18next";
import { StaffRosterTableSkeleton } from "@/app/components/dashboard/DashboardContentSkeletons";
import { cn } from "@/lib/utils";

function ShimmerBar({ className }: { className?: string }) {
  return (
    <span className={cn("dashboard-hero-metric-skeleton__bar block rounded-md", className)} aria-hidden />
  );
}

/** Staff management page shell — invite callout + KPI strip + roster skeletons. */
export function StaffManagementPageSkeleton() {
  const { t: _t } = useTranslation();

  return (
    <div className="team-employees-workspace pt-2 sm:pt-4">
      <div className="team-employees-invite">
        <ShimmerBar className="h-4 w-40" />
        <ShimmerBar className="mt-2 h-4 w-full max-w-md" />
      </div>

      <div className="team-employees-kpi-strip">
        {[1, 2, 3, 4].map((i) => (
          <div key={i}>
            <ShimmerBar className="h-3 w-16" />
            <ShimmerBar className="mt-2 h-7 w-12" />
          </div>
        ))}
      </div>

      <section className="team-employees-roster">
        <div className="team-employees-roster__header">
          <div>
            <ShimmerBar className="h-5 w-32" />
            <ShimmerBar className="mt-2 h-4 w-24" />
          </div>
          <ShimmerBar className="h-11 w-full max-w-xs rounded-lg sm:max-w-[18rem]" />
        </div>
        <StaffRosterTableSkeleton rows={6} />
      </section>
    </div>
  );
}
