import { CalendarDays, Landmark, Wallet } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { EmployeeInstantPayoutEligibility } from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { caretipBtnPrimary } from "@/lib/caretipButtonSystem";
import { EMPLOYEE_PAYMENTS_CONNECT_HREF } from "./employeeDashboardNav";
import { employeePayoutMetricsMode } from "./employeePayoutMetricsPresentation";

const panel =
  "rounded-2xl border border-border/70 bg-card p-4 shadow-none sm:p-5";

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
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-3.5" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <section key={i} className={cn(panel, "min-h-0 md:min-h-[8.25rem]")}>
            <div className="h-4 w-28 animate-pulse rounded-md bg-muted" />
            <div className="mt-4 h-8 w-24 animate-pulse rounded-md bg-muted" />
            <div className="mt-2 h-3 w-40 animate-pulse rounded-md bg-muted" />
          </section>
        ))}
      </div>
    );
  }

  if (mode === "setup") {
    return (
      <section className={cn(panel, "p-5 sm:p-6")} aria-labelledby="employee-payout-balance-setup-heading">
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
      </section>
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

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-3.5">
      <MetricCard
        icon={CalendarDays}
        label={t("employee.payouts.dashboard.kpiInstant")}
        value={dash(instantOk, eligibility?.instantAvailableNetCents ?? 0)}
        hint={
          unavailable
            ? t("employee.payouts.dashboard.kpiUnavailable")
            : t("employee.payouts.dashboard.kpiInstantHint")
        }
      />
      <MetricCard
        icon={Wallet}
        label={t("employee.payouts.dashboard.kpiAvailable")}
        value={dash(balancesOk, eligibility?.availableCents ?? 0)}
        hint={
          unavailable
            ? t("employee.payouts.dashboard.kpiUnavailable")
            : t("employee.payouts.dashboard.kpiAvailableHint")
        }
      />
      <MetricCard
        icon={Landmark}
        label={t("employee.payouts.dashboard.kpiPending")}
        value={dash(balancesOk, eligibility?.pendingCents ?? 0)}
        hint={
          unavailable
            ? t("employee.payouts.dashboard.kpiUnavailable")
            : t("employee.payouts.dashboard.kpiPendingHint")
        }
      />
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <section className={cn(panel, "min-h-0 md:min-h-[8.25rem]")}>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">{label}</h2>
          <p className="mt-3 break-words text-[1.75rem] font-semibold tabular-nums tracking-tight text-foreground sm:text-[1.875rem]">
            {value}
          </p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
        </div>
      </div>
    </section>
  );
}
