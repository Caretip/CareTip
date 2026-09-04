import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TeamLeaderboard } from "./TeamLeaderboard";
import { EmployeeAwardsSection, RecognitionBadges } from "./TopPerformersGamification";
import { LocationLeaderboard } from "./LocationLeaderboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { businessUi } from "../businessDashboardUi";
import { formatEur } from "../../../lib/formatEur";
import { ProfileAvatar } from "../../ui/profile-avatar";
import type { useBusinessTipsModuleData } from "../../../hooks/useBusinessTipsModuleData";

type TipsModuleData = ReturnType<typeof useBusinessTipsModuleData>;

export function BusinessTeamLeaderboardPanel({
  data,
  showInitialSkeleton,
}: {
  data: TipsModuleData;
  showInitialSkeleton: boolean;
}) {
  const { t } = useTranslation();

  const rankingCategories = useMemo(() => {
    const active = data.employees.filter((e) => e.isActive !== false);
    const topEarners = [...active].sort((a, b) => b.tipsTotal - a.tipsTotal).slice(0, 3);
    const fastestGrowing = [...data.employeeGoals]
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 3)
      .map((g) => ({
        ...g,
        employee: active.find((e) => e.id === g.employeeId),
      }));
    const highestAvg = [...active]
      .filter((e) => e.tipCount > 0)
      .sort((a, b) => b.tipsTotal / b.tipCount - a.tipsTotal / a.tipCount)
      .slice(0, 3);
    return { topEarners, fastestGrowing, highestAvg };
  }, [data.employees, data.employeeGoals]);

  const topByRating = useMemo(
    () =>
      [...data.employees]
        .filter((e) => e.rating != null)
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        .slice(0, 5),
    [data.employees],
  );

  return (
    <div className="space-y-8 pt-2">
      <p className="text-sm text-muted-foreground">{t("business.team.topPerformersDesc")}</p>
      <EmployeeAwardsSection employees={data.employees} goals={data.employeeGoals} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("business.team.topPerformers.rankingsTitle")}
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {(
            [
              {
                key: "topEarners",
                rows: rankingCategories.topEarners,
                metric: (e: (typeof rankingCategories.topEarners)[0]) => formatEur(e.tipsTotal),
              },
              {
                key: "fastestGrowing",
                rows: rankingCategories.fastestGrowing,
                metric: (g: (typeof rankingCategories.fastestGrowing)[0]) => `${Math.round(g.percent)}%`,
              },
              {
                key: "highestAvg",
                rows: rankingCategories.highestAvg,
                metric: (e: (typeof rankingCategories.highestAvg)[0]) =>
                  formatEur(e.tipCount > 0 ? e.tipsTotal / e.tipCount : 0),
              },
            ] as const
          ).map(({ key, rows, metric }) => (
            <Card key={key} className={businessUi.cardStatic}>
              <CardHeader className="border-b border-neutral-100/90 pb-3">
                <CardTitle className="text-sm">{t(`business.team.topPerformers.categories.${key}`)}</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border/60 p-0">
                {rows.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                    {t("business.team.topPerformers.empty")}
                  </p>
                ) : (
                  rows.map((row, i) => {
                    const name = "employee" in row ? row.employee?.name ?? row.name : row.name;
                    const avatar = "employee" in row ? row.employee?.avatar : row.avatar;
                    return (
                      <div key={i} className="flex items-center gap-3 px-4 py-3">
                        <span className="w-5 text-xs font-bold text-muted-foreground">{i + 1}</span>
                        <ProfileAvatar src={avatar} displayName={name} className="h-8 w-8" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                        <span className="text-xs font-semibold tabular-nums">
                          {"employee" in row ? metric(row as never) : metric(row as never)}
                        </span>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TeamLeaderboard
            employees={data.employees}
            goals={data.employeeGoals}
            loading={showInitialSkeleton}
          />
        </div>
        <Card className={businessUi.cardStatic}>
          <CardHeader className="border-b border-neutral-100/90">
            <CardTitle className="text-base">{t("business.team.performance.topRatedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/60 p-0">
            {topByRating.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t("business.team.performance.topRatedEmpty")}
              </p>
            ) : (
              topByRating.map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-4 py-3.5">
                  <ProfileAvatar src={e.avatar} displayName={e.name} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.name}</p>
                    <p className="text-xs text-muted-foreground">{formatEur(e.tipsTotal)}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    ★ {(e.rating ?? 0).toFixed(1)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <LocationLeaderboard rankings={data.locationRankings} />
        <RecognitionBadges goals={data.employeeGoals} />
      </div>
    </div>
  );
}
