import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  createBillingCheckoutSession,
  createBillingPortalSession,
  scheduleBillingCancelAtPeriodEnd,
  type BillingStatus,
  type SubscriptionBillingCycle,
  type SubscriptionPlanKey,
} from "../../../../lib/api";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import { isDowngrade, isUpgrade } from "../../../../data/subscriptionPlans";
import {
  buildPricingTierCatalog,
  mapPricingTierToPlanKey,
  type PricingTierKey,
} from "../../../../data/pricingPlanCatalog";
import { buildBillingPlanComparisonFeatures } from "../../../../data/billingPlanComparisonFeatures";
import {
  hasOperationalBillingPlan,
  resolveBillingPlanKey,
} from "../../../../lib/billingDisplayState";
import { PricingTierCard, type PricingTierCardBadge } from "@/components/pricing/PricingTierCard";
import { PricingBillingToggle } from "@/components/pricing/PricingBillingToggle";
import { pricingPageUi } from "@/components/pricing/pricingPageUi";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { cn } from "@/lib/utils";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../../../../lib/globalAppLoading";
import { formatBillingDate, resolveBillingLocale } from "./billingFormatters";
import { performExternalStripeRedirect } from "../../../../lib/externalStripeRedirect";

type Props = {
  billing: BillingStatus;
  billingCycle: SubscriptionBillingCycle;
  onBillingCycleChange: (cycle: SubscriptionBillingCycle) => void;
  onChanged: () => void;
};

export function BillingPlanManagement({
  billing,
  billingCycle,
  onBillingCycleChange,
  onChanged,
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = resolveBillingLocale(i18n.language);
  const emptyDate = t("business.billing.notApplicable");
  const [busyPlan, setBusyPlan] = useState<SubscriptionPlanKey | "portal" | "cancel" | null>(null);

  const tiers = useMemo(() => buildPricingTierCatalog(t), [t]);
  const currentPlanKey = resolveBillingPlanKey(billing);
  const isTrialing =
    billing.isTrial || billing.status === "trialing" || billing.trialDaysRemaining != null;
  const trialDaysRemaining = billing.trialDaysRemaining ?? 0;
  const hasActivePlan = hasOperationalBillingPlan(billing);

  const canCheckout = billing.billingEnabled && billing.stripeConfigured;
  const canPortal = canCheckout && Boolean(billing.stripeCustomerId);

  const checkoutRedirecting = busyPlan !== null && busyPlan !== "cancel";
  useAppLoadingRegistration(
    "billing-plan-checkout",
    APP_LOADING_PRIORITY.APP_INIT,
    checkoutRedirecting,
    t("common.loading.checkout"),
  );

  async function handleUpgrade(planKey: SubscriptionPlanKey, includeTrial = false) {
    if (planKey === "enterprise" || planKey === "basic") return;
    setBusyPlan(planKey);
    try {
      const session = await createBillingCheckoutSession({
        planKey,
        billingCycle,
        includeTrial,
        checkoutFlow: "billing",
      });
      const redirect = performExternalStripeRedirect(session.url, "checkout");
      if (!redirect.ok) {
        toast.error(t("business.billing.checkoutNoUrl"));
        setBusyPlan(null);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.checkoutError"));
      setBusyPlan(null);
    }
  }

  async function handlePortal() {
    setBusyPlan("portal");
    try {
      const { url } = await createBillingPortalSession();
      const redirect = performExternalStripeRedirect(url, "portal");
      if (!redirect.ok) {
        toast.error(t("business.billing.portalError"));
        setBusyPlan(null);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.portalError"));
      setBusyPlan(null);
    }
  }

  async function handleCancel() {
    if (!window.confirm(t("business.billing.cancelConfirm"))) return;
    setBusyPlan("cancel");
    try {
      await scheduleBillingCancelAtPeriodEnd();
      toast.success(t("business.billing.cancelScheduled"));
      onChanged();
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.cancelError"));
    } finally {
      setBusyPlan(null);
    }
  }

  function resolveBadge(tierKey: PricingTierKey): PricingTierCardBadge | null {
    const planKey = mapPricingTierToPlanKey(tierKey);
    const isCurrent = hasActivePlan && planKey === currentPlanKey;

    if (isCurrent && isTrialing && trialDaysRemaining > 0) {
      return { kind: "trial", daysRemaining: trialDaysRemaining };
    }
    if (isCurrent) {
      return { kind: "current" };
    }
    return null;
  }

  function tierActionClass(tierKey: PricingTierKey): string {
    if (tierKey === "enterprise") return pricingPageUi.cardCtaEnterprise;
    const tier = tiers.find((item) => item.tierKey === tierKey);
    return tier?.isPopular ? pricingPageUi.cardCtaPrimary : pricingPageUi.cardCtaSecondary;
  }

  function renderSubscriptionInfo(tierKey: PricingTierKey): ReactNode {
    const planKey = mapPricingTierToPlanKey(tierKey);
    const isCurrent = hasActivePlan && planKey === currentPlanKey;
    if (!isCurrent) return null;

    if (billing.cancelAtPeriodEnd && billing.cancellationEffective) {
      return (
        <p className="leading-relaxed">
          {t("business.billing.planCard.cancelScheduled", {
            date: formatBillingDate(billing.cancellationEffective, locale, emptyDate),
          })}
        </p>
      );
    }

    if (isTrialing && billing.trialEndsAt) {
      return (
        <p className="leading-relaxed">
          {t("business.billing.planCard.trialEnds", {
            date: formatBillingDate(billing.trialEndsAt, locale, emptyDate),
          })}
        </p>
      );
    }

    if (planKey === "basic") {
      return (
        <p className="leading-relaxed">
          {t("business.billing.planCard.basicActive", {
            price: t("business.billing.subscriptionSummary.basicPrice"),
          })}
        </p>
      );
    }

    const renewalDate = billing.renewalDate ?? billing.currentPeriodEnd;
    if (renewalDate) {
      return (
        <p className="leading-relaxed">
          {t("business.billing.planCard.renewsOn", {
            date: formatBillingDate(renewalDate, locale, emptyDate),
          })}
        </p>
      );
    }

    return null;
  }

  function renderTierFooter(tierKey: PricingTierKey, tierName: string): ReactNode {
    const planKey = mapPricingTierToPlanKey(tierKey);
    const isCurrent = hasActivePlan && planKey === currentPlanKey;
    const isEnterprise = tierKey === "enterprise";

    if (isEnterprise) {
      return (
        <Link to="/contact?intent=enterprise" className={tierActionClass(tierKey)}>
          {t("business.billing.contactSales")}
        </Link>
      );
    }

    if (isCurrent) {
      return (
        <button
          type="button"
          disabled
          className={cn(
            pricingPageUi.cardCtaSecondary,
            "inline-flex cursor-default items-center justify-center gap-2 opacity-70",
          )}
          aria-disabled="true"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          {t("business.billing.currentPlanBadge")}
        </button>
      );
    }

    if (planKey === "premium" && currentPlanKey === "basic" && billing.trialEligible) {
      return (
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            disabled={!canCheckout || busyPlan !== null}
            onClick={() => void handleUpgrade("premium", true)}
            className={cn(tierActionClass(tierKey), "inline-flex items-center justify-center disabled:opacity-60")}
            aria-busy={busyPlan === "premium" || undefined}
          >
            {busyPlan === "premium" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              t("business.billing.trialFlow.promoCta")
            )}
          </button>
          <button
            type="button"
            disabled={!canCheckout || busyPlan !== null}
            onClick={() => void handleUpgrade("premium", false)}
            className={cn(
              pricingPageUi.cardCtaSecondary,
              "inline-flex items-center justify-center disabled:opacity-60",
            )}
          >
            {t("business.billing.planCard.subscribeToPro")}
          </button>
        </div>
      );
    }

    if (!hasActivePlan || (currentPlanKey && isUpgrade(currentPlanKey, planKey))) {
      return (
        <button
          type="button"
          disabled={!canCheckout || busyPlan !== null}
          onClick={() => void handleUpgrade(planKey)}
          className={cn(tierActionClass(tierKey), "inline-flex items-center justify-center disabled:opacity-60")}
          aria-busy={busyPlan === planKey || undefined}
        >
          {busyPlan === planKey ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : planKey === "premium" ? (
            t("business.billing.planCard.subscribeToPro")
          ) : (
            t("business.billing.upgradeToPlan", { plan: tierName })
          )}
        </button>
      );
    }

    if (currentPlanKey && isDowngrade(currentPlanKey, planKey)) {
      return (
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            disabled={!canPortal || busyPlan !== null}
            onClick={() => void handlePortal()}
            className={cn(
              pricingPageUi.cardCtaSecondary,
              "inline-flex items-center justify-center disabled:opacity-60",
            )}
            aria-busy={busyPlan === "portal" || undefined}
          >
            {busyPlan === "portal" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              t("business.billing.planCard.downgradeToPlan", { plan: tierName })
            )}
          </button>
          <p className="text-center text-xs leading-snug text-muted-foreground">
            {t("business.billing.planCard.downgradeViaPortal")}
          </p>
        </div>
      );
    }

    return null;
  }

  if (billing.accessSource === "sponsored") {
    return (
      <div className={cn(dashboardWorkspaceUi.card, dashboardWorkspaceUi.cardPad)}>
        <h3 className={dashboardWorkspaceUi.sectionTitle}>{t("business.billing.sponsoredAccessTitle")}</h3>
        <p className={cn(dashboardWorkspaceUi.helperText, "mt-1.5")}>
          {t("business.billing.subscriptionSummary.sponsoredProgramme")}
        </p>
        <Link
          to="/contact?intent=support"
          className={cn(dashboardWorkspaceUi.btnSecondary, "mt-4 inline-flex")}
        >
          {t("business.billing.subscriptionSummary.contactSupport")}
        </Link>
      </div>
    );
  }

  return (
    <div className="billing-plan-management space-y-6">
      <div className="billing-plan-management__controls flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 id="billing-cycle-heading" className={dashboardWorkspaceUi.subsectionTitle}>
            {t("business.billing.billingCycle")}
          </h3>
          {billingCycle === "yearly" ? (
            <p className="mt-1 text-sm font-medium text-primary">
              {t("staticPages.pricing.billing.saveBadge")}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <PricingBillingToggle
            value={billingCycle}
            onChange={onBillingCycleChange}
            className={cn("caretip-pricing-billing-toggle--in-panel w-full sm:w-auto sm:max-w-[16.5rem]")}
            aria-labelledby="billing-cycle-heading"
          />

          {canCheckout && billing.hasStripeBilling && !billing.cancelAtPeriodEnd ? (
            <button
              type="button"
              disabled={busyPlan !== null}
              onClick={() => void handleCancel()}
              className={cn(
                dashboardWorkspaceUi.btnGhost,
                "justify-center border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/30",
              )}
              aria-busy={busyPlan === "cancel" || undefined}
            >
              {busyPlan === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("business.billing.cancelSubscription")}
            </button>
          ) : null}
        </div>
      </div>

      {!canCheckout ? (
        <p
          className="rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
          role="status"
        >
          {t("business.billing.billingNotEnabled")}
        </p>
      ) : null}

      <div
        className="caretip-pricing-tiers caretip-pricing-tiers--billing"
        data-billing-cycle={billingCycle}
        role="list"
        aria-label={t("business.billing.planManagement")}
      >
        <div className="caretip-pricing-tiers__grid">
          {tiers.map((tier) => (
            <div key={tier.tierKey} role="listitem" className="flex h-full min-h-0 min-w-0">
              <PricingTierCard
                tier={tier}
                billingCycle={billingCycle}
                badge={resolveBadge(tier.tierKey)}
                footer={renderTierFooter(tier.tierKey, tier.name)}
                subscriptionInfo={renderSubscriptionInfo(tier.tierKey)}
                variant="subscription"
                showFeatures
                featureList={buildBillingPlanComparisonFeatures(t, tier.tierKey)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
