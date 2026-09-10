import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  createEmployeeInstantPayout,
  getEmployeeInstantPayoutEligibility,
  type EmployeeInstantPayoutEligibility,
} from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { logClientError } from "../../lib/clientLog";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { Button } from "../ui/button";
import { FinanceStatusPill } from "../finance/FinanceStatusPill";
import {
  employeeInstantBlockedReasonKey,
  employeeInstantCtaEnabled,
  employeeInstantFeePercentLabel,
  employeeInstantShowCta,
  employeeInstantShowEligiblePill,
  employeeInstantUiMode,
} from "./employeeInstantPayoutPresentation";

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `eip_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

const ctaClass =
  "h-auto min-h-11 w-full min-w-0 whitespace-normal px-4 py-2.5 text-center leading-snug sm:w-auto sm:min-w-[12rem]";

export function EmployeeInstantPayoutCard() {
  const { t } = useTranslation();
  const [eligibility, setEligibility] = useState<EmployeeInstantPayoutEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inFlightKey = useRef<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getEmployeeInstantPayoutEligibility();
      setEligibility(next);
    } catch (err) {
      logClientError("EmployeeInstantPayoutCard", err);
      setError(toUserFriendlyMessage(err) || t("employee.payouts.instant.loadError"));
      setEligibility(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onRequest = async () => {
    if (!eligibility?.eligible || busy || inFlightKey.current) return;
    const key = newIdempotencyKey();
    inFlightKey.current = key;
    setBusy(true);
    setSuccess(false);
    try {
      const result = await createEmployeeInstantPayout(key);
      setEligibility(result.eligibility);
      setSuccess(true);
      toast.success(t("employee.payouts.instant.success"));
    } catch (err) {
      logClientError("EmployeeInstantPayoutCard.create", err);
      toast.error(toUserFriendlyMessage(err) || t("employee.payouts.instant.failed"));
    } finally {
      inFlightKey.current = null;
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t("employee.payouts.instant.checking")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3" role="alert">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" onClick={() => void reload()}>
          {t("employee.payouts.retry")}
        </Button>
      </div>
    );
  }

  const mode = employeeInstantUiMode(eligibility);
  if (mode === "hidden" || !eligibility) {
    return null;
  }

  const net = eligibility.instantAvailableNetCents;
  const gross = eligibility.instantAvailableGrossCents;
  const availableCents = gross > 0 ? gross : net;
  const min = eligibility.minPayoutCents;
  const minLabel = formatEur(min / 100);
  const receiveLabel = formatEur(net / 100);
  const percent = employeeInstantFeePercentLabel(eligibility);
  const last4 = eligibility.destinationLast4;
  const showCta = employeeInstantShowCta(mode);
  const ctaEnabled = employeeInstantCtaEnabled(mode) && !busy;
  const thresholdId = "employee-instant-threshold";

  return (
    <div className="space-y-8">
      <section aria-labelledby="employee-available-heading">
        <h2 id="employee-available-heading" className="text-sm font-medium text-muted-foreground">
          {t("employee.payouts.availableTitle")}
        </h2>
        <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
          {formatEur(availableCents / 100)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t("employee.payouts.availableNow")}</p>
      </section>

      <section className="space-y-3" aria-labelledby="employee-instant-heading">
        <h2 id="employee-instant-heading" className="text-base font-semibold tracking-tight">
          {t("employee.payouts.instant.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("employee.payouts.instant.youReceive")}</p>
        <p className="text-2xl font-semibold tabular-nums">{receiveLabel}</p>
        <div className="flex flex-wrap items-center gap-2">
          {last4 ? <p className="text-sm text-muted-foreground">•••• {last4}</p> : null}
          {employeeInstantShowEligiblePill(mode) ? (
            <FinanceStatusPill tone="success" label={t("employee.payouts.instant.eligible")} />
          ) : null}
        </div>

        {mode === "ready" || mode === "threshold" ? (
          eligibility.feeConfigured && eligibility.platformFeeCents > 0 ? (
            <p className="text-sm text-muted-foreground">
              {percent
                ? t("employee.payouts.instant.feeDot", {
                    amount: formatEur(eligibility.platformFeeCents / 100),
                    percent,
                  })
                : t("employee.payouts.instant.feeAmountOnly", {
                    amount: formatEur(eligibility.platformFeeCents / 100),
                  })}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("employee.payouts.instant.feeUnknown")}</p>
          )
        ) : null}

        {mode === "threshold" ? (
          <p id={thresholdId} className="text-sm text-muted-foreground">
            {t("employee.payouts.instant.belowMinExplain", { amount: minLabel })}
          </p>
        ) : null}

        {mode === "blocked" ? (
          <p className="text-sm text-muted-foreground">{t(employeeInstantBlockedReasonKey(eligibility.reason))}</p>
        ) : null}

        {showCta ? (
          <Button
            type="button"
            className={ctaClass}
            onClick={() => void onRequest()}
            disabled={!ctaEnabled}
            aria-busy={busy}
            aria-describedby={mode === "threshold" ? thresholdId : undefined}
            data-instant-cta={ctaEnabled ? "enabled" : "disabled"}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy
              ? t("employee.payouts.instant.processing")
              : t("employee.payouts.instant.ctaAmount", { amount: receiveLabel })}
          </Button>
        ) : null}

        {mode === "threshold" ? (
          <p className="sr-only">{t("employee.payouts.instant.belowMinAria", { amount: minLabel })}</p>
        ) : null}

        {success ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("employee.payouts.instant.success")}
          </p>
        ) : null}
      </section>
    </div>
  );
}
