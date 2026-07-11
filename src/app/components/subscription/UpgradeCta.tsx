import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { createBillingCheckoutSession, fetchBillingStatus } from "@/app/lib/api";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import type { FeatureKey } from "@/app/lib/subscriptionCapabilities";
import { getFeatureCatalog } from "@/app/lib/subscriptionFeatureCatalog";
import {
  closeOverlayThenNavigate,
  type CloseBeforeNavigate,
} from "@/app/lib/activateCareTipNavigation";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "@/app/lib/globalAppLoading";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";
import { cn } from "@/lib/utils";

type UpgradeCtaProps = {
  featureKey?: FeatureKey;
  className?: string;
  variant?: "primary" | "secondary" | "link";
  fullWidth?: boolean;
  /** Override default upgrade label (i18n key). */
  labelKey?: string;
  /** When provided (e.g. inside a modal), closes the overlay before redirecting to billing. */
  closeBeforeNavigate?: CloseBeforeNavigate;
  closeAnimationMs?: number;
};

export function UpgradeCta({
  featureKey,
  className,
  variant = "primary",
  fullWidth = false,
  labelKey,
  closeBeforeNavigate,
  closeAnimationMs,
}: UpgradeCtaProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useAppLoadingRegistration(
    "upgrade-cta-checkout",
    APP_LOADING_PRIORITY.APP_INIT,
    busy,
    t("common.loading.checkout"),
  );

  const requiredTier = featureKey ? getFeatureCatalog(featureKey).requiredTier : "premium";

  const baseClass = cn(
    "inline-flex min-h-[44px] touch-manipulation items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors disabled:opacity-60",
    fullWidth && "w-full",
    variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
    variant === "secondary" &&
      "border border-border bg-background text-foreground hover:bg-muted/50",
    variant === "link" && "min-h-0 px-0 text-primary underline-offset-4 hover:underline",
    className,
  );

  async function handleUpgrade() {
    if (requiredTier === "enterprise") {
      if (closeBeforeNavigate) {
        await closeBeforeNavigate();
      }
      window.location.assign("/contact?intent=demo");
      return;
    }
    setBusy(true);
    try {
      const billing = await fetchBillingStatus();
      if (billing?.billingEnabled && billing.stripeConfigured) {
        if (closeBeforeNavigate) {
          await closeBeforeNavigate();
        }
        const session = await createBillingCheckoutSession({
          planKey: "premium",
          billingCycle: billing.billingCycle ?? "monthly",
        });
        const redirect = performExternalStripeRedirect(session.url, "checkout");
        if (!redirect.ok) {
          toast.error(t("business.billing.checkoutNoUrl"));
          setBusy(false);
        }
        return;
      }
      await closeOverlayThenNavigate(navigate, { closeBeforeNavigate, closeAnimationMs });
      setBusy(false);
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.checkoutError"));
      setBusy(false);
    }
  }

  const label = labelKey
    ? t(labelKey)
    : requiredTier === "enterprise"
      ? t("subscription.upgrade.contactSales")
      : t("subscription.upgrade.upgradeToPremium");

  if (requiredTier === "enterprise") {
    return (
      <Link to="/contact?intent=demo" className={baseClass}>
        {label}
      </Link>
    );
  }

  return (
    <button type="button" className={baseClass} disabled={busy} onClick={() => void handleUpgrade()}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {label}
    </button>
  );
}
