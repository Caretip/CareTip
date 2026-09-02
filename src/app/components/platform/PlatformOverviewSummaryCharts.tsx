import { Link } from "react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import type { PlatformAnalytics, PlatformSubscriptionMonitoring } from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { platformUi } from "./platformDashboardUi";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/app/components/ui/chart";
import { DashboardChartSkeleton } from "../dashboard/DashboardAnalyticsLoader";
import { DashboardStableChartSlot } from "../dashboard/DashboardSectionLoading";
import {
  PLATFORM_BUSINESS_BASE,
  PLATFORM_REVENUE_BASE,
} from "./platformAdminNav";
import { CHART_ANIMATION_OFF } from "../../lib/lightweightChartProps";
import { formatVenueDayBucketLabel } from "../../lib/businessVenueTime";

type PlatformOverviewSummaryChartsProps = {
  analytics: PlatformAnalytics | null;
  subscriptionMonitoring: PlatformSubscriptionMonitoring | null;
  loading?: boolean;
};

function formatCompact(n: number): string {
  try {
    return new Intl.NumberFormat(undefined, { notation: "compact" }).format(n);
  } catch {
    return String(n);
  }
}

function formatShortDate(iso: string): string {
  return formatVenueDayBucketLabel(iso, undefined, "Europe/Berlin");
}

export function PlatformOverviewSummaryCharts({
  analytics,
  subscriptionMonitoring,
  loading = false,
}: PlatformOverviewSummaryChartsProps) {
  const { t } = useTranslation();

  const tipsData = useMemo(() => {
    const rows = [...(analytics?.tipVolume ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    return rows.slice(-30).map((row) => ({
      date: formatShortDate(row.date),
      tipsEur: row.tipsEur,
      tipCount: row.tipCount,
    }));
  }, [analytics?.tipVolume]);

  const subscriptionData = useMemo(() => {
    const overview = subscriptionMonitoring?.overview;
    if (!overview) return [];
    return [
      { label: t("admin.subscriptions.kpi.active"), count: overview.active },
      { label: t("admin.subscriptions.kpi.trialing"), count: overview.trialing },
      { label: t("admin.subscriptions.kpi.failed"), count: overview.failed },
      { label: t("admin.overview.charts.cancelled"), count: overview.cancelled },
      { label: t("admin.overview.charts.expired"), count: overview.expired },
    ].filter((row) => row.count > 0 || row.label === t("admin.subscriptions.kpi.active"));
  }, [subscriptionMonitoring?.overview, t]);

  const tipsConfig: ChartConfig = {
    tipsEur: { label: t("admin.overview.charts.tipsVolume"), color: "#197278" },
  };

  const subsConfig: ChartConfig = {
    count: { label: t("admin.overview.charts.subscriptions"), color: "#6366f1" },
  };

  const tipsEmpty = !loading && tipsData.every((row) => row.tipsEur === 0);
  const subsEmpty = !loading && subscriptionData.every((row) => row.count === 0);

  return (
    <section aria-labelledby="platform-overview-charts-heading" className="platform-overview-summary-charts">
      <div className="mb-5 flex items-end justify-between gap-3">
        <h2 id="platform-overview-charts-heading" className="text-sm font-semibold text-foreground sm:text-base">
          {t("admin.overview.charts.sectionTitle")}
        </h2>
      </div>
      <div className={platformUi.analyticsChartsGrid}>
        <Card className={platformUi.overviewAnalyticsCard}>
          <CardHeader className={platformUi.overviewAnalyticsCardHeader}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <CardTitle className={platformUi.overviewAnalyticsCardTitle}>
                  {t("admin.overview.charts.tipsTitle")}
                </CardTitle>
                <CardDescription className={platformUi.overviewAnalyticsCardDesc}>
                  {t("admin.overview.charts.tipsDesc")}
                </CardDescription>
              </div>
              <Link
                to={`${PLATFORM_REVENUE_BASE}/transactions`}
                className="dashboard-view-all-link shrink-0"
              >
                <span>{t("admin.overview.viewAll")}</span>
                <ArrowRight className="dashboard-view-all-link__icon" strokeWidth={2} aria-hidden />
              </Link>
            </div>
          </CardHeader>
          <CardContent className={platformUi.overviewAnalyticsCardBody}>
            <div className={platformUi.analyticsChartWrap}>
              <DashboardStableChartSlot loading={loading} skeleton={<DashboardChartSkeleton />}>
                {tipsEmpty ? (
                  <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    {t("admin.overview.charts.empty")}
                  </p>
                ) : (
                  <ChartContainer config={tipsConfig} className="aspect-auto h-full w-full min-h-0">
                    <AreaChart data={tipsData} margin={{ left: 4, right: 4, top: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tickMargin={8} minTickGap={20} tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={formatCompact} width={36} tick={{ fontSize: 11 }} />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            indicator="dot"
                            formatter={(value, name) =>
                              name === "tipsEur" ? formatEur(Number(value)) : String(value)
                            }
                          />
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="tipsEur"
                        stroke="var(--color-tipsEur)"
                        fill="var(--color-tipsEur)"
                        fillOpacity={0.12}
                        strokeWidth={2}
                        dot={false}
                        {...CHART_ANIMATION_OFF}
                      />
                    </AreaChart>
                  </ChartContainer>
                )}
              </DashboardStableChartSlot>
            </div>
          </CardContent>
        </Card>

        <Card className={platformUi.overviewAnalyticsCard}>
          <CardHeader className={platformUi.overviewAnalyticsCardHeader}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <CardTitle className={platformUi.overviewAnalyticsCardTitle}>
                  {t("admin.overview.charts.subscriptionsTitle")}
                </CardTitle>
                <CardDescription className={platformUi.overviewAnalyticsCardDesc}>
                  {t("admin.overview.charts.subscriptionsDesc")}
                </CardDescription>
              </div>
              <Link
                to={`${PLATFORM_BUSINESS_BASE}/subscriptions`}
                className="dashboard-view-all-link shrink-0"
              >
                <span>{t("admin.overview.viewAll")}</span>
                <ArrowRight className="dashboard-view-all-link__icon" strokeWidth={2} aria-hidden />
              </Link>
            </div>
          </CardHeader>
          <CardContent className={platformUi.overviewAnalyticsCardBody}>
            <div className={platformUi.analyticsChartWrap}>
              <DashboardStableChartSlot loading={loading} skeleton={<DashboardChartSkeleton barHeights={[48, 72, 36, 64, 52]} />}>
                {subsEmpty ? (
                  <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    {t("admin.overview.charts.empty")}
                  </p>
                ) : (
                  <ChartContainer config={subsConfig} className="aspect-auto h-full w-full min-h-0">
                    <BarChart data={subscriptionData} margin={{ left: 4, right: 4, top: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tickMargin={8} tick={{ fontSize: 11 }} interval={0} />
                      <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                      <Bar dataKey="count" fill="var(--color-count)" radius={[6, 6, 0, 0]} maxBarSize={48} {...CHART_ANIMATION_OFF} />
                    </BarChart>
                  </ChartContainer>
                )}
              </DashboardStableChartSlot>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
