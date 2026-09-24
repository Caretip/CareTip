import { useMemo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEur } from "../../lib/formatEur";
import { useBusinessFinancialSummary } from "../../hooks/useBusinessFinancialSummary";
import type { AnalyticsTimeframe } from "../../hooks/useBusinessDashboardStats";
import type { BusinessFinancialPeriod } from "../../lib/api";
import { businessUi } from "./businessDashboardUi";
import { createConnectLoginLink } from "../../lib/api";
import { performExternalStripeRedirect } from "../../lib/externalStripeRedirect";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DashboardHeroMetricSkeleton } from "../dashboard/DashboardAnalyticsLoader";

function mapAnalyticsPeriod(tf: AnalyticsTimeframe): BusinessFinancialPeriod {
  if (tf === "week") return "week";
  if (tf === "year") return "year";
  return "month";
}

function stripeCents(cents: number | null | undefined, currency: string | null): string {
  if (cents == null) return "—";
  const cur = (currency ?? "eur").toUpperCase();
  if (cur === "EUR") return formatEur(cents / 100);
  return `${(cents / 100).toFixed(2)} ${cur}`;
}

type BusinessFinancialAnalyticsSectionProps = {
  period: AnalyticsTimeframe;
  enabled: boolean;
};

export function BusinessFinancialAnalyticsSection({
  period,
  enabled,
}: BusinessFinancialAnalyticsSectionProps) {
  const { t } = useTranslation();
  const financialPeriod = useMemo(() => mapAnalyticsPeriod(period), [period]);
  const { data, ledgerLoading, connectLoading, reconciliationLoading } = useBusinessFinancialSummary(
    enabled,
    financialPeriod,
    {
      progressive: true,
      includeReconciliation: true,
    },
  );

  const openStripe = async () => {
    try {
      const { url } = await createConnectLoginLink();
      const redirect = performExternalStripeRedirect(url, "expressDashboard");
      if (!redirect.ok) toast.error(t("business.stripe.payoutsWorkspace.openStripeFailed"));
    } catch {
      toast.error(t("business.stripe.payoutsWorkspace.openStripeFailed"));
    }
  };

  const pm = data?.periodMetrics;
  const feesDisplay =
    !ledgerLoading && pm?.feesExact && pm.caretipFeesEur != null ? formatEur(pm.caretipFeesEur) : null;

  const ledgerValue = (eur: number | null | undefined) =>
    ledgerLoading ? "—" : formatEur(eur ?? 0);

  const connectCurrency = (cents: number | null | undefined) => {
    if (connectLoading) return "—";
    if (!data?.stripe.readable) return t("business.tips.analytics.financial.stripeUnavailable");
    return stripeCents(cents, data.stripe.currency);
  };

  const paidOutValue = connectLoading
    ? "—"
    : formatEur((data?.payouts.completedAmountCents ?? 0) / 100);

  return (
    <div className="space-y-6">
      <section aria-label={t("business.tips.analytics.financial.summaryAria")}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("business.tips.analytics.financial.summaryTitle")}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: t("business.tips.analytics.financial.customerTips"),
              value: ledgerValue(pm?.totalCustomerTipsEur),
              hint: t("business.tips.analytics.financial.customerTipsHint"),
            },
            {
              label: t("business.tips.analytics.financial.caretipFees"),
              value:
                ledgerLoading
                  ? "—"
                  : feesDisplay ?? t("business.tips.analytics.financial.feesUnavailable"),
              hint: t("business.tips.analytics.financial.caretipFeesHint"),
            },
            {
              label: t("business.tips.analytics.financial.receivedInStripe"),
              value: connectCurrency(data?.stripe.availableCents),
              hint: t("business.tips.analytics.financial.receivedInStripeHint"),
            },
            {
              label: t("business.tips.analytics.financial.paidOut"),
              value: paidOutValue,
              hint: t("business.tips.analytics.financial.paidOutHint"),
            },
          ].map((card) => (
            <div key={card.label} className={cn(businessUi.cardStatic, "p-4")}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("business.tips.analytics.financial.periodBasis")}
        </p>
      </section>

      <section aria-label={t("business.tips.analytics.financial.routingAria")}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("business.tips.analytics.financial.routingTitle")}
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className={cn(businessUi.cardStatic, "p-4")}>
            <p className="text-sm font-medium">{t("business.tips.analytics.financial.directToEmployee")}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {ledgerValue(pm?.directToEmployeeGrossTipsEur)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("business.tips.analytics.financial.directToEmployeeHint")}
            </p>
          </div>
          <div className={cn(businessUi.cardStatic, "p-4")}>
            <p className="text-sm font-medium">
              {t("business.tips.analytics.financial.businessDistribution")}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {ledgerValue(pm?.businessDistributionGrossTipsEur)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("business.tips.analytics.financial.distributionObligation", {
                amount: ledgerLoading
                  ? "—"
                  : formatEur(data?.lifetime.employeeDistributionObligationEur ?? 0),
              })}
            </p>
            <Link
              to="/dashboard/stripe/payouts?view=caretip"
              className="mt-2 inline-flex text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              {t("business.tips.analytics.financial.viewObligations")}
            </Link>
          </div>
        </div>
      </section>

      <section aria-label={t("business.tips.analytics.financial.stripeAria")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("business.tips.analytics.financial.stripeTitle")}
          </h2>
          <Button type="button" variant="outline" size="sm" onClick={() => void openStripe()}>
            {t("business.tips.analytics.financial.openStripe")}
          </Button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className={cn(businessUi.cardStatic, "p-4")}>
            <p className="text-xs text-muted-foreground">{t("business.tips.analytics.financial.stripeAvailable")}</p>
            <p className="mt-1 font-semibold tabular-nums">
              {connectLoading ? (
                <DashboardHeroMetricSkeleton variant="currency" />
              ) : data?.stripe.readable ? (
                stripeCents(data.stripe.availableCents, data.stripe.currency)
              ) : (
                "—"
              )}
            </p>
          </div>
          <div className={cn(businessUi.cardStatic, "p-4")}>
            <p className="text-xs text-muted-foreground">{t("business.tips.analytics.financial.stripePending")}</p>
            <p className="mt-1 font-semibold tabular-nums">
              {connectLoading ? (
                <DashboardHeroMetricSkeleton variant="currency" />
              ) : data?.stripe.readable ? (
                stripeCents(data.stripe.pendingCents, data.stripe.currency)
              ) : (
                "—"
              )}
            </p>
          </div>
          <div className={cn(businessUi.cardStatic, "p-4")}>
            <p className="text-xs text-muted-foreground">{t("business.tips.analytics.financial.bankPaidOut")}</p>
            <p className="mt-1 font-semibold tabular-nums">
              {connectLoading ? <DashboardHeroMetricSkeleton variant="currency" /> : paidOutValue}
            </p>
          </div>
        </div>
      </section>

      <section aria-label={t("business.tips.analytics.financial.reconciliationAria")}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("business.tips.analytics.financial.reconciliationTitle")}
        </h2>
        {reconciliationLoading ? (
          <div className="mt-3 h-12 animate-pulse rounded-lg bg-muted/40" aria-busy="true" />
        ) : data?.reconciliation?.needsAttention ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <p>{t("business.tips.analytics.financial.reconciliationAttention")}</p>
          </div>
        ) : data?.reconciliation ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            <span>{t("business.tips.analytics.financial.reconciliationOk")}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
