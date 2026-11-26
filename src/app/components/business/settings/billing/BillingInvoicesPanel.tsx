import { useCallback, useState } from "react";
import { useStaleExternalStripeStateReset } from "../../../../hooks/useStaleExternalStripeStateReset";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { createBillingPortalSession } from "../../../../lib/api";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import { StripeHandoffLabel } from "@/app/components/payments/StripeHandoffLabel";
import { performExternalStripeRedirect } from "../../../../lib/externalStripeRedirect";
import { Button } from "@/components/ui/button";

export function BillingInvoicesPanel() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const resetBusy = useCallback(() => setBusy(false), []);
  useStaleExternalStripeStateReset({ onReset: resetBusy });


  async function openPortal() {
    setBusy(true);
    try {
      const { url } = await createBillingPortalSession();
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
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("business.billing.invoicesHint")}</p>
      <Button type="button" onClick={() => void openPortal()} disabled={busy}>
        {busy ? (
          <StripeHandoffLabel kind="portal" />
        ) : (
          <>
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
            {t("business.billing.openBillingPortal")}
          </>
        )}
      </Button>
    </div>
  );
}
