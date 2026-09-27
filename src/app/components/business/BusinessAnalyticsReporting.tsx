import { useEffect, useMemo, useRef, useState } from "react";
import { markAnalyticsPerformance } from "../../lib/businessAnalytics/analyticsPerformanceMarks";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { QrAnalyticsSection } from "./insights/QrAnalyticsSection";
import { DashboardAnalyticsPeriodToggle } from "../dashboard/DashboardAnalyticsPeriodToggle";
import { DashboardRefreshIndicator } from "../dashboard/DashboardRefreshIndicator";
import { DashboardStatusStrip } from "../dashboard/DashboardStatusStrip";
import { deriveRealtimeStatusItems } from "../../lib/dashboardStatus/deriveDashboardStatus";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { Button } from "@/components/ui/button";
import { formatEur } from "../../lib/formatEur";
import { downloadBusinessTransactionsExport } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { shouldShowCurrentWeekContext } from "../../lib/businessAnalytics/analyticsPeriodMetrics";
import { computeRevenueAnalytics } from "../../lib/businessIntelligence";
import type { useBusinessIntelligenceData } from "../../hooks/useBusinessIntelligenceData";
import type { AnalyticsTimeframe } from "../../hooks/useBusinessDashboardStats";
import { BusinessFinancialAnalyticsSection } from "./BusinessFinancialAnalyticsSection";
import { AnalyticsKpiStrip, type AnalyticsKpiItem } from "./analytics/reporting/AnalyticsKpiStrip";
import { TipVolumeTrendChart } from "./analytics/reporting/TipVolumeTrendChart";
import { PeriodInsightMetrics } from "./analytics/reporting/PeriodInsightMetrics";
import { EmployeePerformanceRanking } from "./analytics/reporting/EmployeePerformanceRanking";
import { OperationalMetricsStrip } from "./analytics/reporting/OperationalMetricsStrip";
import { LocationComparisonChart } from "./analytics/reporting/LocationComparisonChart";
import { TopQrPerformanceList } from "./analytics/reporting/TopQrPerformanceList";
import {
  AnalyticsDonutChart,
  qrDeviceDonutSlices,
} from "./analytics/reporting/AnalyticsDonutChart";

type BiData = ReturnType<typeof useBusinessIntelligenceData>;

type BusinessAnalyticsReportingProps = {
  data: BiData;
  financialSummaryEnabled: boolean;
  revenueTimeframe: AnalyticsTimeframe;
  onRevenueTimeframeChange: (timeframe: AnalyticsTimeframe) => void;
  qrTimeframe: AnalyticsTimeframe;
  onQrTimeframeChange: (timeframe: AnalyticsTimeframe) => void;
};

/** Sprint 2 — sole reporting surface for business managers. */
export function BusinessAnalyticsReporting({
  data,
  financialSummaryEnabled,
  revenueTimeframe,
  onRevenueTimeframeChange,
  qrTimeframe,
  onQrTimeframeChange: _onQrTimeframeChange,
}: BusinessAnalyticsReportingProps) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadBusinessTransactionsExport(revenueTimeframe);
    } catch (e) {
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const selectedTimeframe = revenueTimeframe;
  const periodLabel =
    selectedTimeframe === "week"
      ? t("dashboard.filter_week")
      : selectedTimeframe === "year"
        ? t("dashboard.filter_year")
        : t("dashboard.filter_month");

  const revenue = useMemo(() => computeRevenueAnalytics(data.input), [data.input]);
  const revenueGrowth = data.bi.revenue.growthPercent;
  const growthComparable = data.bi.revenue.growthComparable;
  const showWeekContext = shouldShowCurrentWeekContext({
    timeframe: selectedTimeframe,
    periodTotal: data.period.totalTips,
    periodCount: data.period.tipCount,
    weekTotal: data.week.totalTips,
    weekCount: data.week.tipCount,
  });
  const employeesReceivedKey =
    selectedTimeframe === "week"
      ? "business.tips.analytics.cards.employeesReceivedThisWeek"
      : selectedTimeframe === "year"
        ? "business.tips.analytics.cards.employeesReceivedThisYear"
        : "business.tips.analytics.cards.employeesReceivedThisMonth";
  const growthOverviewKey =
    selectedTimeframe === "week"
      ? "business.team.performance.bi.growthOverviewWeek"
      : selectedTimeframe === "year"
        ? "business.team.performance.bi.growthOverviewYear"
        : "business.team.performance.bi.growthOverviewMonth";
  const periodStatsLoading =
    !data.valuesMatchPeriod ||
    (data.isPeriodStatsLoading ?? data.isInitialAnalyticsLoading);
  const deferredAnalyticsLoading =
    !data.valuesMatchPeriod || (data.isDeferredAnalyticsLoading ?? false);
  const tipsFeedLoading = data.isTipsFeedLoading ?? false;
  const qrSectionLoading = data.isQrLoading ?? false;
  const cardsRefreshing = data.isAnalyticsRefreshing;

  const overviewRenderedRef = useRef(false);
  const revenueRenderedRef = useRef(false);
  const operationalRenderedRef = useRef(false);

  useEffect(() => {
    if (periodStatsLoading || !data.valuesMatchPeriod) return;
    if (!overviewRenderedRef.current) {
      overviewRenderedRef.current = true;
      markAnalyticsPerformance("analytics.overview.render");
    }
    if (!revenueRenderedRef.current) {
      revenueRenderedRef.current = true;
      markAnalyticsPerformance("analytics.revenue.render");
    }
    if (!operationalRenderedRef.current) {
      operationalRenderedRef.current = true;
      markAnalyticsPerformance("analytics.operational.render");
    }
  }, [periodStatsLoading, data.valuesMatchPeriod]);

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

  const periodToggle = (
    <DashboardAnalyticsPeriodToggle
      ariaLabel={t("business.tips.analytics.periodAria")}
      value={revenueTimeframe}
      onChange={onRevenueTimeframeChange}
      options={periodOptions.map((option) => ({
        ...option,
        loading: data.isAnalyticsRefreshing && revenueTimeframe === option.id,
      }))}
    />
  );

  const kpiItems: AnalyticsKpiItem[] = [
    {
      id: "volume",
      label: t("business.tips.analytics.cards.tipVolume"),
      value: (
        <CountUpMetric value={data.period.totalTips} kind="eur" format={formatEur} />
      ),
      trend: growthComparable
        ? t(growthOverviewKey, { percent: revenueGrowth })
        : t("business.team.performance.bi.noPriorPeriod"),
      trendDirection: !growthComparable ? "neutral" : revenueGrowth >= 0 ? "up" : "down",
    },
    {
      id: "count",
      label: t("business.tips.analytics.cards.totalTips"),
      value: <CountUpMetric value={data.period.tipCount} kind="integer" />,
      hint: showWeekContext
        ? t("business.tips.analytics.cards.tipsThisWeek", { count: data.week.tipCount })
        : undefined,
      trendDirection: "neutral" as const,
    },
    {
      id: "employees",
      label: t("business.tips.analytics.cards.activeEmployees"),
      value: <CountUpMetric value={data.bi.operational.activeEmployees} kind="integer" />,
      hint: t(employeesReceivedKey, {
        count: data.bi.operational.employeesReceivingTips,
      }),
      trendDirection: "neutral" as const,
    },
    {
      id: "avg",
      label: t("business.team.performance.bi.avgTip"),
      value: <CountUpMetric value={revenue.averageTip} kind="eur" />,
      trendDirection: "neutral" as const,
    },
  ];

  const qrAnalytics =
    qrTimeframe === revenueTimeframe ? data.input.qrAnalytics : undefined;
  const qrDeviceSlices = useMemo(
    () =>
      qrDeviceDonutSlices(qrAnalytics?.scansByDevice, (device) =>
        t(`business.qrAnalytics.device.${device}`, { defaultValue: device }),
      ),
    [qrAnalytics?.scansByDevice, t],
  );

  return (
    <div className="caretip-mobile-analytics-report business-analytics-report space-y-5 md:space-y-6">
      <div className="business-analytics-report__toolbar space-y-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <DashboardRefreshIndicator
            isRefreshing={cardsRefreshing}
            lastUpdatedAt={data.lastUpdatedAt}
            className="shrink-0"
          />
          <DashboardStatusStrip items={analyticsStatusItems} className="min-w-0 justify-end" />
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0 w-full sm:w-auto sm:max-w-full">{periodToggle}</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting}
            onClick={() => void handleExport()}
            className="w-full shrink-0 sm:w-auto"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden />
            {t("business.tips.analytics.reporting.export")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("business.tips.analytics.overviewPeriodHint", { period: periodLabel })}
        </p>
      </div>

      <AnalyticsKpiStrip
        className="business-analytics-report__overview"
        ariaLabel={t("premium.summaryBanner.title")}
        items={kpiItems}
        loading={periodStatsLoading}
      />

      <TipVolumeTrendChart
        title={t("business.tips.analytics.sections.trends")}
        rows={data.dailyTipDistribution}
        timeframe={selectedTimeframe}
        periodTotalTips={data.period.totalTips}
        loading={periodStatsLoading}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <PeriodInsightMetrics
          data={data.input}
          timeframe={selectedTimeframe}
          loading={periodStatsLoading}
          refreshing={cardsRefreshing}
        />
        <EmployeePerformanceRanking
          data={data.input}
          loading={periodStatsLoading}
        />
      </div>

      <OperationalMetricsStrip
        data={data.input}
        loading={periodStatsLoading}
        shiftMetricLoading={deferredAnalyticsLoading}
        refreshing={cardsRefreshing}
      />

      <BusinessFinancialAnalyticsSection
        period={selectedTimeframe}
        enabled={financialSummaryEnabled}
      />

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
        <div className="grid gap-4 lg:grid-cols-2">
          <AnalyticsDonutChart
            title={t("business.qrAnalytics.scansByDevice")}
            slices={qrDeviceSlices}
            emptyLabel={t("format.noDataYet")}
            loading={qrTimeframe === revenueTimeframe ? qrSectionLoading : false}
            centerLabel={t("business.qrAnalytics.totalScans")}
            valueFormatter={(v) => String(v)}
          />
          <QrAnalyticsSection
            timeframe={qrTimeframe}
            showHeading={false}
            data={qrAnalytics}
            dataLoading={qrTimeframe === revenueTimeframe ? qrSectionLoading : undefined}
            dataRefreshing={qrTimeframe === revenueTimeframe ? cardsRefreshing : undefined}
          />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="business-locations-heading">
        <h2
          id="business-locations-heading"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("business.tips.analytics.sections.locations")}
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <LocationComparisonChart
            title={t("business.tips.analytics.locationComparison")}
            rows={data.bi.locations}
            emptyKey="business.tips.analytics.locationEmpty"
            loading={deferredAnalyticsLoading}
          />
          <LocationComparisonChart
            title={t("business.tips.analytics.tableComparison")}
            rows={data.bi.tables}
            emptyKey="business.tips.analytics.tableEmpty"
            loading={deferredAnalyticsLoading}
          />
        </div>
      </section>

      <TopQrPerformanceList rows={data.bi.topTipSources} loading={tipsFeedLoading} />
    </div>
  );
}
