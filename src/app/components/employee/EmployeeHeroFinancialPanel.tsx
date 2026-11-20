import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Building2, CircleCheck, Hourglass } from "lucide-react";
import {
  DashboardHeroFinancialLayout,
  type DashboardHeroFinancialMetric,
} from "../dashboard/DashboardHeroFinancialLayout";
import { DashboardHeroMetricSkeleton } from "../dashboard/DashboardAnalyticsLoader";
import { CountUpMetric } from "../dashboard/CountUpMetric";
import { formatEur } from "../../lib/formatEur";
import { cn } from "@/lib/utils";

/**
 * Employee hero: Gross tips, then where that money is. Every figure comes from the backend ledger
 * (never computed here).
 * - Gross tips: every tip attributed to the employee before CareTip fees, net of refunds and lost
 *   disputes, independent of how the business distributes tips.
 * - Paid to you: Stripe-confirmed transfers to the employee (CareTip-managed tips).
 * - Held by CareTip: CareTip-managed amounts still on CareTip's balance (employee not yet connected
 *   to Stripe, transfer retrying or in flight).
 * - Held by workplace: business-managed tips Stripe settled to the workplace's account, after fees,
 *   refunds and disputes, not yet recorded by the workplace as distributed.
 * Only the places that apply to this employee are shown.
 */
export type EmployeeHeroFinancialSnapshot = {
  grossTipsEur: number;
  paidToYouEur: number;
  heldByCareTipEur: number;
  heldByWorkplaceEur?: number;
  /** Undefined on older API responses: CareTip figures are shown, as before. */
  hasCareTipManagedTips?: boolean;
  hasBusinessManagedTips?: boolean;
};

type EmployeeHeroFinancialPanelProps = {
  loading: boolean;
  refreshing?: boolean;
  metrics: EmployeeHeroFinancialSnapshot | null;
  /** Shown only when values could not be loaded. */
  onRetry?: () => void;
  className?: string;
};

const ICON_PROPS = { size: 13, strokeWidth: 2.2, "aria-hidden": true } as const;

export const EmployeeHeroFinancialPanel = memo(function EmployeeHeroFinancialPanel({
  loading,
  refreshing,
  metrics,
  onRetry,
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

  // CareTip cells apply unless every tip is business-managed; the workplace cell only when some are.
  const businessOnly =
    metrics?.hasBusinessManagedTips === true && metrics?.hasCareTipManagedTips === false;
  const showCareTip = loading || !businessOnly;
  const showWorkplace = !loading && metrics?.hasBusinessManagedTips === true;

  const cells: DashboardHeroFinancialMetric[] = [];
  if (showCareTip) {
    cells.push(
      {
        id: "paid",
        label: t("employee.hero.statPaidToYou"),
        icon: <CircleCheck {...ICON_PROPS} />,
        value: currencyValue(metrics?.paidToYouEur),
      },
      {
        id: "held-caretip",
        label: t("employee.hero.statPending"),
        icon: <Hourglass {...ICON_PROPS} />,
        value: currencyValue(metrics?.heldByCareTipEur),
      },
    );
  }
  if (showWorkplace) {
    cells.push({
      id: "held-workplace",
      label: t("employee.hero.statHeldByWorkplace"),
      icon: <Building2 {...ICON_PROPS} />,
      value: currencyValue(metrics?.heldByWorkplaceEur),
    });
  }

  return (
    <>
      <DashboardHeroFinancialLayout
        className={cn(
          className,
          "dashboard-hero-financial--employee-compact",
          `dashboard-hero-financial--payout-${cells.length}`,
        )}
        ariaLabel={t("employee.hero.accountOverviewLabel")}
        loading={loading}
        refreshing={refreshing}
        primary={{
          label: t("employee.hero.statGrossTips"),
          value: currencyValue(metrics?.grossTipsEur),
        }}
        payoutMetrics={cells}
      />
      {onRetry ? (
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
