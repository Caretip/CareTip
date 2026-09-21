import type { TFunction } from "i18next";
import { toast } from "sonner";
import { peekCheckoutIntent, clearCheckoutIntent } from "./checkoutIntent";
import { runBillingCheckoutSuccessSync } from "./billingCheckoutSuccessSync";
import { clearBusinessProfileClientCache, fetchBillingSyncStatus, type BillingSyncStatus, type SubscriptionPlanKey } from "./api";
import { subscriptionPlanDisplayName } from "./subscriptionPlanDisplayName";
import { clearSubscriptionTierSession } from "./subscriptionSessionCache";

const TOAST_SHOWN_PREFIX = "caretip.subscriptionActivationToast.";

function toastDedupeKey(sessionId?: string | null): string {
  const id = sessionId?.trim() || "checkout-return";
  return `${TOAST_SHOWN_PREFIX}${id}`;
}

function hasShownToast(sessionId?: string | null): boolean {
  try {
    return sessionStorage.getItem(toastDedupeKey(sessionId)) === "1";
  } catch {
    return false;
  }
}

function markToastShown(sessionId?: string | null): void {
  try {
    sessionStorage.setItem(toastDedupeKey(sessionId), "1");
  } catch {
    // ignore
  }
}

function planMarketingLabel(planKey: SubscriptionPlanKey | null | undefined, t: TFunction): string {
  return subscriptionPlanDisplayName(planKey, t);
}

function resolveActivationToastCopy(
  t: TFunction,
  syncStatus: BillingSyncStatus | null,
): { title: string; description: string } {
  const intent = peekCheckoutIntent();
  const isTrial = syncStatus?.isTrial === true || intent?.trial === true;

  if (isTrial) {
    return {
      title: t("business.billing.activationToast.trialTitle"),
      description: t("business.billing.activationToast.trialBody", {
        plan: planMarketingLabel(syncStatus?.planKey ?? intent?.planKey, t),
      }),
    };
  }

  if (intent?.planKey) {
    return {
      title: t("business.billing.activationToast.subscriptionTitle"),
      description: t("business.billing.activationToast.subscriptionBody", {
        plan: planMarketingLabel(syncStatus?.planKey ?? intent.planKey, t),
      }),
    };
  }

  return {
    title: t("business.billing.activationToast.planUpdatedTitle"),
    description: t("business.billing.activationToast.planUpdatedBody"),
  };
}

/**
 * After Stripe checkout return: sync entitlements, show a one-time success toast, refresh caches.
 */
export async function processBillingCheckoutSuccess(opts: {
  t: TFunction;
  sessionId?: string | null;
}): Promise<boolean> {
  const { t, sessionId } = opts;
  const alreadyShown = hasShownToast(sessionId);

  clearBusinessProfileClientCache();
  clearSubscriptionTierSession();

  const intent = peekCheckoutIntent();
  const synced = await runBillingCheckoutSuccessSync({
    expectedPlan: intent?.planKey,
    checkoutSessionId: sessionId,
  });

  let syncStatus: BillingSyncStatus | null = null;
  if (synced) {
    try {
      syncStatus = await fetchBillingSyncStatus(intent?.planKey, sessionId);
    } catch {
      syncStatus = null;
    }
  }

  if (!alreadyShown && synced) {
    const copy = resolveActivationToastCopy(t, syncStatus);
    toast.success(copy.title, { description: copy.description, duration: 6000 });
    markToastShown(sessionId);
    clearCheckoutIntent();
  }

  return synced;
}
