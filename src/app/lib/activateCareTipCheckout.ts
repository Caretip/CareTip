import { createBillingCheckoutSession } from "@/app/lib/api";
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

export type ActivationCheckoutPlan = "trial" | "pro";

export type ActivationCheckoutResult = "trial_navigated" | "stripe_navigated" | "failed";

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
  if (plan === "trial") {
    await closeOverlayThenTrialNavigate(options?.navigate, options?.closeBeforeNavigate);
    return "trial_navigated";
  }

  primeCheckoutSyncExpectation("premium");
  const session = await createBillingCheckoutSession({
    planKey: "premium",
    billingCycle: "monthly",
    checkoutFlow: "billing",
  });
  const redirect = performExternalStripeRedirect(session.url, "checkout");
  if (!redirect.ok) {
    toast.error(t("business.billing.checkoutNoUrl"));
    return "failed";
  }
  return "stripe_navigated";
}

export function activationCheckoutErrorMessage(err: unknown, t: TFunction): string {
  return toUserFriendlyMessage(err) || t("business.billing.checkoutError");
}
