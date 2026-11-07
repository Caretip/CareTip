import { useTranslation } from "react-i18next";
import { Users, Building2, MapPin, Activity } from "lucide-react";
import type { PlatformGlobalStats } from "../../lib/api";
import { platformUi } from "./platformDashboardUi";

type PlatformUsageKpiStripProps = {
  stats: PlatformGlobalStats | null;
  loading?: boolean;
};

export function PlatformUsageKpiStrip({ stats, loading }: PlatformUsageKpiStripProps) {
  const { t } = useTranslation();

  const items = [
    {
      icon: Users,
      label: t("admin.usageReportsPage.kpi.activeUsers"),
      value: stats?.activeUsersCount ?? "—",
    },
    {
      icon: Building2,
      label: t("admin.usageReportsPage.kpi.employees"),
      value: stats?.employeesCount ?? "—",
    },
    {
      icon: MapPin,
      label: t("admin.usageReportsPage.kpi.locations"),
      value: stats?.locationsCount ?? "—",
    },
    {
      icon: Activity,
      label: t("admin.usageReportsPage.kpi.transactions"),
      value: stats?.transactionCount ?? "—",
    },
  ];

  return (
    <div className={`${platformUi.statGrid} mb-6`}>
      {items.map(({ icon: Icon, label, value }) => (
        <div
          key={label}
          className="flex min-h-[5.5rem] flex-col justify-between rounded-lg border border-border bg-card p-4 shadow-sm"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="text-pretty text-xs font-medium leading-snug line-clamp-2">{label}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {loading ? "…" : typeof value === "number" ? new Intl.NumberFormat("de-DE").format(value) : value}
          </p>
        </div>
      ))}
    </div>
  );
}
