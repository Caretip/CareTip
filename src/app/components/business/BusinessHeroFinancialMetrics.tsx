import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  DashboardHeroFinancialLayout,
  type DashboardHeroFinancialMetric,
} from "../dashboard/DashboardHeroFinancialLayout";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { DashboardHeroMetricSkeleton } from "../dashboard/DashboardAnalyticsLoader";
import { formatEur } from "../../lib/formatEur";
import type { BusinessFinancialSummaryBundle } from "../../lib/api";

type BusinessHeroFinancialMetricsProps = {
  /** @deprecated Prefer ledgerLoading/connectLoading for progressive hero hydration. */
  loading?: boolean;
  ledgerLoading?: boolean;
  connectLoading?: boolean;
  summary: BusinessFinancialSummaryBundle | null;
  isRefreshing?: boolean;
  className?: string;
};

function stripeCentsToEur(cents: number | null | undefined): number {
  if (cents == null) return 0;
  return cents / 100;
}

export const BusinessHeroFinancialMetrics = memo(function BusinessHeroFinancialMetrics({
  loading = false,
  ledgerLoading,
  connectLoading,
  summary,
  isRefreshing,
  className,
}: BusinessHeroFinancialMetricsProps) {
  const { t } = useTranslation();
  const metrics = summary?.lifetime;
  const ledgerPending = ledgerLoading ?? loading;
  const connectPending = connectLoading ?? loading;

  const receivedInStripeEur = summary?.stripe.readable
    ? stripeCentsToEur(summary.stripe.availableCents)
    : null;
  const pendingStripeEur = summary?.stripe.readable
    ? stripeCentsToEur(summary.stripe.pendingCents)
    : null;
  const paidOutEur = summary && !connectPending ? summary.payouts.completedAmountCents / 100 : null;
  const distributionEur = metrics?.employeeDistributionObligationEur ?? 0;
  const showDistribution =
    !ledgerPending &&
    (summary?.routing.mode === "business_distribution" || distributionEur > 0) &&
    distributionEur > 0;

  const ledgerCurrencyValue = (value: number) =>
    ledgerPending ? (
      <DashboardHeroMetricSkeleton variant="currency" />
    ) : (
      <CountUpMetric
        value={value}
        kind="eur"
        format={(n) => (n < 0.005 ? t("format.metricZeroTips") : formatEur(n))}
      />
    );

  const connectCurrencyValue = (value: number) =>
    connectPending ? (
      <DashboardHeroMetricSkeleton variant="currency" />
    ) : (
      <CountUpMetric
        value={value}
        kind="eur"
        format={(n) => (n < 0.005 ? t("format.metricZeroTips") : formatEur(n))}
      />
    );

  const payoutSkeleton = <DashboardHeroMetricSkeleton variant="currency" />;

  const payoutMetrics: DashboardHeroFinancialMetric[] = [
    {
      id: "stripe",
      label: t("business.hero.financial.receivedInStripe"),
      value: connectPending
        ? payoutSkeleton
        : receivedInStripeEur != null
          ? connectCurrencyValue(receivedInStripeEur)
          : t("business.hero.financial.stripeUnavailable"),
    },
    {
      id: "paid",
      label: t("business.hero.financial.paidOut"),
      value: connectPending ? payoutSkeleton : connectCurrencyValue(paidOutEur ?? 0),
    },
  ];

  if (!connectPending && pendingStripeEur != null && pendingStripeEur > 0) {
    payoutMetrics.push({
      id: "pending",
      label: t("business.hero.financial.pendingStripe"),
      value: connectCurrencyValue(pendingStripeEur),
    });
  }

  if (showDistribution) {
    payoutMetrics.push({
      id: "distribution",
      label: t("business.hero.financial.employeeDistribution"),
      value: ledgerCurrencyValue(distributionEur),
      hint: t("business.hero.financial.distributionHint"),
    });
  }

  return (
    <DashboardHeroFinancialLayout
      className={cn(className)}
      ariaLabel={t("business.hero.financial.sectionLabel")}
      loading={ledgerPending && connectPending}
      refreshing={isRefreshing}
      primary={{
        label: t("business.hero.financial.totalTips"),
        value: ledgerCurrencyValue(metrics?.totalCustomerTipsEur ?? 0),
        hint: t("business.hero.financial.totalTipsHint"),
      }}
      payoutZoneLabel={t("business.hero.financial.zonePayout")}
      payoutMetrics={payoutMetrics}
    />
  );
});
