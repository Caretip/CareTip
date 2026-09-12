import { useState } from "react";
import { BusinessStripeConnectCard } from "../../../components/business/settings/billing/BusinessStripeConnectCard";
import { EmployeeTipPayoutModeCard } from "../../../components/business/settings/billing/EmployeeTipPayoutModeCard";
import { EmployeeStripeConnectionsCard } from "../../../components/business/settings/billing/EmployeeStripeConnectionsCard";
import { ConnectPayoutsPanel } from "../../../components/business/settings/billing/ConnectPayoutsPanel";
import { BusinessSettingsPanelShell } from "../../../components/business/settings/BusinessSettingsPanelShell";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";
import type { EmployeeTipPayoutMode } from "../../../lib/api";

export function BusinessStripeConnectPage() {
  const [routingMode, setRoutingMode] = useState<EmployeeTipPayoutMode | null>(null);

  return (
    <BusinessSettingsPanelShell embedded>
      <div className="space-y-10">
        <BusinessStripeConnectCard />
        <EmployeeTipPayoutModeCard onModeChange={setRoutingMode} />
        <EmployeeStripeConnectionsCard routingMode={routingMode} />
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
