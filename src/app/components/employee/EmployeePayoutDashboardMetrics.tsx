import { CalendarDays, Landmark, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeInstantPayoutEligibility } from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { cn } from "@/lib/utils";

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
}: {
  eligibility: EmployeeInstantPayoutEligibility | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-3.5">
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
    <section className={cn(panel, "min-h-[8.25rem]")}>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">{label}</h2>
          <p className="mt-3 text-[1.75rem] font-semibold tabular-nums tracking-tight text-foreground sm:text-[1.875rem]">
            {value}
          </p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
        </div>
      </div>
    </section>
  );
}
