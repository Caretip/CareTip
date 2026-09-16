import { useCallback, useEffect, useState } from "react";
import {
  createBillingCheckoutSession,
  fetchMerchantLegalAcceptanceStatus,
  type SubscriptionBillingCycle,
  type SubscriptionPlanKey,
} from "@/app/lib/api";
import { MerchantLegalAcceptanceCheckbox } from "@/app/components/legal/MerchantLegalAcceptanceCheckbox";

type CheckoutParams = {
  planKey: SubscriptionPlanKey;
  billingCycle?: SubscriptionBillingCycle;
  includeTrial?: boolean;
  checkoutFlow?: "billing" | "onboarding";
};

/**
 * Ensures B2B legal acceptance before Stripe Checkout.
 * Shows a checkbox only when the merchant has not yet recorded acceptance.
 */
export function useMerchantCheckoutLegalGate() {
  const [acceptedOnFile, setAcceptedOnFile] = useState<boolean | null>(null);
  const [checkbox, setCheckbox] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMerchantLegalAcceptanceStatus()
      .then((s) => {
        if (!cancelled) {
          setAcceptedOnFile(s.accepted);
          if (s.accepted) setCheckbox(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAcceptedOnFile(false);
          setLoadError(err instanceof Error ? err.message : "Could not load legal status.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needsCheckbox = acceptedOnFile === false;
  const canProceed = acceptedOnFile === true || checkbox;

  const startCheckout = useCallback(
    async (params: CheckoutParams) => {
      if (acceptedOnFile !== true && !checkbox) {
        const err = new Error("MERCHANT_LEGAL_ACCEPTANCE_REQUIRED");
        throw err;
      }
      return createBillingCheckoutSession({
        ...params,
        ...(acceptedOnFile !== true ? { merchantLegalAccepted: true } : {}),
      });
    },
    [acceptedOnFile, checkbox],
  );

  const LegalGate = needsCheckbox ? (
    <MerchantLegalAcceptanceCheckbox
      checked={checkbox}
      onCheckedChange={setCheckbox}
      className="mb-3"
    />
  ) : null;

  return {
    LegalGate,
    canProceed,
    needsCheckbox,
    loadError,
    startCheckout,
    checkbox,
    setCheckbox,
  };
}
