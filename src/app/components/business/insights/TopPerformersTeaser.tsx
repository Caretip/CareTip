import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileAvatar } from "../../ui/profile-avatar";
import { DashboardViewAllLink } from "../../dashboard/DashboardViewAllLink";
import { businessUi } from "../businessDashboardUi";
import { formatEur } from "../../../lib/formatEur";
import { cn } from "@/lib/utils";

import { TEAM_LEADERBOARD_HREF } from "../businessDashboardNav";

export const TOP_PERFORMERS_PAGE_PATH = TEAM_LEADERBOARD_HREF;

export const DASHBOARD_EMPLOYEE_TEASER_LIMIT = 3;

export type TopPerformerTeaserEmployee = {
  id: string;
  name: string;
  avatar: string | null;
  tips: number;
};

type TopPerformersTeaserProps = {
  employees: TopPerformerTeaserEmployee[];
  loading?: boolean;
};

export function TopPerformersTeaser({ employees, loading }: TopPerformersTeaserProps) {
  const { t } = useTranslation();
  const teaser = employees.slice(0, DASHBOARD_EMPLOYEE_TEASER_LIMIT);

  return (
    <Card className={cn(businessUi.cardStatic, "business-dashboard-top-performer-card h-full")}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-b border-neutral-100/90 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Trophy className="h-4 w-4 text-primary" aria-hidden />
          {t("business.dashboard.topPerformers")}
        </CardTitle>
        <DashboardViewAllLink to={TEAM_LEADERBOARD_HREF}>
          {t("business.dashboard.viewAllTopPerformers")}
        </DashboardViewAllLink>
      </CardHeader>
      <CardContent className="pt-3.5">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: DASHBOARD_EMPLOYEE_TEASER_LIMIT }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        ) : teaser.length > 0 ? (
          <ul className="space-y-2">
            {teaser.map((employee, index) => (
              <li
                key={employee.id}
                className="business-dashboard-top-performer-row flex items-center gap-3 rounded-xl border px-3.5 py-3"
              >
                <span className="business-dashboard-top-performer-rank" aria-hidden>
                  #{index + 1}
                </span>
                <ProfileAvatar
                  src={employee.avatar}
                  displayName={employee.name}
                  className="business-dashboard-top-performer-avatar h-11 w-11"
                />
                <div className="min-w-0 flex-1">
                  <p className="business-dashboard-top-performer-name truncate">{employee.name}</p>
                  <p className="business-dashboard-top-performer-earnings tabular-nums">{formatEur(employee.tips)}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("business.dashboard.topPerformersEmptyHint")}</p>
        )}
      </CardContent>
    </Card>
  );
}
