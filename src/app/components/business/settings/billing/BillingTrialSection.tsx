import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { BillingStatus } from "@/app/lib/api";
import { createBillingCheckoutSession } from "@/app/lib/api";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "@/app/lib/globalAppLoading";
import {
  isBillingTrialActive,
  shouldShowTrialExpiredUpgrade,
} from "@/app/lib/billingDisplayState";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";

type BillingTrialPlanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billingCycle: "monthly" | "yearly";
};

/** Pro-only trial — upgrades Basic → Pro for 4 weeks. */
export function BillingTrialPlanDialog({
  open,
  onOpenChange,
  billingCycle,
}: BillingTrialPlanDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  useAppLoadingRegistration(
    "billing-trial-checkout",
    APP_LOADING_PRIORITY.APP_INIT,
    busy,
    t("common.loading.checkout"),
  );

  async function startTrialCheckout() {
    setBusy(true);
    try {
      const session = await createBillingCheckoutSession({
        planKey: "premium",
        billingCycle,
        includeTrial: true,
        checkoutFlow: "billing",
      });
      const redirect = performExternalStripeRedirect(session.url, "checkout");
      if (!redirect.ok) {
        toast.error(t("business.billing.checkoutNoUrl"));
        setBusy(false);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.checkoutError"));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-2 border-b border-border bg-background px-6 py-5 text-left">
          <DialogTitle className={dashboardWorkspaceUi.sectionTitle}>
            {t("business.billing.trialFlow.chooseTitle")}
          </DialogTitle>
          <DialogDescription className={dashboardWorkspaceUi.helperText}>
            {t("business.billing.trialFlow.chooseDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5">
          <p className="rounded-lg border border-primary/15 bg-primary/[0.05] px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            {t("business.billing.trialFlow.planHint.premium")}
          </p>
        </div>

        <DialogFooter className="flex-col gap-2 border-t border-border/60 bg-muted/10 px-6 py-4 sm:flex-col">
          <button
            type="button"
            disabled={busy}
            onClick={() => void startTrialCheckout()}
            className={cn(dashboardWorkspaceUi.btnPrimary, "w-full justify-center")}
            aria-busy={busy || undefined}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("business.billing.trialFlow.confirmCta")}
          </button>
          <p className="text-center text-[11px] leading-snug text-muted-foreground">
            {t("business.billing.trialPaymentNote")}
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type BillingTrialSectionProps = {
  billing: BillingStatus;
  billingCycle: "monthly" | "yearly";
  autoOpenTrial?: boolean;
  onAutoOpenHandled?: () => void;
};

export function BillingTrialSection({
  billing,
  billingCycle,
  autoOpenTrial = false,
  onAutoOpenHandled,
}: BillingTrialSectionProps) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (autoOpenTrial && billing.trialEligible) {
      setDialogOpen(true);
      onAutoOpenHandled?.();
    }
  }, [autoOpenTrial, billing.trialEligible, onAutoOpenHandled]);

  if (billing.accessSource === "sponsored") return null;

  // Active Pro trial: keep features unlocked; status lives in BillingSubscriptionSummary / TrialSummary.
  if (isBillingTrialActive(billing)) {
    return null;
  }

  if (shouldShowTrialExpiredUpgrade(billing)) {
    return <BillingTrialExpiredUpgrade billingCycle={billingCycle} />;
  }

  if (billing.trialEligible) {
    return (
      <>
        <section
          id={BILLING_START_TRIAL_HASH}
          className={cn(
            dashboardWorkspaceUi.card,
            dashboardWorkspaceUi.cardPad,
            "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
          )}
          aria-labelledby="billing-trial-promo-title"
        >
          <div className="min-w-0">
            <h3 id="billing-trial-promo-title" className={dashboardWorkspaceUi.sectionTitle}>
              {t("business.billing.trialFlow.promoTitle")}
            </h3>
            <p className={cn(dashboardWorkspaceUi.helperText, "mt-1 max-w-2xl")}>
              {t("business.billing.trialFlow.promoBody")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className={cn(dashboardWorkspaceUi.btnPrimary, "w-full shrink-0 justify-center sm:w-auto")}
          >
            {t("business.billing.trialFlow.promoCta")}
          </button>
        </section>
        <p className="text-center text-xs text-muted-foreground">
          {t("business.billing.trialFlow.orSubscribeBelow")}
        </p>
        <BillingTrialPlanDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          billingCycle={billingCycle}
        />
      </>
    );
  }

  return null;
}

function BillingTrialExpiredUpgrade({ billingCycle }: { billingCycle: "monthly" | "yearly" }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  useAppLoadingRegistration(
    "billing-trial-expired-checkout",
    APP_LOADING_PRIORITY.APP_INIT,
    busy,
    t("common.loading.checkout"),
  );

  async function handleUpgrade() {
    setBusy(true);
    try {
      const session = await createBillingCheckoutSession({
        planKey: "premium",
        billingCycle,
        includeTrial: false,
        checkoutFlow: "billing",
      });
      const redirect = performExternalStripeRedirect(session.url, "checkout");
      if (!redirect.ok) {
        toast.error(t("business.billing.checkoutNoUrl"));
        setBusy(false);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.checkoutError"));
      setBusy(false);
    }
  }

  return (
    <section className={cn(dashboardWorkspaceUi.card, dashboardWorkspaceUi.cardPad)}>
      <h3 className={dashboardWorkspaceUi.sectionTitle}>{t("business.billing.trialFlow.expiredTitle")}</h3>
      <p className={cn(dashboardWorkspaceUi.helperText, "mt-1.5")}>
        {t("business.billing.trialFlow.alreadyUsed")}
      </p>
      <p className={cn(dashboardWorkspaceUi.helperText, "mt-1.5")}>
        {t("business.billing.trialFlow.expiredBody")}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleUpgrade()}
        className={cn(dashboardWorkspaceUi.btnPrimary, "mt-4 inline-flex w-full justify-center sm:w-auto")}
        aria-busy={busy || undefined}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {t("business.billing.trialFlow.upgradeCta")}
      </button>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        <Link to="/contact?intent=enterprise" className="font-medium text-primary hover:underline">
          {t("business.billing.trialFlow.expiredPremiumLink")}
        </Link>
      </p>
    </section>
  );
}

export const BILLING_START_TRIAL_HASH = "start-trial";
