import { BusinessStripeConnectCard } from "../../../components/business/settings/billing/BusinessStripeConnectCard";
import { EmployeeTipPayoutModeCard } from "../../../components/business/settings/billing/EmployeeTipPayoutModeCard";
import { BusinessRecentPayoutsPreview } from "../../../components/business/settings/billing/BusinessRecentPayoutsPreview";
import { ConnectPayoutsPanel } from "../../../components/business/settings/billing/ConnectPayoutsPanel";
import { BusinessSettingsPanelShell } from "../../../components/business/settings/BusinessSettingsPanelShell";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";

export function BusinessStripeConnectPage() {
  return (
    <BusinessSettingsPanelShell embedded>
      <div className="space-y-10">
        <BusinessStripeConnectCard />
        <EmployeeTipPayoutModeCard />
        <BusinessRecentPayoutsPreview />
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
