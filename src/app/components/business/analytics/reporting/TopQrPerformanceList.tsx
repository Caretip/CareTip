import { memo } from "react";
import { useTranslation } from "react-i18next";
import { businessUi } from "../../businessDashboardUi";
import { formatEur } from "../../../../lib/formatEur";
import type { TopTipSourceRow } from "../../../../lib/businessIntelligence";
import { cn } from "@/lib/utils";

type TopQrPerformanceListProps = {
  rows: TopTipSourceRow[];
  loading?: boolean;
  className?: string;
};

export const TopQrPerformanceList = memo(function TopQrPerformanceList({
  rows,
  loading,
  className,
}: TopQrPerformanceListProps) {
  const { t } = useTranslation();

  return (
    <div className={cn(businessUi.cardStatic, "overflow-hidden", className)}>
      <div className="border-b border-border/60 px-4 py-3 sm:px-5">
        <h3 className={businessUi.cardTitle}>{t("business.tips.analytics.sections.topQr")}</h3>
      </div>
      {loading ? (
        <div className="space-y-2 px-4 py-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {t("business.tips.analytics.topQrEmpty")}
        </p>
      ) : (
        <ol className="m-0 list-none divide-y divide-border/60 p-0">
          {rows.map((row, i) => (
            <li key={row.label} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <span className="w-5 text-xs font-bold tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{row.label}</span>
              <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                {t("business.tips.analytics.employeeTipCount", { count: row.tipCount })}
              </span>
              <span className="text-sm font-semibold tabular-nums text-foreground">{formatEur(row.tips)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});
