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
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { performExternalStripeRedirect } from "../../lib/externalStripeRedirect";
import { Button } from "../ui/button";
import { FinanceStatusPill } from "../finance/FinanceStatusPill";
import type { FinanceStatusTone } from "../finance/FinanceStatusDot";
import {
  employeePayoutBodyKey,
  employeePayoutPrimaryCta,
  employeePayoutPrimaryCtaKey,
  employeePayoutUiPhase,
  isEmployeePayoutReady,
} from "./employeePayoutAccountPresentation";

function phaseTone(phase: ReturnType<typeof employeePayoutUiPhase>): FinanceStatusTone {
  if (phase === "ready") return "success";
  if (phase === "error") return "danger";
  if (phase === "attention" || phase === "setup_incomplete") return "warning";
  return "neutral";
}

const ctaClass =
  "h-auto min-h-11 w-full min-w-0 whitespace-normal px-3 py-2 text-center leading-snug sm:w-auto sm:min-w-[11rem]";

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

  const phase = employeePayoutUiPhase({ loading, error, data });
  const state = data?.connectionState ?? "not_connected";
  const ready = isEmployeePayoutReady(data);
  const primaryCta = employeePayoutPrimaryCta(phase);

  return (
    <div>
      {phase === "loading" ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t("employee.payouts.loading")}
        </div>
      ) : phase === "error" ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <p className="text-xs text-muted-foreground">{t("employee.payouts.statusErrorHint")}</p>
          <Button type="button" variant="outline" className={ctaClass} onClick={() => void reload()}>
            {t("employee.payouts.retry")}
          </Button>
        </div>
      ) : (
        <section className="space-y-4" aria-labelledby="employee-payout-account-heading">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
              <h2 id="employee-payout-account-heading" className="text-base font-semibold tracking-tight">
                {t("employee.payouts.accountTitle")}
              </h2>
              <FinanceStatusPill
                tone={phaseTone(phase)}
                label={ready ? t("employee.payouts.connectedReady") : t(`employee.payouts.state.${state}`)}
              />
              <p className="max-w-xl text-sm leading-snug text-muted-foreground">
                {phase === "ready"
                  ? t("employee.payouts.stripeSchedule")
                  : t(employeePayoutBodyKey(phase, state))}
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              {ready && data?.canOpenDashboard ? (
                <Button
                  type="button"
                  className={ctaClass}
                  onClick={() => void onDashboard()}
                  disabled={busy != null}
                  data-payout-cta="dashboard"
                >
                  {busy === "dashboard" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {t("employee.payouts.openDashboard")}
                </Button>
              ) : null}
              {primaryCta ? (
                <Button
                  type="button"
                  variant={ready ? "outline" : "default"}
                  className={ctaClass}
                  onClick={() => void onConnect()}
                  disabled={busy != null || data?.stripeConfigured === false}
                  data-payout-cta={primaryCta}
                >
                  {busy === "onboarding" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {t(employeePayoutPrimaryCtaKey(primaryCta))}
                </Button>
              ) : null}
              {!ready && data?.canOpenDashboard ? (
                <Button
                  type="button"
                  variant="outline"
                  className={ctaClass}
                  onClick={() => void onDashboard()}
                  disabled={busy != null}
                  data-payout-cta="dashboard"
                >
                  {busy === "dashboard" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {t("employee.payouts.openDashboard")}
                </Button>
              ) : null}
            </div>
          </div>
          {data?.stripeConfigured === false ? (
            <p className="text-xs text-muted-foreground">{t("employee.payouts.notConfigured")}</p>
          ) : null}
        </section>
      )}
    </div>
  );
}
