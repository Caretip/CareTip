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
  /** Slice failed to load: show it as unavailable, never as a placeholder value or a skeleton. */
  ledgerFailed?: boolean;
  connectFailed?: boolean;
  /** Shown only while a slice has failed. */
  onRetry?: () => void;
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
  ledgerFailed = false,
  connectFailed = false,
  onRetry,
  summary,
  isRefreshing,
  className,
}: BusinessHeroFinancialMetricsProps) {
  const { t } = useTranslation();
  const ledgerPending = (ledgerLoading ?? loading) && !ledgerFailed;
  const connectPending = (connectLoading ?? loading) && !connectFailed;
  const metrics = summary?.lifetime;
  const distributionEur = metrics?.employeeDistributionObligationEur;
  const isBusinessDistribution = summary?.routing.mode === "business_distribution";
  const distributionZero = distributionEur != null && distributionEur < 0.005;

  const payoutSkeleton = <DashboardHeroMetricSkeleton variant="currency" />;
  const stripeUnavailable = (
    <span className="dashboard-hero-financial__unavailable">
      {t("business.hero.financial.stripeUnavailable")}
    </span>
  );
  const metricUnavailable = (
    <span className="dashboard-hero-financial__unavailable">
      {t("business.hero.financial.metricUnavailable")}
    </span>
  );

  const money = (value: number) => (
    <CountUpMetric value={value} kind="eur" format={(n) => formatEur(n)} />
  );

  const ledgerCurrencyValue = (value: number | null | undefined) => {
    if (ledgerPending) return payoutSkeleton;
    if (ledgerFailed) return metricUnavailable;
    if (value == null || !Number.isFinite(value)) return metricUnavailable;
    return money(value);
  };

  const stripeCurrencyValue = (cents: number | null | undefined) => {
    if (connectPending) return payoutSkeleton;
    // "Connect Stripe" would be false here: the account may be connected, the request failed.
    if (connectFailed) return metricUnavailable;
    if (!summary?.stripe.readable || cents == null || !Number.isFinite(cents)) return stripeUnavailable;
    return money(stripeCentsToEur(cents));
  };

  const distributionHint = !summary || ledgerFailed
    ? undefined
    : !isBusinessDistribution
      ? t("business.hero.financial.distributionDirectModeHint")
      : distributionZero
        ? t("business.hero.financial.distributionZeroHint")
        : t("business.hero.financial.distributionHint");

  const payoutMetrics: DashboardHeroFinancialMetric[] = [
    {
      id: "stripe",
      label: t("business.hero.financial.availableInStripe"),
      value: stripeCurrencyValue(summary?.stripe.availableCents),
    },
    {
      id: "pending",
      label: t("business.hero.financial.pendingStripe"),
      value: stripeCurrencyValue(summary?.stripe.pendingCents),
    },
    {
      id: "paid",
      label: t("business.hero.financial.paidOut"),
      value: connectPending
        ? payoutSkeleton
        : summary && !connectFailed
          ? money(summary.payouts.completedAmountCents / 100)
          : metricUnavailable,
      hint: t("business.hero.financial.paidOutHint"),
    },
    {
      id: "distribution",
      label: t("business.hero.financial.toDistribute"),
      value: ledgerCurrencyValue(distributionEur),
      hint: ledgerPending ? undefined : distributionHint,
    },
  ];

  return (
    <>
      <DashboardHeroFinancialLayout
        className={cn(className)}
        ariaLabel={t("business.hero.financial.sectionLabel")}
        loading={ledgerPending && connectPending}
        refreshing={isRefreshing}
        primary={{
          label: t("business.hero.financial.totalTips"),
          meta: t("business.hero.financial.totalTipsPeriod"),
          value: ledgerCurrencyValue(metrics?.totalCustomerTipsEur),
          hint: t("business.hero.financial.totalTipsHint"),
        }}
        payoutMetrics={payoutMetrics}
      />
      {onRetry && (ledgerFailed || connectFailed) ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-sm font-medium text-primary underline underline-offset-2"
        >
          {t("dashboard.tryAgain")}
        </button>
      ) : null}
    </>
  );
});
