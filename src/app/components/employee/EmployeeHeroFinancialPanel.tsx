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

  const unavailable = (
    <span className="dashboard-hero-financial__unavailable">
      {t("employee.hero.metricsUnavailable")}
    </span>
  );

  const currencyValue = (value: number | null | undefined) => {
    if (loading) return <DashboardHeroMetricSkeleton variant="currency" />;
    if (metrics == null || value == null || !Number.isFinite(value)) return unavailable;
    return <CountUpMetric value={value} kind="eur" format={(n) => formatEur(n)} />;
  };

  const countValue = (value: number | null | undefined) => {
    if (loading) return <DashboardHeroMetricSkeleton variant="count" />;
    if (metrics == null || value == null || !Number.isFinite(value)) return unavailable;
    return <CountUpMetric value={value} kind="integer" />;
  };

  return (
    <DashboardHeroFinancialLayout
      className={className}
      ariaLabel={t("employee.hero.accountOverviewLabel")}
      loading={loading}
      refreshing={refreshing}
      primary={{
        label: t("employee.hero.statYourEarnings"),
        value: currencyValue(metrics?.employeeEarningsEur),
        hint: t("employee.hero.statYourEarningsHint"),
      }}
      payoutMetrics={[
        {
          id: "paid",
          label: t("employee.hero.statPaidToStripe"),
          value: currencyValue(metrics?.paidToStripeEur),
        },
        {
          id: "pending",
          label: t("employee.hero.statPendingRelease"),
          value: currencyValue(metrics?.pendingReleaseEur),
        },
        {
          id: "gross",
          label: t("employee.hero.statGrossTips"),
          value: currencyValue(metrics?.grossTipsEur),
        },
        {
          id: "tips",
          label: t("employee.hero.statTotalSupporters"),
          value: countValue(metrics?.totalSupporters),
          valueClassName: "dashboard-hero-financial__value--hero-count",
        },
      ]}
    />
  );
});
