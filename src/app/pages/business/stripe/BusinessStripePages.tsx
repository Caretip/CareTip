import { BusinessStripeConnectCard } from "../../../components/business/settings/billing/BusinessStripeConnectCard";
import { ConnectPayoutsPanel } from "../../../components/business/settings/billing/ConnectPayoutsPanel";
import { BusinessSettingsPanelShell } from "../../../components/business/settings/BusinessSettingsPanelShell";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";

export function BusinessStripeConnectPage() {
  return (
    <BusinessSettingsPanelShell embedded>
      <BusinessStripeConnectCard />
    </BusinessSettingsPanelShell>
  );
}

export function BusinessStripePayoutsPage() {
  const { showInitialSkeleton } = useBusinessPageBoot("stripe-payouts", false);

  return (
    <BusinessSettingsPanelShell embedded>
      <ConnectPayoutsPanel loading={showInitialSkeleton} />
    </BusinessSettingsPanelShell>
  );
}
