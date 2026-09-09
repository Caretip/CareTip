import { useTranslation } from "react-i18next";
import { Award, Crown, Sparkles, Star, Trophy } from "lucide-react";
import type { BusinessDashboardStats } from "../../../lib/api";
import { formatEur } from "../../../lib/formatEur";
import { EmployeeProfilePhoto } from "../../ui/profile-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { businessUi } from "../businessDashboardUi";
import { cn } from "@/lib/utils";

type EmployeeAwardsSectionProps = {
  employees: NonNullable<BusinessDashboardStats["employees"]>;
  goals: NonNullable<BusinessDashboardStats["employeeGoals"]>;
};

export function EmployeeAwardsSection({ employees, goals }: EmployeeAwardsSectionProps) {
  const { t } = useTranslation();

  const topEarner = [...employees].sort((a, b) => b.tipsTotal - a.tipsTotal)[0];
  const topRated = [...employees]
    .filter((e) => e.rating != null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  const risingStar = [...goals].sort((a, b) => b.percent - a.percent)[0];
  const risingEmployee = risingStar
    ? employees.find((e) => e.id === risingStar.employeeId)
    : null;

  const awards = [
    {
      key: "employeeOfMonth",
      icon: Crown,
      tone: "bg-amber-500/15 text-amber-800",
      name: topEarner?.name,
      avatar: topEarner?.avatar,
      detail: topEarner ? formatEur(topEarner.tipsTotal) : "—",
    },
    {
      key: "risingStar",
      icon: Sparkles,
      tone: "bg-violet-500/15 text-violet-800",
      name: risingEmployee?.name ?? risingStar?.name,
      avatar: risingEmployee?.avatar,
      detail: risingStar ? `${Math.round(risingStar.percent)}%` : "—",
    },
    {
      key: "hospitality",
      icon: Star,
      tone: "bg-emerald-500/15 text-emerald-800",
      name: topRated?.name,
      avatar: topRated?.avatar,
      detail: topRated?.rating != null ? `★ ${topRated.rating.toFixed(1)}` : "—",
    },
  ];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t("business.team.topPerformers.awardsTitle")}
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {awards.map(({ key, icon: Icon, tone, name, avatar, detail }) => (
          <Card key={key} className={cn(businessUi.cardStatic, "overflow-hidden")}>
            <CardContent className="flex items-center gap-3 p-4">
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                  tone,
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t(`business.team.topPerformers.awards.${key}`)}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  {name ? (
                    <EmployeeProfilePhoto src={avatar} displayName={name} className="h-8 w-8" />
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{name ?? "—"}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{detail}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

type RecognitionBadgesProps = {
  goals: NonNullable<BusinessDashboardStats["employeeGoals"]>;
};

export function RecognitionBadges({ goals }: RecognitionBadgesProps) {
  const { t } = useTranslation();
  const achieved = goals.filter((g) => g.status === "achieved").length;
  const onTrack = goals.filter((g) => g.status === "on_track").length;
  const streaks = goals.filter((g) => g.percent >= 50).length;

  const badges = [
    { key: "achievements", count: achieved, icon: Trophy },
    { key: "streaks", count: streaks, icon: Sparkles },
    { key: "onTrack", count: onTrack, icon: Award },
  ];

  return (
    <Card className={businessUi.cardStatic}>
      <CardHeader className="border-b border-neutral-100/90">
        <CardTitle className="text-base">{t("business.team.topPerformers.recognitionTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
        {badges.map(({ key, count, icon: Icon }) => (
          <div
            key={key}
            className="flex flex-col items-center rounded-xl border border-border/70 bg-muted/20 px-3 py-4 text-center"
          >
            <Icon className="mb-2 h-6 w-6 text-primary" aria-hidden />
            <p className="text-2xl font-bold tabular-nums text-foreground">{count}</p>
            <p className="text-xs text-muted-foreground">{t(`business.team.topPerformers.badges.${key}`)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
