import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useBillingStatus } from "../../../hooks/useBillingStatus";
import { createBillingPortalSession, type SubscriptionBillingCycle } from "../../../lib/api";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../../../lib/globalAppLoading";
import { performExternalStripeRedirect } from "../../../lib/externalStripeRedirect";
import { BillingPlanManagement } from "./billing/BillingPlanManagement";
import { BillingTrialSection, BILLING_START_TRIAL_HASH } from "./billing/BillingTrialSection";
import { BillingSubscriptionLifecycle } from "./billing/BillingSubscriptionLifecycle";
import { BillingSubscriptionSummary } from "./billing/BillingSubscriptionSummary";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { cn } from "@/lib/utils";
import { BILLING_PLANS_SECTION_ID, scrollToBillingPlansSection } from "../../../lib/activateCareTipNavigation";

const BILLING_HISTORY_PATH = "/dashboard/billing/history";

export function BusinessSettingsBillingPanel() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const { data, loading, error, reload } = useBillingStatus();
  const [billingCycle, setBillingCycle] = useState<SubscriptionBillingCycle>("monthly");
  const [portalBusy, setPortalBusy] = useState(false);
  const [trialAutoOpen, setTrialAutoOpen] = useState(false);

  useAppLoadingRegistration(
    "billing-settings-portal",
    APP_LOADING_PRIORITY.APP_INIT,
    portalBusy,
    t("common.loading.checkout"),
  );

  useEffect(() => {
    if (data?.billingCycle) {
      setBillingCycle(data.billingCycle);
    }
  }, [data?.billingCycle]);

  useEffect(() => {
    if (loading || !data) return;
    if (hash === `#${BILLING_START_TRIAL_HASH}`) {
      setTrialAutoOpen(true);
    }
  }, [loading, data, hash]);

  useEffect(() => {
    if (loading || !data || hash !== `#${BILLING_PLANS_SECTION_ID}`) return;
    const timer = window.setTimeout(() => scrollToBillingPlansSection("smooth"), 80);
    return () => window.clearTimeout(timer);
  }, [loading, data, hash]);

  async function openBillingPortal() {
    setPortalBusy(true);
    try {
      const { url } = await createBillingPortalSession();
      const redirect = performExternalStripeRedirect(url, "portal");
      if (!redirect.ok) {
        toast.error(t("business.billing.portalError"));
        setPortalBusy(false);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.portalError"));
      setPortalBusy(false);
    }
  }

  const canOpenPortal =
    Boolean(data?.billingEnabled && data.stripeConfigured && data.stripeCustomerId);

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <span className="sr-only">{t("business.billing.loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
        role="alert"
      >
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-2 font-semibold underline underline-offset-2"
        >
          {t("business.billing.retry")}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const hasBillingHistory = data.events.length > 0;

  return (
    <div className="billing-settings-panel space-y-8">
      <BillingSubscriptionSummary
        billing={data}
        onManageBilling={canOpenPortal ? () => void openBillingPortal() : undefined}
        manageBillingBusy={portalBusy}
      />

      <BillingSubscriptionLifecycle billing={data} />

      {data.accessSource !== "sponsored" ? (
        <section id="billing-plans" className="billing-settings-panel__plans space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className={dashboardWorkspaceUi.sectionTitle}>{t("business.billing.planComparisonTitle")}</h2>
              <p className={cn(dashboardWorkspaceUi.pageDescription, "mt-1")}>
                {t("business.billing.planComparisonDesc")}
              </p>
            </div>
            {hasBillingHistory ? (
              <Link
                to={BILLING_HISTORY_PATH}
                className={cn(dashboardWorkspaceUi.btnGhost, "shrink-0 text-sm")}
              >
                {t("business.billing.viewBillingHistory")}
              </Link>
            ) : null}
          </div>

          <BillingTrialSection
            billing={data}
            billingCycle={billingCycle}
            autoOpenTrial={trialAutoOpen}
            onAutoOpenHandled={() => setTrialAutoOpen(false)}
          />

          <BillingPlanManagement
            billing={data}
            billingCycle={billingCycle}
            onBillingCycleChange={setBillingCycle}
            onChanged={() => void reload()}
          />
        </section>
      ) : null}
    </div>
  );
}
