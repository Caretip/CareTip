import { BusinessStripeConnectCard } from "../../../components/business/settings/billing/BusinessStripeConnectCard";
import { EmployeeTipPayoutModeCard } from "../../../components/business/settings/billing/EmployeeTipPayoutModeCard";
import { ConnectPayoutsPanel } from "../../../components/business/settings/billing/ConnectPayoutsPanel";
import { BusinessSettingsPanelShell } from "../../../components/business/settings/BusinessSettingsPanelShell";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";

export function BusinessStripeConnectPage() {
  return (
    <BusinessSettingsPanelShell embedded>
      <div className="space-y-6">
        <BusinessStripeConnectCard />
        <EmployeeTipPayoutModeCard />
      </div>
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
