import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Medal, TrendingUp } from "lucide-react";
import type { BusinessDashboardStats } from "../../../lib/api";
import { formatEur } from "../../../lib/formatEur";
import { EmployeeProfilePhoto } from "../../ui/profile-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { businessUi } from "../businessDashboardUi";
import { cn } from "@/lib/utils";

type TeamLeaderboardProps = {
  employees: NonNullable<BusinessDashboardStats["employees"]>;
  goals: NonNullable<BusinessDashboardStats["employeeGoals"]>;
  loading: boolean;
};

function goalForEmployee(
  goals: NonNullable<BusinessDashboardStats["employeeGoals"]>,
  employeeId: string,
) {
  return goals.find((g) => g.employeeId === employeeId) ?? null;
}

export function TeamLeaderboard({ employees, goals, loading }: TeamLeaderboardProps) {
  const { t } = useTranslation();

  const ranked = useMemo(
    () =>
      [...employees]
        .filter((e) => e.isActive !== false)
        .sort((a, b) => b.tipsTotal - a.tipsTotal)
        .slice(0, 10)
        .map((e, index) => ({
          ...e,
          rank: index + 1,
          goal: goalForEmployee(goals, e.id),
        })),
    [employees, goals],
  );

  return (
    <Card className={businessUi.cardStatic}>
      <CardHeader className="border-b border-neutral-100/90">
        <CardTitle className="text-base">{t("business.team.performance.leaderboardTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading && ranked.length === 0 ? (
          <div className="divide-y divide-border/60">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-4">
                <div className="h-8 w-8 rounded-full bg-muted" />
                <div className="h-10 w-10 rounded-md bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-28 rounded bg-muted" />
                  <div className="h-2 w-20 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {ranked.map((row) => {
              const trendUp = (row.goal?.percent ?? 0) >= 70;
              return (
                <li key={row.id} className="flex items-center gap-3 px-4 py-3.5">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      row.rank === 1 && "bg-amber-100 text-amber-800",
                      row.rank === 2 && "bg-slate-100 text-slate-700",
                      row.rank === 3 && "bg-orange-100 text-orange-800",
                      row.rank > 3 && "bg-muted text-muted-foreground",
                    )}
                  >
                    {row.rank <= 3 ? <Medal className="h-4 w-4" aria-hidden /> : row.rank}
                  </span>
                  <EmployeeProfilePhoto src={row.avatar} displayName={row.name} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{row.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.jobTitle}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-foreground">{formatEur(row.tipsTotal)}</p>
                    <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                      <TrendingUp
                        className={cn("h-3 w-3", trendUp ? "text-emerald-600" : "text-amber-600")}
                        aria-hidden
                      />
                      {row.goal
                        ? t("business.team.performance.goalProgress", { percent: Math.round(row.goal.percent) })
                        : t("business.team.performance.rating", {
                            rating: row.rating != null ? row.rating.toFixed(1) : "—",
                          })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
