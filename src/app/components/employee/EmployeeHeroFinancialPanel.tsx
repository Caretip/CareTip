import { memo } from "react";
import { useTranslation } from "react-i18next";
import { DashboardHeroFinancialLayout } from "../dashboard/DashboardHeroFinancialLayout";
import { DashboardHeroMetricSkeleton } from "../dashboard/DashboardAnalyticsLoader";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { formatEur } from "../../lib/formatEur";

export type EmployeeHeroFinancialSnapshot = {
  employeeEarningsEur: number;
  paidToStripeEur: number;
  pendingReleaseEur: number;
  grossTipsEur: number;
  totalSupporters: number;
};

type EmployeeHeroFinancialPanelProps = {
  loading: boolean;
  refreshing?: boolean;
  metrics: EmployeeHeroFinancialSnapshot | null;
  className?: string;
};

export const EmployeeHeroFinancialPanel = memo(function EmployeeHeroFinancialPanel({
  loading,
  refreshing,
  metrics,
  className,
}: EmployeeHeroFinancialPanelProps) {
  const { t } = useTranslation();

  const averageTip =
    metrics && metrics.totalSupporters > 0
      ? metrics.grossTipsEur / metrics.totalSupporters
      : 0;

  const currencyValue = (value: number) =>
    loading ? (
      <DashboardHeroMetricSkeleton variant="currency" />
    ) : (
      <CountUpMetric
        value={value}
        kind="eur"
        format={(n) => (n < 0.005 ? t("format.metricZeroTips") : formatEur(n))}
      />
    );

  const countValue = (value: number) =>
    loading ? (
      <DashboardHeroMetricSkeleton variant="count" />
    ) : (
      <CountUpMetric value={value} kind="integer" />
    );

  return (
    <DashboardHeroFinancialLayout
      className={className}
      ariaLabel={t("employee.hero.accountOverviewLabel")}
      loading={loading}
      refreshing={refreshing}
      primary={{
        label: t("employee.hero.statYourEarnings"),
        value: currencyValue(metrics?.employeeEarningsEur ?? 0),
        hint: t("employee.hero.statYourEarningsHint"),
      }}
      payoutMetrics={[
        {
          id: "paid",
          label: t("employee.hero.statPaidToStripe"),
          value: currencyValue(metrics?.paidToStripeEur ?? 0),
        },
        {
          id: "pending",
          label: t("employee.hero.statPendingRelease"),
          value: currencyValue(metrics?.pendingReleaseEur ?? 0),
        },
      ]}
      performanceZoneLabel={t("employee.hero.financial.zonePerformance")}
      performanceMetrics={[
        {
          id: "gross",
          label: t("employee.hero.statGrossTips"),
          value: currencyValue(metrics?.grossTipsEur ?? 0),
        },
        {
          id: "tips",
          label: t("employee.hero.statTotalSupporters"),
          value: countValue(metrics?.totalSupporters ?? 0),
        },
        {
          id: "average",
          label: t("employee.hero.statAverageTip"),
          value: currencyValue(averageTip),
        },
      ]}
      analyticsHref="/employee/analytics"
      analyticsLabel={t("employee.hero.financial.viewAnalytics")}
    />
  );
});
