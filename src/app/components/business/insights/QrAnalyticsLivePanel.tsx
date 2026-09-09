import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de, enUS } from "date-fns/locale";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/app/components/ui/collapsible";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { businessUi } from "../businessDashboardUi";
import { BUSINESS_CHART_GRID, getBusinessChartTooltipStyle } from "../businessDashboardChartTheme";
import { LIGHTWEIGHT_AREA } from "../../../lib/lightweightChartProps";
import { CountUpMetric } from "../../dashboard/CountUpMetric";
import { cn } from "@/lib/utils";
import type { BusinessQrAnalytics } from "../../../lib/api";

type QrAnalyticsLivePanelProps = {
  data: BusinessQrAnalytics | null;
  loading?: boolean;
  refreshing?: boolean;
  compact?: boolean;
  className?: string;
};

function MetricTile({
  label,
  value,
  hint,
  loading,
  refreshing,
}: {
  label: string;
  value: number;
  hint?: string;
  loading?: boolean;
  refreshing?: boolean;
}) {
  const showPlaceholder = loading && !refreshing;
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {showPlaceholder ? "—" : <CountUpMetric value={value} kind="integer" />}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/90">{hint}</p> : null}
    </div>
  );
}

/** Sprint 4E — DB-backed QR analytics (qr_scan_events only). */
export function QrAnalyticsLivePanel({
  data,
  loading,
  refreshing = false,
  compact,
  className,
}: QrAnalyticsLivePanelProps) {
  const { t, i18n } = useTranslation();
  const timeLocale = i18n.language?.toLowerCase().startsWith("de") ? de : enUS;
  const [recentOpen, setRecentOpen] = useState(false);

  const topQr = useMemo(() => {
    if (!data) return null;
    const fromSlug = data.scansByQrSlug[0];
    if (fromSlug) return { label: fromSlug.qrSlug, count: fromSlug.count };
    const fromTable = data.scansByTable[0];
    if (fromTable) return { label: fromTable.label, count: fromTable.count };
    const fromEmployee = data.scansByEmployee[0];
    if (fromEmployee) return { label: fromEmployee.label, count: fromEmployee.count };
    return null;
  }, [data]);

  const topLocation = data?.scansByLocation[0] ?? null;
  const topEmployee = data?.scansByEmployee[0] ?? null;
  const hasTrend = (data?.scanTrend.some((r) => r.count > 0) ?? false) && (!loading || refreshing);

  return (
    <div className={cn("space-y-4", className)}>
      <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
        <MetricTile label={t("business.qrAnalytics.totalScans")} value={data?.totalScans ?? 0} loading={loading} refreshing={refreshing} />
        <MetricTile
          label={t("business.qrAnalytics.uniqueVisitors")}
          hint={t("business.qrAnalytics.uniqueVisitorsHint")}
          value={data?.uniqueScans ?? 0}
          loading={loading}
          refreshing={refreshing}
        />
        {!compact ? (
          <MetricTile
            label={t("business.qrAnalytics.repeatScans")}
            hint={t("business.qrAnalytics.repeatScansHint")}
            value={data?.repeatScans ?? 0}
            loading={loading}
            refreshing={refreshing}
          />
        ) : null}
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">{t("business.qrAnalytics.topQr")}</p>
          <p className="mt-1 truncate text-sm font-medium">{topQr?.label ?? t("format.noDataYet")}</p>
          {topQr ? (
            <p className="text-xs tabular-nums text-muted-foreground">
              {t("business.qrAnalytics.scanCount", { count: topQr.count })}
            </p>
          ) : null}
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">{t("business.qrAnalytics.topLocation")}</p>
          <p className="mt-1 truncate text-sm font-medium">{topLocation?.label ?? t("format.noDataYet")}</p>
          {topLocation ? (
            <p className="text-xs tabular-nums text-muted-foreground">
              {t("business.qrAnalytics.scanCount", { count: topLocation.count })}
            </p>
          ) : null}
        </div>
        <div className="rounded-xl border border-border/60 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">{t("business.qrAnalytics.topEmployeeQr")}</p>
          <p className="mt-1 truncate text-sm font-medium">{topEmployee?.label ?? t("format.noDataYet")}</p>
          {topEmployee ? (
            <p className="text-xs tabular-nums text-muted-foreground">
              {t("business.qrAnalytics.scanCount", { count: topEmployee.count })}
            </p>
          ) : null}
        </div>
      </div>

      {!compact ? (
        <Card className={businessUi.cardStatic}>
          <CardContent className="pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("business.qrAnalytics.scanTrend")}
            </p>
            {!hasTrend ? (
              <p className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                {t("business.qrAnalytics.emptyTrend")}
              </p>
            ) : (
              <div className="h-[160px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data!.scanTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 6" stroke={BUSINESS_CHART_GRID} vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} style={{ fontSize: 9 }} />
                    <YAxis tickLine={false} axisLine={false} width={28} style={{ fontSize: 9 }} allowDecimals={false} />
                    <Tooltip contentStyle={getBusinessChartTooltipStyle()} />
                    <Area
                      dataKey="count"
                      stroke="#197278"
                      fill="rgba(25,114,120,0.12)"
                      {...LIGHTWEIGHT_AREA}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!compact && data && data.recentScans.length > 0 ? (
        <Collapsible open={recentOpen} onOpenChange={setRecentOpen}>
          <div className="rounded-xl border border-border/60">
            <CollapsibleTrigger
              type="button"
              className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("business.qrAnalytics.recentActivity")}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  recentOpen && "rotate-180",
                )}
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="divide-y divide-border/60 border-t border-border/60">
                {data.recentScans.map((row, i) => (
                  <li
                    key={`${row.scannedAt}-${i}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium">{row.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(row.scannedAt), { addSuffix: true, locale: timeLocale })}
                    </span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
}
