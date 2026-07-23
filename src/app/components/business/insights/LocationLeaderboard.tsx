import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { formatEur } from "../../../lib/formatEur";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { businessUi } from "../businessDashboardUi";

export type LocationRankingRow = {
  id?: string | null;
  name: string;
  tipsEur: number;
  tipCount: number;
};

type LocationLeaderboardProps = {
  rankings: LocationRankingRow[];
};

export function LocationLeaderboard({ rankings }: LocationLeaderboardProps) {
  const { t } = useTranslation();

  const ranked = useMemo(
    () =>
      [...rankings]
        .filter((r) => r.tipsEur > 0 || r.tipCount > 0)
        .sort((a, b) => b.tipsEur - a.tipsEur)
        .slice(0, 5),
    [rankings],
  );

  return (
    <Card className={businessUi.cardStatic}>
      <CardHeader className="border-b border-neutral-100/90">
        <CardTitle className="text-base">{t("business.team.topPerformers.locationLeaderboard")}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border/60 p-0">
        {ranked.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("business.team.topPerformers.locationEmpty")}
          </p>
        ) : (
          ranked.map((row, index) => (
            <div key={row.id ?? row.name} className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                {index + 1}
              </span>
              <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("business.team.topPerformers.tipCount", { count: row.tipCount })}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatEur(row.tipsEur)}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
