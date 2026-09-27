import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { EmployeeInstantPayoutEligibility } from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { caretipBtnPrimary } from "@/lib/caretipButtonSystem";
import { EMPLOYEE_PAYMENTS_CONNECT_HREF } from "./employeeDashboardNav";
import { employeePayoutMetricsMode } from "./employeePayoutMetricsPresentation";
import {
  PayoutFinancialMetric,
  PayoutFinancialMetricStrip,
} from "../finance/payout/PayoutFinancialMetric";
import { PayoutWorkspacePanel } from "../finance/payout/PayoutWorkspacePanel";

const INSTANT_KPI_HIDDEN_REASONS = new Set([
  "not_connected",
  "stripe_not_configured",
  "business_closed",
  "payouts_disabled",
  "country_unsupported",
]);

export function EmployeePayoutDashboardMetrics({
  eligibility,
  loading,
  businessDistribution = false,
  /** When true, Connect CTA is on this page’s account card — avoid duplicate primary CTA. */
  connectCtaOnPage = true,
}: {
  eligibility: EmployeeInstantPayoutEligibility | null;
  loading: boolean;
  businessDistribution?: boolean;
  connectCtaOnPage?: boolean;
}) {
  const { t } = useTranslation();
  const connected = eligibility == null ? null : eligibility.connected === true;
  const mode = employeePayoutMetricsMode({
    loading,
    businessDistribution,
    connected: connected === true ? true : connected === false ? false : null,
  });

  if (mode === "hidden") return null;

  if (mode === "loading") {
    return (
      <PayoutFinancialMetricStrip aria-busy={true}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="caretip-payout-metric">
            <div className="h-3 w-24 animate-pulse rounded-md bg-muted" />
            <div className="mt-3 h-7 w-20 animate-pulse rounded-md bg-muted" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </PayoutFinancialMetricStrip>
    );
  }

  if (mode === "setup") {
    return (
      <PayoutWorkspacePanel paddingClassName="sm:p-6" aria-labelledby="employee-payout-balance-setup-heading">
        <h2 id="employee-payout-balance-setup-heading" className="text-base font-semibold tracking-tight">
          {t("employee.payouts.dashboard.setupTitle")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-snug text-muted-foreground">
          {t("employee.payouts.dashboard.setupBody")}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-snug text-muted-foreground">
          {t("employee.payouts.dashboard.setupAfter")}
        </p>
        {!connectCtaOnPage ? (
          <Button asChild className={cn(caretipBtnPrimary, "mt-5 h-auto min-h-11 w-full whitespace-normal sm:w-auto")}>
            <Link to={EMPLOYEE_PAYMENTS_CONNECT_HREF}>{t("employee.payouts.connectCta")}</Link>
          </Button>
        ) : (
          <p className="mt-4 text-sm font-medium text-foreground">
            {t("employee.payouts.dashboard.setupUseAccountCard")}
          </p>
        )}
      </PayoutWorkspacePanel>
    );
  }

  const unavailable = !loading && !eligibility;
  const balancesOk = Boolean(eligibility?.connected && eligibility.balancesRetrieved === true);
  const instantOk =
    balancesOk && eligibility != null && !INSTANT_KPI_HIDDEN_REASONS.has(eligibility.reason);

  const money = (cents: number) => formatEur(cents / 100);
  const dash = (ok: boolean, cents: number) => {
    if (loading) return "—";
    if (unavailable || !ok) return "—";
    return money(cents);
  };

  const metrics = [
    {
      label: t("employee.payouts.dashboard.kpiAvailable"),
      value: dash(balancesOk, eligibility?.availableCents ?? 0),
      hint: unavailable
        ? t("employee.payouts.dashboard.kpiUnavailable")
        : t("employee.payouts.dashboard.kpiAvailableHint"),
    },
    {
      label: t("employee.payouts.dashboard.kpiPending"),
      value: dash(balancesOk, eligibility?.pendingCents ?? 0),
      hint: unavailable
        ? t("employee.payouts.dashboard.kpiUnavailable")
        : t("employee.payouts.dashboard.kpiPendingHint"),
    },
    {
      label: t("employee.payouts.dashboard.kpiInstant"),
      value: dash(instantOk, eligibility?.instantAvailableNetCents ?? 0),
      hint: unavailable
        ? t("employee.payouts.dashboard.kpiUnavailable")
        : t("employee.payouts.dashboard.kpiInstantHint"),
    },
  ];

  return (
    <PayoutFinancialMetricStrip>
      {metrics.map((metric) => (
        <PayoutFinancialMetric
          key={metric.label}
          label={metric.label}
          value={metric.value}
          hint={metric.hint}
        />
      ))}
    </PayoutFinancialMetricStrip>
  );
}
