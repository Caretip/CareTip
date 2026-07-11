import { useState } from "react";
import { Link } from "react-router";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { createBillingCheckoutSession } from "@/app/lib/api";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { useBillingStatus } from "@/app/hooks/useBillingStatus";
import { BILLING_SUBSCRIPTION_PATH } from "@/app/lib/activateCareTipNavigation";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "@/app/lib/globalAppLoading";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";
import { cn } from "@/lib/utils";

const PRO_UPGRADE_FEATURE_KEYS = [
  "business.dashboard.proUpgrade.features.advancedAnalytics",
  "business.dashboard.proUpgrade.features.customerFeedback",
  "business.dashboard.proUpgrade.features.employeeGoals",
  "business.dashboard.proUpgrade.features.csvExports",
  "business.dashboard.proUpgrade.features.branding",
  "business.dashboard.proUpgrade.features.multiLocation",
] as const;

type ProUpgradeCardProps = {
  className?: string;
};

/** Dashboard-level Pro promotion — one card instead of multiple large upgrade blocks. */
export function ProUpgradeCard({ className }: ProUpgradeCardProps) {
  const { t } = useTranslation();
  const { data: billing } = useBillingStatus();
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  useAppLoadingRegistration(
    "pro-upgrade-checkout",
    APP_LOADING_PRIORITY.APP_INIT,
    checkoutBusy,
    t("common.loading.checkout"),
  );

  const trialEligible = Boolean(
    billing?.trialEligible && billing.billingEnabled && billing.stripeConfigured,
  );
  const canCheckout = Boolean(billing?.billingEnabled && billing.stripeConfigured);

  async function startProCheckout(includeTrial: boolean) {
    setCheckoutBusy(true);
    try {
      const session = await createBillingCheckoutSession({
        planKey: "premium",
        billingCycle: billing?.billingCycle ?? "monthly",
        includeTrial,
        checkoutFlow: "billing",
      });
      const redirect = performExternalStripeRedirect(session.url, "checkout");
      if (!redirect.ok) {
        toast.error(t("business.billing.checkoutNoUrl"));
        setCheckoutBusy(false);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.checkoutError"));
      setCheckoutBusy(false);
    }
  }

  return (
    <section
      className={cn("pro-upgrade-card", className)}
      aria-labelledby="pro-upgrade-card-title"
    >
      <div className="pro-upgrade-card__inner">
        <h2 id="pro-upgrade-card-title" className="pro-upgrade-card__title">
          {t("business.dashboard.proUpgrade.title")}
        </h2>
        <p className="pro-upgrade-card__subtitle">{t("business.dashboard.proUpgrade.subtitle")}</p>

        <ul className="pro-upgrade-card__features" aria-label={t("subscription.locked.includesAria")}>
          {PRO_UPGRADE_FEATURE_KEYS.map((key) => (
            <li key={key} className="pro-upgrade-card__feature">
              <Check className="pro-upgrade-card__check" aria-hidden />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>

        <div className="pro-upgrade-card__actions">
          {trialEligible ? (
            <button
              type="button"
              disabled={checkoutBusy}
              onClick={() => void startProCheckout(true)}
              className="pro-upgrade-card__cta pro-upgrade-card__cta--primary"
              aria-busy={checkoutBusy || undefined}
            >
              {checkoutBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("business.billing.trialFlow.promoCta")}
            </button>
          ) : canCheckout ? (
            <button
              type="button"
              disabled={checkoutBusy}
              onClick={() => void startProCheckout(false)}
              className="pro-upgrade-card__cta pro-upgrade-card__cta--primary"
              aria-busy={checkoutBusy || undefined}
            >
              {checkoutBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("subscription.upgrade.upgradeToPremium")}
            </button>
          ) : (
            <Link to={BILLING_SUBSCRIPTION_PATH} className="pro-upgrade-card__cta pro-upgrade-card__cta--primary">
              {t("subscription.upgrade.upgradeToPremium")}
            </Link>
          )}

          <Link to={BILLING_SUBSCRIPTION_PATH} className="pro-upgrade-card__cta pro-upgrade-card__cta--secondary">
            {t("business.dashboard.proUpgrade.learnMore")}
          </Link>
        </div>
      </div>
    </section>
  );
}
