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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  payout: ConnectPayout | PlatformConnectPayout | null;
  loading: boolean;
  error: string | null;
  showBusiness?: boolean;
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
              <DetailRow label={t("admin.connectPayoutsPage.colBusiness")}>
                <span className="font-medium">{admin.businessName}</span>
                {admin.stripeAccountSuffix ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    …{admin.stripeAccountSuffix}
                  </span>
                ) : null}
              </DetailRow>
            ) : null}
            <DetailRow label={t("business.billing.payouts.colAmount")}>
              <span className="font-medium tabular-nums">
                {formatConnectPayoutAmount(payout.amountCents, payout.currency, i18n.language)}
              </span>
            </DetailRow>
            <DetailRow label={t("business.billing.payouts.colStatus")}>
              <ConnectPayoutStatusBadge status={payout.status} />
            </DetailRow>
            <DetailRow label={t("business.billing.payouts.colCreated")}>
              {formatConnectPayoutDate(payout.stripeCreatedAt, i18n.language)}
            </DetailRow>
            <DetailRow label={t("business.billing.payouts.colArrival")}>
              {formatConnectPayoutDate(payout.arrivalDate, i18n.language)}
            </DetailRow>
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
              </div>
            </DetailRow>
            {payout.balanceLines && payout.balanceLines.length > 0 ? (
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
