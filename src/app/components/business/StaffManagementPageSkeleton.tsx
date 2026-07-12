import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StaffRosterTableSkeleton } from "@/app/components/dashboard/DashboardContentSkeletons";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { cn } from "@/lib/utils";

function ShimmerBar({ className }: { className?: string }) {
  return (
    <span className={cn("dashboard-hero-metric-skeleton__bar block rounded-md", className)} aria-hidden />
  );
}

/** Staff management page shell — invite card + stats + table skeletons. */
export function StaffManagementPageSkeleton() {
  const { t: _t } = useTranslation();

  return (
    <div className="space-y-4 pt-2 sm:space-y-5 sm:pt-4">
      <Card className={cn(businessUi.cardStatic, "w-full")}>
        <CardContent className="p-4 sm:p-5">
          <ShimmerBar className="h-4 w-28" />
          <ShimmerBar className="mt-3 h-10 w-48" />
          <ShimmerBar className="mt-4 h-11 w-full rounded-lg" />
        </CardContent>
      </Card>

      <Card className={businessUi.atAGlanceCard}>
        <CardContent className={businessUi.atAGlanceContent}>
          <ShimmerBar className="h-3 w-24" />
          <div className="mt-3 grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <ShimmerBar className="mx-auto h-3 w-16" />
                <ShimmerBar className="mx-auto h-7 w-12" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-6">
        <Card className={cn(businessUi.cardStatic, "w-full")}>
          <CardHeader className="pb-3">
            <ShimmerBar className="h-4 w-16" />
            <ShimmerBar className="mt-2 h-3 w-48" />
          </CardHeader>
          <CardContent>
            <ShimmerBar className="h-12 w-full rounded-lg" />
          </CardContent>
        </Card>

        <StaffRosterTableSkeleton rows={6} />
      </div>
    </div>
  );
}
