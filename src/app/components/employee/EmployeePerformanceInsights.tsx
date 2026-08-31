import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Flame, Target, TrendingUp } from "lucide-react";
import type { EmployeeGoalProgress, TipItem } from "../../lib/api";
import { computeEmployeeTipStreakDays } from "../../lib/employeeFormat";
import { formatEur } from "../../lib/formatEur";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { employeeUi } from "../employee/employeeDashboardUi";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { cn } from "@/lib/utils";

type EmployeePerformanceInsightsProps = {
  tips: TipItem[];
  goalProgress: EmployeeGoalProgress | null;
  periodAmountEur: number;
  monthlyGoal: number | null;
  loading?: boolean;
};

export function EmployeePerformanceInsights({
  tips,
  goalProgress,
  periodAmountEur,
  monthlyGoal,
  loading,
}: EmployeePerformanceInsightsProps) {
  const { t } = useTranslation();

  const streak = useMemo(() => computeEmployeeTipStreakDays(tips), [tips]);
  const goalPercent = goalProgress?.percent ?? (monthlyGoal && monthlyGoal > 0 ? Math.min(100, (periodAmountEur / monthlyGoal) * 100) : 0);

  return (
    <Card
      className={cn(
        employeeUi.cardStatic,
        employeeUi.mobileFlatSurface,
        "employee-performance-insights dashboard-mobile-flat-surface w-full",
      )}
    >
      <CardHeader className={employeeUi.cardHeader}>
        <CardTitle className={employeeUi.cardTitle}>{t("employee.performance.title")}</CardTitle>
      </CardHeader>
      <CardContent className="max-lg:px-0 max-lg:pb-0">
        <div className="employee-performance-insights__grid grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          <div className="employee-performance-insights__tile rounded-xl border border-dashed border-border/70 bg-muted/15 p-4 text-center max-lg:rounded-lg max-lg:border-solid max-lg:border-border/60 max-lg:bg-transparent max-lg:p-3 max-lg:text-left">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
              {t("common.comingSoonBadge")}
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground max-lg:mt-1">{t("kpiTrust.leaderboardComingSoon")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("kpiTrust.leaderboardComingSoonBody")}</p>
          </div>
          <div className="employee-performance-insights__tile rounded-xl border border-border/60 bg-muted/20 p-4 max-lg:rounded-lg max-lg:bg-transparent max-lg:p-3">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <Target className="h-4 w-4 text-primary" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wide">{t("employee.performance.goal")}</span>
            </div>
            <p className="text-2xl font-semibold tabular-nums text-foreground max-lg:text-xl">
              {loading ? "—" : <CountUpMetric value={goalPercent} kind="percent" />}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {monthlyGoal ? t("employee.performance.goalTarget", { amount: formatEur(monthlyGoal) }) : t("employee.performance.goalOpen")}
            </p>
          </div>
          <div className="employee-performance-insights__tile rounded-xl border border-border/60 bg-muted/20 p-4 max-lg:rounded-lg max-lg:bg-transparent max-lg:p-3">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <Flame className="h-4 w-4 text-amber-600" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wide">{t("employee.performance.streak")}</span>
            </div>
            <p className="text-2xl font-semibold tabular-nums text-foreground max-lg:text-xl">
              {loading ? "—" : t("employee.performance.streakDays", { count: streak })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t("employee.performance.streakHint")}</p>
          </div>
          <div className="employee-performance-insights__tile rounded-xl border border-border/60 bg-muted/20 p-4 max-lg:rounded-lg max-lg:bg-transparent max-lg:p-3">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wide">{t("employee.performance.trend")}</span>
            </div>
            <p className="text-2xl font-semibold tabular-nums text-foreground max-lg:text-xl">
              {loading ? "—" : <CountUpMetric value={periodAmountEur} kind="eur" />}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t("employee.performance.trendHint")}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

