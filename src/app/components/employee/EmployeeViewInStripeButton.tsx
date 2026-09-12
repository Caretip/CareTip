import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { createEmployeeConnectLoginLink } from "../../lib/api";
import { performExternalStripeRedirect } from "../../lib/externalStripeRedirect";
import { logClientError } from "../../lib/clientLog";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { cn } from "@/lib/utils";

export function EmployeeViewInStripeButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const onOpen = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { url } = await createEmployeeConnectLoginLink();
      const redirect = performExternalStripeRedirect(url, "expressDashboard");
      if (!redirect.ok) {
        toast.error(t("employee.payouts.redirectFailed"));
      }
    } catch (err) {
      logClientError("EmployeeViewInStripeButton", err);
      toast.error(toUserFriendlyMessage(err) || t("employee.payouts.dashboardFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      aria-busy={busy}
      aria-label={t("employee.payouts.history.viewInStripeAria")}
      onClick={() => void onOpen()}
      className={cn(
        "shrink-0 whitespace-nowrap text-sm font-medium text-primary underline-offset-2 hover:underline",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {busy ? t("employee.payouts.history.opening") : t("employee.payouts.history.viewInStripe")}
    </button>
  );
}
