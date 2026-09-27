import { Navigate, useSearchParams } from "react-router";
import { BusinessStripeConnectCard } from "../../../components/business/settings/billing/BusinessStripeConnectCard";
import { EmployeeTipPayoutModeCard } from "../../../components/business/settings/billing/EmployeeTipPayoutModeCard";
import { ConnectPayoutsPanel } from "../../../components/business/settings/billing/ConnectPayoutsPanel";
import { BusinessSettingsPanelShell } from "../../../components/business/settings/BusinessSettingsPanelShell";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";
import { cn } from "@/lib/utils";

const TIP_DISTRIBUTION_HREF = "/dashboard/tips/tip-distribution";

export function BusinessStripeConnectPage() {
  return (
    <BusinessSettingsPanelShell embedded>
      <div className="space-y-10">
        <BusinessStripeConnectCard />
        <EmployeeTipPayoutModeCard />
      </div>
    </BusinessSettingsPanelShell>
  );
}

export function BusinessStripePayoutsPage() {
  const { showInitialSkeleton } = useBusinessPageBoot("stripe-payouts", false);
  const [searchParams] = useSearchParams();

  if (searchParams.get("view") === "caretip") {
    return <Navigate to={TIP_DISTRIBUTION_HREF} replace />;
  }

  return (
    <BusinessSettingsPanelShell embedded>
      <div className={cn("mx-auto max-w-6xl")}>
        <ConnectPayoutsPanel loading={showInitialSkeleton} />
      </div>
    </BusinessSettingsPanelShell>
  );
}
