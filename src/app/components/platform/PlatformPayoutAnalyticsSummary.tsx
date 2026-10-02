import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PlatformPayoutAnalytics } from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import {
  PlatformAdminSection,
  PlatformAdminMetricStrip,
  PlatformAdminMetricCell,
  PlatformAdminFreshnessIndicator,
} from "./PlatformPageChrome";
import { platformUi } from "./platformDashboardUi";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/app/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

type PlatformPayoutAnalyticsSummaryProps = {
  payout: PlatformPayoutAnalytics | undefined;
  rangeDays: number;
  timezone: string;
  generatedAt?: string;
  cacheTtlSeconds?: number;
};

const PAYOUT_CHART_CONFIG: ChartConfig = {
  business: { label: "Business", color: "#e9781c" },
  employee: { label: "Employee", color: "#22d3ee" },
};

export function PlatformPayoutAnalyticsSummary({
  payout,
  rangeDays,
  timezone,
  generatedAt,
  cacheTtlSeconds,
}: PlatformPayoutAnalyticsSummaryProps) {
  const { t } = useTranslation();

  const chartData = useMemo(
    () =>
      (payout?.volumeByDay ?? []).map((row) => ({
        date: row.date,
        business: row.businessPayoutsEur,
        employee: row.employeePayoutsEur,
      })),
    [payout?.volumeByDay],
  );

  if (!payout) return null;
  const s = payout.summary;
  const totalPayoutVolume = s.businessVolumeEur + s.employeeVolumeEur;

  return (
    <PlatformAdminSection
      id="platform-payout-intelligence"
      title={t("admin.businessAnalyticsPage.payoutAnalyticsTitle")}
      description={t("admin.businessAnalyticsPage.payoutAnalyticsDesc", { days: rangeDays, tz: timezone })}
      className="mt-8"
    >
      <PlatformAdminMetricStrip aria-label={t("admin.businessAnalyticsPage.payoutAnalyticsTitle")}>
        <PlatformAdminMetricCell
          label={t("admin.businessAnalyticsPage.payoutTotalVolume")}
          value={formatEur(totalPayoutVolume)}
          hint={t("admin.businessAnalyticsPage.payoutStripeVolumeHint")}
        />
        <PlatformAdminMetricCell
          label={t("admin.businessAnalyticsPage.payoutBusinessVolume")}
          value={formatEur(s.businessVolumeEur)}
          hint={`${s.businessPayoutCount} ${t("admin.businessAnalyticsPage.payoutCountLabel")}`}
        />
        <PlatformAdminMetricCell
          label={t("admin.businessAnalyticsPage.payoutEmployeeVolume")}
          value={formatEur(s.employeeVolumeEur)}
          hint={`${s.employeePayoutCount} ${t("admin.businessAnalyticsPage.payoutCountLabel")}`}
        />
        <PlatformAdminMetricCell
          label={t("admin.businessAnalyticsPage.payoutPaidCount")}
          value={String(s.paidCount)}
        />
        <PlatformAdminMetricCell
          label={t("admin.businessAnalyticsPage.payoutPendingCount")}
          value={String(s.pendingCount)}
        />
        <PlatformAdminMetricCell
          label={t("admin.businessAnalyticsPage.payoutFailedCount")}
          value={String(s.failedCount)}
          featured={s.failedCount > 0}
        />
      </PlatformAdminMetricStrip>

      <PlatformAdminFreshnessIndicator
        generatedAt={generatedAt}
        cacheTtlSeconds={cacheTtlSeconds}
        className="mb-4"
      />

      {chartData.length > 0 ? (
        <div className={platformUi.overviewAnalyticsCard}>
          <div className={platformUi.overviewAnalyticsCardHeader}>
            <h3 className={platformUi.overviewAnalyticsCardTitle}>
              {t("admin.businessAnalyticsPage.payoutVolumeOverTime")}
            </h3>
            <p className={platformUi.overviewAnalyticsCardDesc}>
              {t("admin.businessAnalyticsPage.payoutVolumeOverTimeDesc")}
            </p>
          </div>
          <div className={platformUi.overviewAnalyticsCardBody}>
            <ChartContainer config={PAYOUT_CHART_CONFIG} className={platformUi.analyticsChartWrap}>
              <BarChart data={chartData} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                  tickFormatter={(v) => String(v).slice(5)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(v) => formatEur(Number(v)).replace(/\s/g, "")}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => [
                        formatEur(Number(value)),
                        name === "business"
                          ? t("admin.businessAnalyticsPage.payoutBusinessVolume")
                          : t("admin.businessAnalyticsPage.payoutEmployeeVolume"),
                      ]}
                    />
                  }
                />
                <Bar
                  dataKey="business"
                  stackId="payout"
                  fill="var(--color-business)"
                  radius={[0, 0, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="employee"
                  stackId="payout"
                  fill="var(--color-employee)"
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          </div>
        </div>
      ) : null}
    </PlatformAdminSection>
  );
}
