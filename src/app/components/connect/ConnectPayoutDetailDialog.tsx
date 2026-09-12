import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import type { ConnectPayout, ConnectPayoutBalanceLine, PlatformConnectPayout } from "../../lib/api";
import {
  formatConnectPayoutAmount,
  formatConnectPayoutDate,
  payoutMethodI18nKey,
  reconExplainI18nKey,
  sanitizePayoutFailureDisplay,
} from "../../lib/connectPayoutDisplay";
import { ConnectPayoutReconBadge, ConnectPayoutStatusBadge } from "./ConnectPayoutBadges";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border/60 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function ConnectPayoutDetailDialog({
  open,
  onOpenChange,
  title,
  payout,
  loading,
  error,
  showBusiness,
  onRetrySync,
  retrying,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  payout: ConnectPayout | PlatformConnectPayout | null;
  loading: boolean;
  error: string | null;
  showBusiness?: boolean;
  onRetrySync?: () => void;
  retrying?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const admin = payout && "businessName" in payout ? payout : null;
  const failure =
    payout?.status === "failed"
      ? sanitizePayoutFailureDisplay(payout.failureMessage) ||
        payout.failureCode ||
        t("business.billing.payouts.failedFallback")
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        aria-describedby="connect-payout-detail-desc"
        aria-busy={loading}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription id="connect-payout-detail-desc">
            {t("business.billing.payouts.detailLead")}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("business.billing.payouts.detailLoading")}</p>
        ) : error ? (
          <p className="text-sm text-red-800 dark:text-red-200" role="alert">
            {error}
          </p>
        ) : payout ? (
          <dl>
            {showBusiness && admin ? (
              <DetailRow label={t("admin.connectPayoutsPage.colRecipient")}>
                <span className="font-medium">
                  {admin.recipientName || admin.employeeName || admin.businessName}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {admin.recipientKind === "employee"
                    ? t("admin.connectPayoutsPage.recipientEmployee")
                    : t("admin.connectPayoutsPage.recipientBusiness")}
                </span>
              </DetailRow>
            ) : null}
            {showBusiness && admin?.recipientKind === "employee" ? (
              <DetailRow label={t("admin.connectPayoutsPage.colBusiness")}>
                <span className="font-medium">{admin.businessName}</span>
              </DetailRow>
            ) : null}
            {showBusiness && admin && admin.recipientKind !== "employee" ? (
              <DetailRow label={t("admin.connectPayoutsPage.colBusiness")}>
                <span className="font-medium">{admin.businessName}</span>
              </DetailRow>
            ) : null}
            {showBusiness && admin?.movementKind ? (
              <DetailRow label={t("admin.connectPayoutsPage.colType")}>
                {t(`admin.connectPayoutsPage.movement.${admin.movementKind}`)}
              </DetailRow>
            ) : null}
            {showBusiness && admin?.source ? (
              <DetailRow label={t("admin.connectPayoutsPage.source")}>
                {admin.source === "caretip"
                  ? t("admin.connectPayoutsPage.sourceCareTip")
                  : t("admin.connectPayoutsPage.sourceStripe")}
              </DetailRow>
            ) : null}
            {showBusiness && admin?.stripeAccountSuffix ? (
              <DetailRow label={t("admin.connectPayoutsPage.stripeAccount")}>
                …{admin.stripeAccountSuffix}
              </DetailRow>
            ) : null}
            {showBusiness && admin?.stripeObjectId ? (
              <DetailRow label={t("admin.connectPayoutsPage.stripeObject")}>
                <span className="break-all font-mono text-xs">{admin.stripeObjectId}</span>
              </DetailRow>
            ) : null}
            {showBusiness && admin?.routingMode ? (
              <DetailRow label={t("admin.connectPayoutsPage.routingMode")}>
                {admin.routingMode}
              </DetailRow>
            ) : null}
            {showBusiness && admin?.chargeModel ? (
              <DetailRow label={t("admin.connectPayoutsPage.chargeModel")}>
                {admin.chargeModel}
              </DetailRow>
            ) : null}
            {showBusiness && typeof admin?.grossCents === "number" ? (
              <DetailRow label={t("admin.connectPayoutsPage.grossAmount")}>
                {formatConnectPayoutAmount(admin.grossCents, payout.currency, i18n.language)}
              </DetailRow>
            ) : null}
            {showBusiness && typeof admin?.reversedCents === "number" && admin.reversedCents > 0 ? (
              <DetailRow label={t("admin.connectPayoutsPage.reversedAmount")}>
                {formatConnectPayoutAmount(admin.reversedCents, payout.currency, i18n.language)}
              </DetailRow>
            ) : null}
            <DetailRow label={t("business.billing.payouts.colAmount")}>
              <span className="font-medium tabular-nums">
                {formatConnectPayoutAmount(payout.amountCents, payout.currency, i18n.language)}
              </span>
            </DetailRow>
            {admin?.activityKind === "caretip_transfer" ? (
              <DetailRow label={t("business.billing.payouts.colStatus")}>
                <ConnectPayoutStatusBadge status={payout.status} />
                {admin.payableStatus ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{admin.payableStatus}</span>
                ) : null}
              </DetailRow>
            ) : (
              <DetailRow label={t("business.billing.payouts.colMethod")}>
                {t(payoutMethodI18nKey(payout.method))}
              </DetailRow>
            )}
            {admin?.activityKind === "caretip_transfer" ? null : (
              <DetailRow label={t("business.billing.payouts.colStatus")}>
                <ConnectPayoutStatusBadge status={payout.status} />
              </DetailRow>
            )}
            <DetailRow label={t("business.billing.payouts.colCreated")}>
              {formatConnectPayoutDate(payout.stripeCreatedAt, i18n.language)}
            </DetailRow>
            {admin?.activityKind === "caretip_transfer" ? null : (
              <DetailRow label={t("business.billing.payouts.colArrival")}>
                {formatConnectPayoutDate(payout.arrivalDate, i18n.language)}
              </DetailRow>
            )}
            {payout.paidAt ? (
              <DetailRow label={t("business.billing.payouts.colPaid")}>
                {formatConnectPayoutDate(payout.paidAt, i18n.language)}
              </DetailRow>
            ) : null}
            {payout.failedAt ? (
              <DetailRow label={t("business.billing.payouts.colFailedAt")}>
                {formatConnectPayoutDate(payout.failedAt, i18n.language)}
              </DetailRow>
            ) : null}
            {payout.canceledAt ? (
              <DetailRow label={t("business.billing.payouts.colCanceledAt")}>
                {formatConnectPayoutDate(payout.canceledAt, i18n.language)}
              </DetailRow>
            ) : null}
            {payout.status === "failed" ? (
              <DetailRow label={t("business.billing.payouts.colFailure")}>{failure}</DetailRow>
            ) : null}
            {payout.status === "canceled" ? (
              <DetailRow label={t("business.billing.payouts.colFailure")}>
                {t("business.billing.payouts.canceledFallback")}
              </DetailRow>
            ) : null}
            <DetailRow label={t("business.billing.payouts.colReconciliation")}>
              <div className="space-y-1.5">
                <ConnectPayoutReconBadge
                  status={payout.reconciliationStatus}
                  lineCount={payout.balanceLineCount}
                />
                <p className="text-xs text-muted-foreground">
                  {t(reconExplainI18nKey(payout.reconciliationStatus))}
                </p>
                {onRetrySync &&
                admin?.canRetryReconciliation !== false &&
                payout.reconciliationStatus !== "complete" &&
                payout.reconciliationStatus !== "stripe_observed" &&
                payout.reconciliationStatus !== "ledger" ? (
                  <button
                    type="button"
                    className="mt-1 text-sm font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                    onClick={() => onRetrySync()}
                    disabled={retrying || loading}
                  >
                    {retrying
                      ? t("admin.connectPayoutsPage.retryingSync")
                      : t("admin.connectPayoutsPage.retrySync")}
                  </button>
                ) : null}
              </div>
            </DetailRow>
            {typeof payout.applicationFeeAmountCents === "number" ? (
              <DetailRow label={t("business.billing.payouts.colInstantFee")}>
                <span className="tabular-nums">
                  {formatConnectPayoutAmount(
                    payout.applicationFeeAmountCents,
                    payout.currency,
                    i18n.language,
                  )}
                </span>
              </DetailRow>
            ) : null}
            {typeof payout.instantRequestAmountCents === "number" ? (
              <DetailRow label={t("business.billing.payouts.colInstantRequest")}>
                <span className="tabular-nums">
                  {formatConnectPayoutAmount(
                    payout.instantRequestAmountCents,
                    payout.currency,
                    i18n.language,
                  )}
                </span>
              </DetailRow>
            ) : null}
            {admin?.stripeDashboardPayoutUrl || admin?.stripeDashboardAccountUrl ? (
              <DetailRow label={t("admin.connectPayoutsPage.viewInStripe")}>
                <div className="flex flex-col gap-1">
                  {admin.stripeDashboardPayoutUrl ? (
                    <a
                      href={admin.stripeDashboardPayoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {admin.activityKind === "caretip_transfer"
                        ? t("admin.connectPayoutsPage.openStripeTransfer")
                        : t("admin.connectPayoutsPage.openStripePayout")}
                    </a>
                  ) : null}
                  {admin.stripeDashboardAccountUrl ? (
                    <a
                      href={admin.stripeDashboardAccountUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {t("admin.connectPayoutsPage.openStripeAccount")}
                    </a>
                  ) : null}
                </div>
              </DetailRow>
            ) : null}
            {payout.balanceLines && payout.balanceLines.length > 0 && admin?.activityKind !== "employee_payout" && admin?.activityKind !== "caretip_transfer" ? (
              <DetailRow label={t("business.billing.payouts.colBalanceLines")}>
                <BalanceLineList lines={payout.balanceLines} locale={i18n.language} />
              </DetailRow>
            ) : null}
          </dl>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BalanceLineList({ lines, locale }: { lines: ConnectPayoutBalanceLine[]; locale: string }) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1.5">
      {lines.slice(0, 25).map((line, index) => (
        <li key={`${line.type}-${index}`} className="rounded-md border border-border/70 px-2.5 py-1.5 text-xs">
          <div className="flex justify-between gap-2">
            <span>{line.reportingCategory || line.type}</span>
            <span className="tabular-nums">
              {formatConnectPayoutAmount(line.netCents, line.currency, locale)}
            </span>
          </div>
        </li>
      ))}
      {lines.length > 25 ? (
        <li className="text-xs text-muted-foreground">{t("business.billing.payouts.balanceLinesMore")}</li>
      ) : null}
      <li className="text-xs text-muted-foreground">{t("business.billing.payouts.balanceLinesHint")}</li>
    </ul>
  );
}

export function useConnectPayoutDetail<T extends ConnectPayout>(
  load: (id: string) => Promise<T>,
): {
  open: boolean;
  payout: T | null;
  loading: boolean;
  error: string | null;
  openFor: (id: string, preview?: T | null) => void;
  setOpen: (open: boolean) => void;
} {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [payoutId, setPayoutId] = useState<string | null>(null);
  const [payout, setPayout] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !payoutId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void load(payoutId)
      .then((row) => {
        if (!cancelled) setPayout(row);
      })
      .catch((err) => {
        logClientError("ConnectPayoutDetail", err);
        if (!cancelled) setError(toUserFriendlyMessage(err) || t("business.billing.payouts.detailError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, payoutId, load, t]);

  return {
    open,
    payout,
    loading,
    error,
    openFor: (id, preview) => {
      setPayoutId(id);
      setPayout(preview ?? null);
      setError(null);
      setOpen(true);
    },
    setOpen,
  };
}
