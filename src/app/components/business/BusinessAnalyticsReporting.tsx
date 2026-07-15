import { lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { RevenueAnalyticsCards } from "./insights/RevenueAnalyticsCards";
import { QrAnalyticsSection } from "./insights/QrAnalyticsSection";
import { OperationalMetricsCards } from "./insights/OperationalMetricsCards";
import { DashboardAnalyticsPeriodToggle } from "../dashboard/DashboardAnalyticsPeriodToggle";
import { DashboardRefreshIndicator } from "../dashboard/DashboardRefreshIndicator";
import { DashboardStatusStrip } from "../dashboard/DashboardStatusStrip";
import { deriveRealtimeStatusItems } from "../../lib/dashboardStatus/deriveDashboardStatus";
import { DashboardChartsIdleMount } from "../dashboard/DashboardChartsIdleMount";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardWorkspaceSummaryCard } from "../dashboard/DashboardWorkspaceSummaryCard";
import { businessUi } from "./businessDashboardUi";
import { cn } from "@/lib/utils";
import { formatEur } from "../../lib/formatEur";
import { downloadBusinessTransactionsExport } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import type { useBusinessIntelligenceData } from "../../hooks/useBusinessIntelligenceData";
import type { TopTipSourceRow } from "../../lib/businessIntelligence";
import type { AnalyticsTimeframe } from "../../hooks/useBusinessDashboardStats";

const BusinessIntelligenceCharts = lazy(() =>
  import("./insights/BusinessIntelligenceCharts").then((mod) => ({
    default: mod.BusinessIntelligenceCharts,
  })),
);

type BiData = ReturnType<typeof useBusinessIntelligenceData>;

type BusinessAnalyticsReportingProps = {
  data: BiData;
  revenueTimeframe: AnalyticsTimeframe;
  onRevenueTimeframeChange: (timeframe: AnalyticsTimeframe) => void;
  qrTimeframe: AnalyticsTimeframe;
  onQrTimeframeChange: (timeframe: AnalyticsTimeframe) => void;
};

function ComparisonTable({
  title,
  rows,
  emptyKey,
}: {
  title: string;
  rows: Array<{ label: string; tips: number; count: number; share: number }>;
  emptyKey: string;
}) {
  const { t } = useTranslation();
  return (
    <Card className={businessUi.cardStatic}>
      <CardHeader className="border-b border-neutral-100/90 pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t(emptyKey)}</p>
        ) : (
          <div className="caretip-mobile-table-scroll overflow-x-auto">
            <table className="w-full min-w-[20rem] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t("business.tips.analytics.reporting.name")}</th>
                <th className="px-4 py-2 font-medium">{t("business.tips.analytics.reporting.tips")}</th>
                <th className="px-4 py-2 font-medium">{t("business.tips.analytics.reporting.count")}</th>
                <th className="px-4 py-2 font-medium">{t("business.tips.analytics.reporting.share")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5 font-medium">{row.label}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatEur(row.tips)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.count}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.share}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Sprint 2 — sole reporting surface for business managers. */
export function BusinessAnalyticsReporting({
  data,
  revenueTimeframe,
  onRevenueTimeframeChange,
  qrTimeframe,
  onQrTimeframeChange,
}: BusinessAnalyticsReportingProps) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadBusinessTransactionsExport();
    } catch (e) {
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const periodLabel =
    revenueTimeframe === "week"
      ? t("dashboard.filter_week")
      : revenueTimeframe === "year"
        ? t("dashboard.filter_year")
        : t("dashboard.filter_month");

  const revenueGrowth = data.bi.revenue.growthPercent;
  const refreshingLabel = t("dashboard.refresh.updating");
  const cardsInitialLoading = data.isInitialAnalyticsLoading;
  const cardsRefreshing = data.isAnalyticsRefreshing;

  const analyticsStatusItems = useMemo(
    () => deriveRealtimeStatusItems(data.connectionStatus ?? "idle", t),
    [data.connectionStatus, t],
  );

  const periodOptions = (["week", "month", "year"] as const).map((period) => ({
    id: period,
    label:
      period === "week"
        ? t("dashboard.filter_week")
        : period === "year"
          ? t("dashboard.filter_year")
          : t("dashboard.filter_month"),
  }));

  return (
    <div className="caretip-mobile-analytics-report space-y-6 md:space-y-8">
      <DashboardWorkspaceSummaryCard
        title={t("premium.summaryBanner.title")}
        periodLabel={periodLabel}
        metrics={[
          {
            label: t("premium.summaryBanner.revenueTrend"),
            value: <CountUpMetric value={data.period.totalTips} kind="eur" format={formatEur} />,
            trend: t("premium.summaryBanner.growthValue", { percent: revenueGrowth }),
            trendDirection: revenueGrowth >= 0 ? "up" : "down",
          },
          {
            label: t("business.tips.analytics.cards.totalTips"),
            value: <CountUpMetric value={data.period.tipCount} kind="integer" />,
            trend: t("business.tips.live.cards.tipCount", { count: data.week.tipCount }),
            trendDirection: "neutral",
          },
          {
            label: t("business.tips.analytics.cards.activeEmployees"),
            value: <CountUpMetric value={data.bi.operational.activeEmployees} kind="integer" />,
            trend: t("business.tips.analytics.employeeTipCount", {
              count: data.bi.operational.employeesReceivingTips,
            }),
            trendDirection: "neutral",
          },
        ]}
      />

      <section className="space-y-3" aria-labelledby="business-revenue-analytics-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2
              id="business-revenue-analytics-heading"
              className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t("business.team.performance.bi.revenueTitle")}
            </h2>
            <DashboardRefreshIndicator
              isRefreshing={cardsRefreshing}
              lastUpdatedAt={data.lastUpdatedAt}
            />
          </div>
          <DashboardStatusStrip items={analyticsStatusItems} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DashboardAnalyticsPeriodToggle
            ariaLabel={t("business.tips.analytics.revenuePeriodAria")}
            value={revenueTimeframe}
            onChange={onRevenueTimeframeChange}
            options={periodOptions.map((option) => ({
              ...option,
              loading: data.isAnalyticsRefreshing && revenueTimeframe === option.id,
            }))}
          />
          <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={() => void handleExport()}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            {t("business.tips.analytics.reporting.export")}
          </Button>
        </div>
        <RevenueAnalyticsCards
          data={data.input}
          loading={cardsInitialLoading}
          refreshing={cardsRefreshing}
          refreshingLabel={refreshingLabel}
          showHeading={false}
        />
      </section>

      <section className="space-y-3" aria-labelledby="business-qr-analytics-heading">
        <h2
          id="business-qr-analytics-heading"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("business.team.performance.bi.qrTitle")}
          <span className="ml-2 font-normal normal-case text-muted-foreground/80">
            ({periodLabel})
          </span>
        </h2>
        <QrAnalyticsSection
          timeframe={qrTimeframe}
          showHeading={false}
          data={qrTimeframe === revenueTimeframe ? data.input.qrAnalytics : undefined}
          dataLoading={qrTimeframe === revenueTimeframe ? cardsInitialLoading : undefined}
          dataRefreshing={qrTimeframe === revenueTimeframe ? cardsRefreshing : undefined}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("business.tips.analytics.sections.employees")}
        </h2>
        <OperationalMetricsCards
          data={data.input}
          loading={cardsInitialLoading}
          refreshing={cardsRefreshing}
          refreshingLabel={refreshingLabel}
        />
        <p className="text-sm text-muted-foreground">
          {t("business.tips.analytics.rankingsHint")}{" "}
          <Link to="/dashboard/team/top-performers" className="font-medium text-primary underline-offset-2 hover:underline">
            {t("business.team.nav.topPerformers")}
          </Link>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("business.tips.analytics.sections.locations")}
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <ComparisonTable
            title={t("business.tips.analytics.locationComparison")}
            rows={data.bi.locations}
            emptyKey="business.tips.analytics.locationEmpty"
          />
          <ComparisonTable
            title={t("business.tips.analytics.tableComparison")}
            rows={data.bi.tables}
            emptyKey="business.tips.analytics.tableEmpty"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("business.tips.analytics.sections.topQr")}
        </h2>
        <Card className={businessUi.cardStatic}>
          <CardContent className="divide-y divide-border/60 p-0 pt-2">
            {data.bi.topTipSources.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t("business.tips.analytics.topQrEmpty")}
              </p>
            ) : (
              data.bi.topTipSources.map((row: TopTipSourceRow, i: number) => (
                <div key={row.label} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-5 text-xs font-bold text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t("business.tips.analytics.employeeTipCount", { count: row.tipCount })}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{formatEur(row.tips)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3" aria-labelledby="business-advanced-trends-heading">
        <h2
          id="business-advanced-trends-heading"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("business.tips.analytics.sections.advancedTrends")}
        </h2>
        <DashboardChartsIdleMount
          whenVisible
          fallback={
            <div className={cn(businessUi.cardStatic, "h-[280px] animate-pulse bg-muted/30")} />
          }
        >
          <BusinessIntelligenceCharts data={data.input} loading={cardsInitialLoading} />
        </DashboardChartsIdleMount>
      </section>
    </div>
  );
}
