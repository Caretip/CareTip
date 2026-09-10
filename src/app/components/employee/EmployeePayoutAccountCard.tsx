import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  createEmployeeConnectAccountLink,
  createEmployeeConnectLoginLink,
  getEmployeeConnectStatus,
  type EmployeeConnectStatus,
  type EmployeePayoutConnectionState,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { performExternalStripeRedirect } from "../../lib/externalStripeRedirect";
import { employeeUi } from "./employeeDashboardUi";
import { Button } from "../ui/button";
import { formatEur } from "../../lib/formatEur";
import { cn } from "@/lib/utils";

function stateTone(state: EmployeePayoutConnectionState): string {
  if (state === "connected") {
    return "border-l-emerald-600 bg-emerald-50/80 text-emerald-950 dark:border-l-emerald-500 dark:bg-emerald-950/25 dark:text-emerald-50";
  }
  if (state === "setup_required" || state === "action_required") {
    return "border-l-amber-500 bg-amber-50/80 text-amber-950 dark:border-l-amber-400 dark:bg-amber-950/25 dark:text-amber-50";
  }
  if (state === "restricted") {
    return "border-l-red-600 bg-red-50/80 text-red-950 dark:border-l-red-500 dark:bg-red-950/30 dark:text-red-50";
  }
  return "border-l-border bg-muted/40 text-foreground";
}

export function EmployeePayoutAccountCard() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<EmployeeConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"onboarding" | "dashboard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await getEmployeeConnectStatus();
      setData(status);
    } catch (err) {
      logClientError("EmployeePayoutAccountCard", err);
      setError(toUserFriendlyMessage(err) || t("employee.payouts.loadError"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const flag = searchParams.get("payoutConnect");
    if (flag !== "return" && flag !== "refresh") return;
    void reload().then(() => {
      if (flag === "refresh") {
        toast.message(t("employee.payouts.linkExpired"));
      } else {
        toast.success(t("employee.payouts.returned"));
      }
      const next = new URLSearchParams(searchParams);
      next.delete("payoutConnect");
      setSearchParams(next, { replace: true });
    });
  }, [reload, searchParams, setSearchParams, t]);

  const onConnect = async () => {
    setBusy("onboarding");
    try {
      const { url } = await createEmployeeConnectAccountLink();
      const redirect = performExternalStripeRedirect(url, "connect");
      if (!redirect.ok) {
        toast.error(t("employee.payouts.redirectFailed"));
      }
    } catch (err) {
      logClientError("EmployeePayoutAccountCard.connect", err);
      toast.error(toUserFriendlyMessage(err) || t("employee.payouts.connectFailed"));
    } finally {
      setBusy(null);
    }
  };

  const onDashboard = async () => {
    setBusy("dashboard");
    try {
      const { url } = await createEmployeeConnectLoginLink();
      const redirect = performExternalStripeRedirect(url, "expressDashboard");
      if (!redirect.ok) {
        toast.error(t("employee.payouts.redirectFailed"));
      }
    } catch (err) {
      logClientError("EmployeePayoutAccountCard.dashboard", err);
      toast.error(toUserFriendlyMessage(err) || t("employee.payouts.dashboardFailed"));
    } finally {
      setBusy(null);
    }
  };

  const state = data?.connectionState ?? "not_connected";

  return (
    <section className={employeeUi.settingsSection}>
      <h3 className={employeeUi.settingsHeading}>{t("employee.payouts.sectionTitle")}</h3>
      <p className="text-sm text-muted-foreground">{t("employee.payouts.sectionHint")}</p>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t("employee.payouts.loading")}
        </div>
      ) : error && !data ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div className={cn("rounded-xl border border-l-4 p-4 space-y-3", stateTone(state))}>
          <p className="text-sm font-semibold">
            {t(`employee.payouts.state.${state}`)}
          </p>
          <p className="text-sm opacity-90">
            {state === "connected"
              ? t("employee.payouts.connectedBody")
              : t("employee.payouts.stripeHandles")}
          </p>
          {(data?.heldPlatformCents ?? 0) > 0 ? (
            <div className="rounded-lg bg-background/60 p-3 space-y-1">
              <p className="text-sm font-medium">{t("employee.payouts.heldTitle")}</p>
              <p className="text-sm">{formatEur((data?.heldPlatformCents ?? 0) / 100)}</p>
              <p className="text-xs text-muted-foreground">{t("employee.payouts.heldBody")}</p>
              <p className="text-xs text-muted-foreground">{t("employee.payouts.notStripeBalance")}</p>
            </div>
          ) : null}
          {(data?.disputedOpenCents ?? 0) > 0 ? (
            <div className="rounded-lg bg-background/60 p-3 space-y-1">
              <p className="text-sm font-medium">{t("employee.payouts.disputedOpenTitle")}</p>
              <p className="text-sm">{formatEur((data?.disputedOpenCents ?? 0) / 100)}</p>
              <p className="text-xs text-muted-foreground">{t("employee.payouts.disputedOpenBody")}</p>
              <p className="text-xs text-muted-foreground">{t("employee.payouts.notStripeBalance")}</p>
            </div>
          ) : null}
          {(data?.disputedLostCents ?? 0) > 0 ? (
            <div className="rounded-lg bg-background/60 p-3 space-y-1">
              <p className="text-sm font-medium">{t("employee.payouts.disputedLostTitle")}</p>
              <p className="text-sm">{formatEur((data?.disputedLostCents ?? 0) / 100)}</p>
              <p className="text-xs text-muted-foreground">{t("employee.payouts.disputedLostBody")}</p>
              <p className="text-xs text-muted-foreground">{t("employee.payouts.notStripeBalance")}</p>
            </div>
          ) : null}
          {(data?.destinationSettledCents ?? 0) + (data?.transferredCents ?? 0) > 0 ? (
            <div className="rounded-lg bg-background/60 p-3 space-y-1">
              <p className="text-sm font-medium">{t("employee.payouts.settledTitle")}</p>
              <p className="text-sm">
                {formatEur(((data?.destinationSettledCents ?? 0) + (data?.transferredCents ?? 0)) / 100)}
              </p>
              <p className="text-xs text-muted-foreground">{t("employee.payouts.notStripeBalance")}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void onConnect()}
              disabled={busy != null || data?.stripeConfigured === false}
            >
              {busy === "onboarding" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {data?.hasAccount
                ? t("employee.payouts.continueSetup")
                : t("employee.payouts.connectCta")}
            </Button>
            {data?.canOpenDashboard ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void onDashboard()}
                disabled={busy != null}
              >
                {busy === "dashboard" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                {t("employee.payouts.openDashboard")}
              </Button>
            ) : null}
          </div>
          {data?.stripeConfigured === false ? (
            <p className="text-xs opacity-80">{t("employee.payouts.notConfigured")}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
