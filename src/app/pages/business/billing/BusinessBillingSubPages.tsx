import { Navigate } from "react-router";
import { useBillingStatus } from "../../../hooks/useBillingStatus";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";
import { BillingHistoryPanel } from "../../../components/business/settings/billing/BillingHistoryPanel";
import { BillingInvoicesPanel } from "../../../components/business/settings/billing/BillingInvoicesPanel";
import { BillingPaymentMethodsPanel } from "../../../components/business/settings/billing/BillingPaymentMethodsPanel";
import { BusinessSettingsPanelShell } from "../../../components/business/settings/BusinessSettingsPanelShell";

export function BusinessBillingHistoryPage() {
  const { data, loading, error, reload } = useBillingStatus();
  const isInitialHistoryLoad = loading && !(data?.events?.length);
  const { showInitialSkeleton } = useBusinessPageBoot("billing-history", isInitialHistoryLoad);

  return (
    <BusinessSettingsPanelShell embedded>
      <BillingHistoryPanel
        loading={showInitialSkeleton}
        error={error}
        events={data?.events ?? null}
        onRetry={() => void reload()}
      />
    </BusinessSettingsPanelShell>
  );
}

export function BusinessBillingInvoicesPage() {
  return (
    <BusinessSettingsPanelShell embedded>
      <BillingInvoicesPanel />
    </BusinessSettingsPanelShell>
  );
}

export function BusinessBillingPaymentMethodsPage() {
  return (
    <BusinessSettingsPanelShell embedded>
      <BillingPaymentMethodsPanel />
    </BusinessSettingsPanelShell>
  );
}

/** @deprecated Use `/dashboard/stripe/payouts`. Kept so leftover imports still redirect. */
export function BusinessBillingPayoutsPage() {
  return <Navigate to="/dashboard/stripe/payouts" replace />;
}
