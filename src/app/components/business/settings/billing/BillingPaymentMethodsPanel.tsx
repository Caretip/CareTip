import { useCallback, useState } from "react";
import { useStaleExternalStripeStateReset } from "../../../../hooks/useStaleExternalStripeStateReset";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { createBillingPortalSession } from "../../../../lib/api";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import { StripeHandoffLabel } from "@/app/components/payments/StripeHandoffLabel";
import { performExternalStripeRedirect } from "../../../../lib/externalStripeRedirect";
import { Button } from "@/components/ui/button";

const PAYMENT_METHOD_BULLET_KEYS = [
  "business.billing.paymentMethodsBulletAdd",
  "business.billing.paymentMethodsBulletReplace",
  "business.billing.paymentMethodsBulletRemove",
  "business.billing.paymentMethodsBulletUpdate",
] as const;

export function BillingPaymentMethodsPanel() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const resetBusy = useCallback(() => setBusy(false), []);
  useStaleExternalStripeStateReset({ onReset: resetBusy });


  async function openPaymentMethods() {
    setBusy(true);
    try {
      const { url } = await createBillingPortalSession({ flow: "payment_methods" });
      const redirect = performExternalStripeRedirect(url, "portal", undefined, {
        presentation: "inline",
        onStalled: () => {
          setBusy(false);
          toast.error(t("business.billing.portalStalled"));
        },
      });
      if (!redirect.ok) {
        toast.error(t("business.billing.portalError"));
        setBusy(false);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.portalError"));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <ul className="space-y-2 text-sm text-muted-foreground">
        {PAYMENT_METHOD_BULLET_KEYS.map((key) => (
          <li key={key} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <Button type="button" onClick={() => void openPaymentMethods()} disabled={busy}>
        {busy ? (
          <StripeHandoffLabel kind="portal" />
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" aria-hidden />
            {t("business.billing.managePaymentMethods")}
          </>
        )}
      </Button>
    </div>
  );
}
