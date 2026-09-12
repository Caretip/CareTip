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
import { EmployeePayoutMethodCard } from "./EmployeePayoutMethodCard";
import { employeeUi } from "./employeeDashboardUi";
import { caretipBtnPrimary } from "@/lib/caretipButtonSystem";
import { cn } from "@/lib/utils";
import { FinanceStatusPill } from "../finance/FinanceStatusPill";
import type { FinanceStatusTone } from "../finance/FinanceStatusDot";
import {
  employeeConnectIsBusinessDistribution,
  employeePayoutAccountBodyKey,
  employeePayoutPrimaryCta,
  employeePayoutPrimaryCtaKey,
  employeePayoutShowAccountSection,
  employeePayoutShowPrimaryStripeCta,
  employeePayoutUiPhase,
  isEmployeePayoutReady,
} from "./employeePayoutAccountPresentation";

function phaseTone(phase: ReturnType<typeof employeePayoutUiPhase>): FinanceStatusTone {
  if (phase === "ready") return "success";
  if (phase === "error") return "danger";
  if (phase === "attention" || phase === "setup_incomplete") return "warning";
  return "neutral";
}

const payoutActionClass =
  "h-auto min-h-11 w-full min-w-0 whitespace-normal px-4 py-2 text-center leading-snug sm:w-auto sm:min-w-[11rem]";

export function EmployeePayoutAccountCard(props: {
  /** Authoritative Business routing from connect status; optional until this card’s own load completes. */
  businessDistribution?: boolean;
  last4?: string | null;
  destinationKind?: "card" | "bank_account" | null;
  layout?: "stack" | "rail";
}) {
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
  const businessDistribution =
    employeeConnectIsBusinessDistribution(data) || props.businessDistribution === true;
  const bodyKey = employeePayoutAccountBodyKey(businessDistribution, phase, state);
  const showPrimaryCta = employeePayoutShowPrimaryStripeCta(businessDistribution, phase);

  if (!employeePayoutShowAccountSection(businessDistribution, phase)) {
    return null;
  }

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
          <Button
            type="button"
            variant="outline"
            className={cn(employeeUi.btnSecondary, payoutActionClass)}
            onClick={() => void reload()}
          >
            {t("employee.payouts.retry")}
          </Button>
        </div>
      ) : (
        <section
          className={cn(
            props.layout === "rail" ? "rounded-2xl border border-border/70 bg-card p-5" : "space-y-4",
          )}
          aria-labelledby="employee-payout-account-heading"
        >
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <h2 id="employee-payout-account-heading" className="min-w-0 text-base font-semibold tracking-tight">
              {t(
                businessDistribution
                  ? "employee.payouts.accountTitleCompact"
                  : props.layout === "rail"
                    ? "employee.payouts.dashboard.payoutAccount"
                    : "employee.payouts.accountTitle",
              )}
            </h2>
            {props.layout === "rail" && ready && data?.canOpenDashboard ? (
              <button
                type="button"
                className="max-w-full text-left text-sm font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                onClick={() => void onDashboard()}
                disabled={busy != null}
                data-payout-cta="dashboard"
              >
                {t("employee.payouts.dashboard.changeAccount")}
              </button>
            ) : null}
          </div>
          {props.layout === "rail" && (props.last4 || ready) ? (
            <div className="mt-4">
              <EmployeePayoutMethodCard last4={props.last4 ?? null} kind={props.destinationKind ?? null} />
            </div>
          ) : null}
          <div className={cn("space-y-3", props.layout === "rail" ? "mt-4" : "mt-2")}>
            <FinanceStatusPill
              tone={phaseTone(phase)}
              label={ready ? t("employee.payouts.connectedReady") : t(`employee.payouts.state.${state}`)}
            />
            {phase === "ready" && !businessDistribution ? (
              <p className="max-w-xl text-sm leading-snug text-muted-foreground">
                {t("employee.payouts.stripeSchedule")}
              </p>
            ) : bodyKey ? (
              <p className="max-w-xl text-sm leading-snug text-muted-foreground">{t(bodyKey)}</p>
            ) : null}
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              {props.layout === "rail" && ready && data?.canOpenDashboard ? null : ready && data?.canOpenDashboard ? (
                <Button
                  type="button"
                  className={cn(caretipBtnPrimary, payoutActionClass)}
                  onClick={() => void onDashboard()}
                  disabled={busy != null}
                  data-payout-cta="dashboard"
                >
                  {busy === "dashboard" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {t("employee.payouts.openDashboard")}
                </Button>
              ) : null}
              {showPrimaryCta && primaryCta ? (
                <Button
                  type="button"
                  variant={ready ? "outline" : "default"}
                  className={cn(ready ? employeeUi.btnSecondary : caretipBtnPrimary, payoutActionClass)}
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
                  className={cn(employeeUi.btnSecondary, payoutActionClass)}
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
            <p className="mt-3 text-xs text-muted-foreground">{t("employee.payouts.notConfigured")}</p>
          ) : null}
        </section>
      )}
    </div>
  );
}
