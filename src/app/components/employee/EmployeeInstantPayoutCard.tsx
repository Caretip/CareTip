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
import { employeeUi } from "./employeeDashboardUi";
import { caretipBtnPrimary } from "@/lib/caretipButtonSystem";
import { cn } from "@/lib/utils";
import { FinanceStatusPill } from "../finance/FinanceStatusPill";
import {
  employeeInstantBlockedReasonKey,
  employeeInstantCtaEnabled,
  employeeInstantFeePercentLabel,
  employeeInstantShowCta,
  employeeInstantShowEligiblePill,
  employeeInstantUiMode,
  employeeInstantVisibleForTipRouting,
} from "./employeeInstantPayoutPresentation";

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `eip_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

const payoutActionClass =
  "h-auto min-h-11 w-full min-w-0 whitespace-normal px-4 py-2.5 text-center leading-snug sm:w-auto sm:min-w-[12rem]";

export function EmployeeInstantPayoutCard(props: {
  businessDistribution?: boolean;
  routingReady?: boolean;
  /** Compact right-rail layout used on the Payouts dashboard. */
  layout?: "stack" | "rail";
  sharedEligibility?: EmployeeInstantPayoutEligibility | null;
  sharedLoading?: boolean;
  sharedError?: string | null;
  onSharedReload?: () => Promise<void>;
  onSharedEligibilityChange?: (next: EmployeeInstantPayoutEligibility) => void;
}) {
  const { t } = useTranslation();
  const controlled = typeof props.onSharedReload === "function";
  const [localEligibility, setLocalEligibility] = useState<EmployeeInstantPayoutEligibility | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inFlightKey = useRef<string | null>(null);

  const eligibility = controlled ? (props.sharedEligibility ?? null) : localEligibility;
  const loading = controlled ? Boolean(props.sharedLoading) : localLoading;
  const error = controlled ? (props.sharedError ?? null) : localError;

  const reload = useCallback(async () => {
    if (props.onSharedReload) {
      await props.onSharedReload();
      return;
    }
    setLocalLoading(true);
    setLocalError(null);
    try {
      const next = await getEmployeeInstantPayoutEligibility();
      setLocalEligibility(next);
    } catch (err) {
      logClientError("EmployeeInstantPayoutCard", err);
      setLocalError(toUserFriendlyMessage(err) || t("employee.payouts.instant.loadError"));
      setLocalEligibility(null);
    } finally {
      setLocalLoading(false);
    }
  }, [props.onSharedReload, t]);

  useEffect(() => {
    if (controlled) return;
    void reload();
  }, [reload, controlled]);

  const onRequest = async () => {
    if (!eligibility?.eligible || busy || inFlightKey.current) return;
    const key = newIdempotencyKey();
    inFlightKey.current = key;
    setBusy(true);
    setSuccess(false);
    try {
      const result = await createEmployeeInstantPayout(key);
      if (props.onSharedEligibilityChange) {
        props.onSharedEligibilityChange(result.eligibility);
      } else {
        setLocalEligibility(result.eligibility);
      }
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

  if (props.routingReady === false) {
    return null;
  }

  if (loading) {
    if (props.businessDistribution) {
      return null;
    }
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t("employee.payouts.instant.checking")}
      </div>
    );
  }

  if (error) {
    if (props.businessDistribution) {
      return null;
    }
    return (
      <div className="space-y-3" role="alert">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" className={employeeUi.btnSecondary} onClick={() => void reload()}>
          {t("employee.payouts.retry")}
        </Button>
      </div>
    );
  }

  const mode = employeeInstantUiMode(eligibility);
  if (!eligibility || !employeeInstantVisibleForTipRouting(props.businessDistribution === true, mode)) {
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
  const rail = props.layout === "rail";
  const thresholdId = "employee-instant-threshold";

  if (rail) {
    return (
      <section
        className="rounded-2xl border border-border/70 bg-card p-5"
        aria-labelledby="employee-instant-heading"
      >
        <h2 id="employee-instant-heading" className="text-sm font-medium text-foreground">
          {t("employee.payouts.instant.title")}
        </h2>
        <p className="mt-2 text-[1.75rem] font-semibold tabular-nums tracking-tight sm:text-[1.875rem]">
          {receiveLabel}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t("employee.payouts.instant.youReceive")}</p>
        <div className="mt-4 space-y-2.5 border-t border-border/70 pt-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 text-muted-foreground">{t("employee.payouts.dashboard.gross")}</span>
            <span className="shrink-0 tabular-nums">{formatEur((gross > 0 ? gross : net) / 100)}</span>
          </div>
          {mode === "ready" || mode === "threshold" ? (
            eligibility.feeConfigured && eligibility.platformFeeCents > 0 ? (
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">
                  {percent
                    ? t("employee.payouts.dashboard.feeWithPercent", { percent })
                    : t("employee.payouts.dashboard.fee")}
                </span>
                <span className="tabular-nums text-red-700 dark:text-red-300">
                  −{formatEur(eligibility.platformFeeCents / 100)}
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("employee.payouts.instant.feeUnknown")}</p>
            )
          ) : null}
          <div className="flex items-start justify-between gap-3 border-t border-border/70 pt-2.5 font-medium">
            <span className="min-w-0">{t("employee.payouts.dashboard.net")}</span>
            <span className="shrink-0 tabular-nums">{receiveLabel}</span>
          </div>
        </div>
        {last4 ? <p className="mt-3 text-sm text-muted-foreground">•••• {last4}</p> : null}
        {employeeInstantShowEligiblePill(mode) ? (
          <div className="mt-2">
            <FinanceStatusPill tone="success" label={t("employee.payouts.instant.eligible")} />
          </div>
        ) : null}
        {mode === "threshold" ? (
          <p id={thresholdId} className="mt-3 text-sm text-muted-foreground">
            {t("employee.payouts.instant.belowMinExplain", { amount: minLabel })}
          </p>
        ) : null}
        {mode === "blocked" ? (
          <p className="mt-3 text-sm text-muted-foreground">{t(employeeInstantBlockedReasonKey(eligibility.reason))}</p>
        ) : null}
        {showCta ? (
          <Button
            type="button"
            className={cn(caretipBtnPrimary, "mt-5 h-auto min-h-11 w-full min-w-0 rounded-full px-4 py-2.5 text-center leading-snug whitespace-normal")}
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
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {t("employee.payouts.instant.success")}
          </p>
        ) : null}
      </section>
    );
  }

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
            className={cn(caretipBtnPrimary, payoutActionClass)}
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
