import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { BusinessStripeConnectCard } from "../../../components/business/settings/billing/BusinessStripeConnectCard";
import { EmployeeTipPayoutModeCard } from "../../../components/business/settings/billing/EmployeeTipPayoutModeCard";
import { ConnectPayoutsPanel } from "../../../components/business/settings/billing/ConnectPayoutsPanel";
import { BusinessPayoutsCareTipView } from "../../../components/business/settings/billing/BusinessPayoutsCareTipView";
import { BusinessSettingsPanelShell } from "../../../components/business/settings/BusinessSettingsPanelShell";
import { useBusinessPageBoot } from "../../../lib/useBusinessPageBoot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { cn } from "@/lib/utils";

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
  const { t } = useTranslation();
  const { showInitialSkeleton } = useBusinessPageBoot("stripe-payouts", false);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "caretip" ? "caretip" : "business";

  return (
    <BusinessSettingsPanelShell embedded>
      <div className={cn("mx-auto max-w-6xl")}>
        <Tabs
          value={view}
          onValueChange={(next) => {
            const params = new URLSearchParams(searchParams);
            if (next === "caretip") params.set("view", "caretip");
            else params.delete("view");
            setSearchParams(params, { replace: true });
          }}
          className="gap-6"
        >
          <TabsList
            className="h-10 w-full max-w-full sm:w-fit"
            aria-label={t("business.stripe.payoutsWorkspace.toggleAria")}
          >
            <TabsTrigger value="caretip" className="min-w-0 flex-1 whitespace-normal px-3 py-1.5 sm:flex-none sm:min-w-[7.5rem] sm:whitespace-nowrap sm:px-5">
              {t("business.stripe.payoutsWorkspace.caretipLabel")}
            </TabsTrigger>
            <TabsTrigger value="business" className="min-w-0 flex-1 whitespace-normal px-3 py-1.5 sm:flex-none sm:min-w-[7.5rem] sm:whitespace-nowrap sm:px-5">
              {t("business.stripe.payoutsWorkspace.businessLabel")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="caretip" className="mt-0">
            <BusinessPayoutsCareTipView />
          </TabsContent>
          <TabsContent value="business" className="mt-0">
            <ConnectPayoutsPanel loading={showInitialSkeleton} />
          </TabsContent>
        </Tabs>
      </div>
    </BusinessSettingsPanelShell>
  );
}
