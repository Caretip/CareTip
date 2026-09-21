import { createBillingCheckoutSession, fetchMerchantLegalAcceptanceStatus } from "@/app/lib/api";
import { primeCheckoutSyncExpectation } from "@/app/lib/checkoutIntent";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import {
  BILLING_START_TRIAL_URL,
  releaseBodyScrollLock,
  waitForDialogCloseAnimation,
  waitForNextFrame,
  type CloseBeforeNavigate,
} from "@/app/lib/activateCareTipNavigation";
import type { TFunction } from "i18next";
import type { NavigateFunction } from "react-router";
import { toast } from "sonner";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";
import { withIdleSuppress } from "@/app/lib/idleSuppress";

export type ActivationCheckoutPlan = "trial" | "pro";

export type ActivationCheckoutResult =
  | "trial_navigated"
  | "stripe_navigated"
  | "failed"
  | "busy";

/** Sync lock — React `busy` is too late to stop a double-tap on billing checkout. */
let activationCheckoutInFlight = false;

/** bfcache restore only — never call during active forward checkout. */
export function clearActivationCheckoutInFlightForStaleRestore(): void {
  activationCheckoutInFlight = false;
}

async function closeOverlayThenTrialNavigate(
  navigate?: NavigateFunction,
  closeBeforeNavigate?: CloseBeforeNavigate,
): Promise<void> {
  if (closeBeforeNavigate) {
    await closeBeforeNavigate();
    await waitForNextFrame();
    await waitForDialogCloseAnimation();
    releaseBodyScrollLock();
  }
  if (navigate) {
    navigate(BILLING_START_TRIAL_URL);
    return;
  }
  window.location.assign(BILLING_START_TRIAL_URL);
}

export async function startActivationCheckout(
  plan: ActivationCheckoutPlan,
  t: TFunction,
  options?: {
    closeBeforeNavigate?: CloseBeforeNavigate;
    navigate?: NavigateFunction;
  },
): Promise<ActivationCheckoutResult> {
  if (activationCheckoutInFlight) return "busy";
  activationCheckoutInFlight = true;
  let keepLock = false;
  try {
    if (plan === "trial") {
      await closeOverlayThenTrialNavigate(options?.navigate, options?.closeBeforeNavigate);
      return "trial_navigated";
    }

    const result = await withIdleSuppress("billing-checkout-create", async () => {
      primeCheckoutSyncExpectation("premium");
      try {
        const status = await fetchMerchantLegalAcceptanceStatus();
        if (!status.accepted) {
          // No inline checkbox here — route to billing trial UI for legal acceptance.
          await closeOverlayThenTrialNavigate(options?.navigate, options?.closeBeforeNavigate);
          return "trial_navigated" as const;
        }
      } catch {
        /* If status cannot be loaded, still attempt checkout; backend will enforce. */
      }
      const session = await createBillingCheckoutSession({
        planKey: "premium",
        billingCycle: "monthly",
        checkoutFlow: "billing",
      });
      const redirect = performExternalStripeRedirect(session.url, "checkout");
      if (!redirect.ok) {
        toast.error(t("business.billing.checkoutNoUrl"));
        return "failed" as const;
      }
      return "stripe_navigated" as const;
    });
    keepLock = result === "stripe_navigated";
    return result;
  } finally {
    if (!keepLock) activationCheckoutInFlight = false;
  }
}

export function activationCheckoutErrorMessage(err: unknown, t: TFunction): string {
  return toUserFriendlyMessage(err) || t("business.billing.checkoutError");
}
