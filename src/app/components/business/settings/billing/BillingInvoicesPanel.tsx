import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createBillingPortalSession } from "../../../../lib/api";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../../../../lib/globalAppLoading";
import { performExternalStripeRedirect } from "../../../../lib/externalStripeRedirect";
import { Button } from "@/components/ui/button";

export function BillingInvoicesPanel() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  useAppLoadingRegistration(
    "billing-invoices-portal",
    APP_LOADING_PRIORITY.APP_INIT,
    busy,
    t("common.loading.checkout"),
  );

  async function openPortal() {
    setBusy(true);
    try {
      const { url } = await createBillingPortalSession();
      const redirect = performExternalStripeRedirect(url, "portal");
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
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
        {t("business.billing.openBillingPortal")}
      </Button>
    </div>
  );
}
