import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { DashboardChartSkeleton } from "../../components/dashboard/DashboardAnalyticsLoader";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";

export function EmployeeDashboardEarningsChartFallback() {
  return (
    <Card className={cn(employeeUi.cardStatic, employeeUi.chartCard, "dashboard-chart-card w-full")} aria-hidden>
      <CardHeader className={employeeUi.cardHeader}>
        <div className="h-6 w-36 rounded-md bg-muted/60" />
      </CardHeader>
      <CardContent className="min-h-[220px] sm:min-h-[260px] lg:min-h-[280px]">
        <DashboardChartSkeleton variant="trend" minHeightClass="h-full min-h-0" className="h-full" />
      </CardContent>
    </Card>
  );
}
