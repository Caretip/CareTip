import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  clearEmployeeProfileClientCache,
  reactivateEmployeeReceiving,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { Button } from "../ui/button";

export function EmployeeReceivingPausedBanner(props: {
  receivingPaused: boolean;
  onReactivated?: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!props.receivingPaused) return null;

  const onReactivate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await reactivateEmployeeReceiving();
      clearEmployeeProfileClientCache();
      toast.success(t("employee.receiving.reactivated"));
      props.onReactivated?.();
    } catch (err) {
      logClientError("EmployeeReceivingPausedBanner", err);
      toast.error(toUserFriendlyMessage(err) || t("employee.receiving.reactivateFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-4"
      role="status"
      aria-labelledby="employee-receiving-paused-heading"
    >
      <h2 id="employee-receiving-paused-heading" className="text-base font-semibold tracking-tight">
        {t("employee.receiving.pausedTitle")}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("employee.receiving.pausedBody")}</p>
      <Button type="button" className="mt-3 min-h-11" onClick={() => void onReactivate()} disabled={busy}>
        {t("employee.receiving.reactivateCta")}
      </Button>
    </section>
  );
}
