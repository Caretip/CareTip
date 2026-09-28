import { Link } from "react-router";
import { useCallback, useEffect, useState } from "react";
import { useStaleExternalStripeStateReset } from "../../../../hooks/useStaleExternalStripeStateReset";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  createConnectLoginLink,
  createInstantPayout,
  getInstantPayoutEligibility,
  getMyConnectPayout,
  listMyConnectPayouts,
  type ConnectPayout,
  type InstantPayoutEligibility,
} from "../../../../lib/api";
import { businessPayoutMetricsMode } from "./businessPayoutMetricsPresentation";
import {
  formatConnectPayoutAmount,
  formatConnectPayoutDate,
  sanitizePayoutFailureDisplay,
} from "../../../../lib/connectPayoutDisplay";
import { ConnectPayoutStatusBadge } from "../../../connect/ConnectPayoutBadges";
import {
  ConnectPayoutDetailDialog,
  useConnectPayoutDetail,
} from "../../../connect/ConnectPayoutDetailDialog";
import { ListFilterLoadError } from "../../../shared/ListFilterLoadError";
import { classifyFetchError } from "../../../../lib/listFilterUx";
import { isApiAuthSessionError } from "../../../../lib/apiError";
import { logClientError } from "../../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import { performExternalStripeRedirect } from "../../../../lib/externalStripeRedirect";
import { toast } from "sonner";
import { dashboardWorkspaceUi } from "../../../dashboard/dashboardWorkspaceUi";
import { businessUi } from "../../../business/businessDashboardUi";
import { cn } from "@/lib/utils";
import { caretipBtnPrimaryCompact } from "@/lib/caretipButtonSystem";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../ui/dialog";
import { Button } from "@/components/ui/button";
import { InstantPayoutTermsCheckbox } from "../../../finance/InstantPayoutTermsCheckbox";
import {
  PayoutFinancialMetric,
  PayoutFinancialMetricStrip,
} from "../../../finance/payout/PayoutFinancialMetric";
import { PayoutDestinationCard } from "../../../finance/payout/PayoutDestinationCard";
import { PayoutInstantBreakdown } from "../../../finance/payout/PayoutInstantBreakdown";
import { PayoutWorkspacePanel } from "../../../finance/payout/PayoutWorkspacePanel";
import { BusinessBankPayoutScheduleCard } from "./BusinessBankPayoutScheduleCard";
import { payoutWorkspaceLedgerToolbar, payoutWorkspaceRoot } from "../../../finance/payout/payoutWorkspaceClasses";

const PAGE_SIZE = 20;

function payoutRefLabel(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 8) return trimmed;
  return `…${trimmed.slice(-8)}`;
}

function formatMaskedMethod(last4: string | null): string | null {
  if (!last4) return null;
  return `•••• ${last4}`;
}

/** Fee row only when Stripe net_available reported a positive platform Instant application fee. */
function hasChargedInstantFee(eligibility: InstantPayoutEligibility): boolean {
  return eligibility.feeConfigured && eligibility.platformFeeCents > 0;
}

function feeRateLabel(eligibility: InstantPayoutEligibility): string | null {
  if (!hasChargedInstantFee(eligibility)) return null;
  const bps = eligibility.displayedFeeBps;
  if (typeof bps !== "number" || !Number.isFinite(bps) || bps <= 0) return null;
  const pct = bps / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

export function ConnectPayoutsPanel({ loading: bootLoading }: { loading?: boolean }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<ConnectPayout[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ReturnType<typeof classifyFetchError>>("api");
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const resetDashboardBusy = useCallback(() => setDashboardBusy(false), []);
  useStaleExternalStripeStateReset({ onReset: resetDashboardBusy });
  const [eligibility, setEligibility] = useState<InstantPayoutEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const detail = useConnectPayoutDetail(getMyConnectPayout);

  const loadHistory = useCallback(
    async (nextSkip: number) => {
      setHistoryLoading(true);
      setError(null);
      try {
        const res = await listMyConnectPayouts({
          take: PAGE_SIZE,
          skip: nextSkip,
          q: q || undefined,
          status: statusFilter === "all" ? undefined : statusFilter,
          method: methodFilter === "all" ? undefined : methodFilter,
        });
        setItems(res.items);
        setTotal(res.total);
        setSkip(nextSkip);
      } catch (err) {
        logClientError("ConnectPayoutsPanel", err);
        setErrorKind(classifyFetchError(err));
        setError(toUserFriendlyMessage(err) || t("business.billing.payouts.loadError"));
        setItems([]);
        setTotal(0);
      } finally {
        setHistoryLoading(false);
      }
    },
    [t, q, statusFilter, methodFilter],
  );

  const loadEligibility = useCallback(async () => {
    setEligibilityLoading(true);
    try {
      const next = await getInstantPayoutEligibility();
      setEligibility(next);
    } catch (err) {
      logClientError("ConnectPayoutsPanel.instant", err);
      setEligibility(null);
    } finally {
      setEligibilityLoading(false);
    }
  }, []);

  const openStripeDashboard = useCallback(async function openStripeDashboard() {
    if (dashboardBusy) return;
    setDashboardBusy(true);
    try {
      const { url } = await createConnectLoginLink();
      const redirect = performExternalStripeRedirect(url, "expressDashboard");
      if (!redirect.ok) {
        toast.error(t("business.billing.connect.openDashboardError"));
        setDashboardBusy(false);
      }
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("business.billing.connect.openDashboardError"));
      setDashboardBusy(false);
    }
  }, [dashboardBusy, t]);

  function openInstantConfirm() {
    if (!eligibility?.eligible || payoutBusy || !termsAccepted || !eligibility.terms?.version) return;
    setIdempotencyKey(
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `ip_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
    );
    setConfirmOpen(true);
  }

  async function confirmInstantPayout() {
    const termsVersion = eligibility?.terms?.version?.trim();
    if (!idempotencyKey || payoutBusy || !eligibility?.eligible || !termsAccepted || !termsVersion) return;
    setPayoutBusy(true);
    try {
      const result = await createInstantPayout(idempotencyKey, termsVersion);
      setEligibility(result.eligibility);
      setConfirmOpen(false);
      setItems((prev) => {
        if (prev.some((row) => row.id === result.payout.id)) return prev;
        return [result.payout, ...prev];
      });
      setTotal((n) => n + 1);
      toast.success(t("business.billing.payouts.instant.success"));
      await loadHistory(0);
    } catch (err) {
      if (!isApiAuthSessionError(err)) {
        logClientError("ConnectPayoutsPanel.instantCreate", err);
      }
      toast.error(toUserFriendlyMessage(err) || t("business.billing.payouts.instant.createError"));
    } finally {
      setPayoutBusy(false);
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => setQ(qInput.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [qInput]);

  useEffect(() => {
    void loadHistory(0);
  }, [loadHistory]);

  useEffect(() => {
    void loadEligibility();
  }, [loadEligibility]);

  const locale = i18n.language;
  const showConnectedRails =
    Boolean(bootLoading) ||
    eligibilityLoading ||
    eligibility == null ||
    eligibility.connected === true;

  return (
    <div className={cn(payoutWorkspaceRoot, "space-y-5 sm:space-y-6")}>
      <BusinessPayoutMetrics
        eligibility={eligibility}
        eligibilityLoading={eligibilityLoading || Boolean(bootLoading)}
        locale={locale}
      />

      {showConnectedRails ? (
        <BusinessBankPayoutScheduleCard disabled={Boolean(bootLoading) || eligibilityLoading} />
      ) : null}

      <div className="caretip-payout-layout min-w-0 gap-4">
      <PayoutWorkspacePanel
        className="min-w-0"
        aria-labelledby="caretip-payout-history-heading"
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <h2 id="caretip-payout-history-heading" className="min-w-0 text-sm font-semibold tracking-tight sm:text-base">
            {t("business.billing.payouts.activityTitle")}
          </h2>
          <button
            type="button"
            disabled={dashboardBusy}
            aria-busy={dashboardBusy}
            aria-label={t("business.billing.payouts.viewInStripe")}
            onClick={() => void openStripeDashboard()}
            className={cn(
              "w-fit shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {dashboardBusy ? t("business.billing.connect.starting") : t("business.billing.payouts.headerDashboardCta")}
          </button>
        </div>

        <div className={cn("mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between", payoutWorkspaceLedgerToolbar())}>
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("business.stripe.payoutsWorkspace.business.search")}</span>
            <input
              type="search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder={t("business.stripe.payoutsWorkspace.business.searchPlaceholder")}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="flex min-w-0 flex-wrap gap-2">
            <label className="min-w-0 flex-1 sm:flex-none">
              <span className="sr-only">{t("business.billing.payouts.colStatus")}</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm sm:w-44"
              >
                <option value="all">{t("business.stripe.payoutsWorkspace.business.filterAllStatus")}</option>
                <option value="pending">{t("business.billing.payouts.status.pending")}</option>
                <option value="in_transit">{t("business.billing.payouts.status.in_transit")}</option>
                <option value="paid">{t("business.billing.payouts.status.paid")}</option>
                <option value="failed">{t("business.billing.payouts.status.failed")}</option>
                <option value="canceled">{t("business.billing.payouts.status.canceled")}</option>
              </select>
            </label>
            <label className="min-w-0 flex-1 sm:flex-none">
              <span className="sr-only">{t("business.billing.payouts.colMethod")}</span>
              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm sm:w-40"
              >
                <option value="all">{t("business.stripe.payoutsWorkspace.business.filterAllMethod")}</option>
                <option value="standard">{t("business.billing.payouts.methodStandard")}</option>
                <option value="instant">{t("business.billing.payouts.methodInstant")}</option>
              </select>
            </label>
          </div>
        </div>

        {error ? (
          <ListFilterLoadError kind={errorKind} message={error} onRetry={() => void loadHistory(skip)} />
        ) : historyLoading && items.length === 0 ? (
          <HistorySkeleton />
        ) : items.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">{t("business.billing.payouts.emptyBody")}</p>
        ) : (
          <>
            <div className={businessUi.mobileList}>
              {items.map((payout) => (
                <PayoutMobileRow
                  key={payout.id}
                  payout={payout}
                  locale={locale}
                  onOpen={() => detail.openFor(payout.id, payout)}
                />
              ))}
            </div>

            <div className={cn(businessUi.tableWrap, "caretip-payout-ledger")}>
              <table className="w-full min-w-[720px] text-left text-sm">
                <caption className="sr-only">{t("business.billing.payouts.tableCaption")}</caption>
                <thead>
                  <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2.5 pr-4 font-medium">{t("business.stripe.payoutsWorkspace.business.colPayout")}</th>
                    <th scope="col" className="py-2.5 pr-4 font-medium">{t("business.billing.payouts.colAmount")}</th>
                    <th scope="col" className="py-2.5 pr-4 font-medium">{t("business.billing.payouts.colMethod")}</th>
                    <th scope="col" className="py-2.5 pr-4 font-medium">{t("business.billing.payouts.colStatus")}</th>
                    <th scope="col" className="py-2.5 pr-4 font-medium">{t("business.billing.payouts.colArrival")}</th>
                    <th scope="col" className="py-2.5 pr-4 font-medium">{t("business.billing.payouts.colCreated")}</th>
                    <th scope="col" className="py-2.5 font-medium">{t("business.billing.payouts.colFailure")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((payout) => {
                    const issue = payoutIssueText(payout, t);
                    return (
                      <tr key={payout.id} className="border-b border-border/70 last:border-0">
                        <td className="py-3 pr-4 font-medium tabular-nums text-muted-foreground">
                          <button
                            type="button"
                            className="text-left text-foreground underline-offset-2 hover:underline"
                            onClick={() => detail.openFor(payout.id, payout)}
                          >
                            <span title={payout.id}>{payoutRefLabel(payout.id)}</span>
                            <span className="sr-only">, {t("business.billing.payouts.openDetail")}</span>
                          </button>
                        </td>
                        <td className="whitespace-nowrap py-3 pr-4 font-medium tabular-nums">
                          {formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {payout.method === "instant"
                            ? t("business.billing.payouts.methodInstant")
                            : payout.method === "standard"
                              ? t("business.billing.payouts.methodStandard")
                              : t("business.billing.payouts.methodUnknown")}
                        </td>
                        <td className="py-3 pr-4">
                          <ConnectPayoutStatusBadge status={payout.status} />
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatConnectPayoutDate(payout.arrivalDate, locale)}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatConnectPayoutDate(payout.stripeCreatedAt, locale)}
                        </td>
                        <td className={cn("py-3", issue ? "font-medium text-red-800 dark:text-red-200" : "text-muted-foreground")}>
                          {issue ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {total > PAGE_SIZE ? (
              <div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  {t("business.billing.payouts.showing", {
                    from: skip + 1,
                    to: Math.min(skip + items.length, total),
                    total,
                  })}
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={cn(dashboardWorkspaceUi.btnGhost, "h-9 min-h-9 px-3 text-sm")}
                    disabled={skip === 0 || historyLoading}
                    onClick={() => void loadHistory(Math.max(0, skip - PAGE_SIZE))}
                  >
                    {t("business.billing.payouts.prev")}
                  </button>
                  <button
                    type="button"
                    className={cn(dashboardWorkspaceUi.btnGhost, "h-9 min-h-9 px-3 text-sm")}
                    disabled={skip + PAGE_SIZE >= total || historyLoading}
                    onClick={() => void loadHistory(skip + PAGE_SIZE)}
                  >
                    {t("business.billing.payouts.next")}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </PayoutWorkspacePanel>

      <div className="caretip-payout-rail min-w-0 space-y-4">
        {showConnectedRails ? (
          <InstantBalanceSection
            bootLoading={Boolean(bootLoading)}
            eligibility={eligibility}
            loading={eligibilityLoading}
            locale={locale}
            dashboardBusy={dashboardBusy}
            payoutBusy={payoutBusy}
            termsAccepted={termsAccepted}
            onTermsAcceptedChange={setTermsAccepted}
            onRetryEligibility={() => void loadEligibility()}
            onOpenDashboard={() => void openStripeDashboard()}
            onRequestPayout={openInstantConfirm}
          />
        ) : null}
        {showConnectedRails ? (
          <BusinessPayoutDestinationSection
            eligibility={eligibility}
            dashboardBusy={dashboardBusy}
            onOpenDashboard={() => void openStripeDashboard()}
          />
        ) : null}
      </div>
      </div>

      <ConnectPayoutDetailDialog
        open={detail.open}
        onOpenChange={detail.setOpen}
        title={t("business.billing.payouts.detailTitle")}
        payout={detail.payout}
        loading={detail.loading}
        error={detail.error}
      />
      <InstantPayoutConfirmDialog
        open={confirmOpen}
        eligibility={eligibility}
        locale={locale}
        confirming={payoutBusy}
        termsAccepted={termsAccepted}
        onTermsAcceptedChange={setTermsAccepted}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirmInstantPayout()}
      />
    </div>
  );
}

function payoutIssueText(
  payout: ConnectPayout,
  t: (key: string) => string,
): string | null {
  if (payout.status === "failed") {
    return sanitizePayoutFailureDisplay(payout.failureMessage) || t("business.billing.payouts.failedFallback");
  }
  if (payout.status === "canceled") {
    return t("business.billing.payouts.canceledFallback");
  }
  return null;
}

function InstantBalanceSection({
  bootLoading,
  eligibility,
  loading,
  locale,
  dashboardBusy,
  payoutBusy,
  termsAccepted,
  onTermsAcceptedChange,
  onRetryEligibility,
  onOpenDashboard,
  onRequestPayout,
}: {
  bootLoading: boolean;
  eligibility: InstantPayoutEligibility | null;
  loading: boolean;
  locale: string;
  dashboardBusy: boolean;
  payoutBusy: boolean;
  termsAccepted: boolean;
  onTermsAcceptedChange: (next: boolean) => void;
  onRetryEligibility: () => void;
  onOpenDashboard: () => void;
  onRequestPayout: () => void;
}) {
  const { t } = useTranslation();
  const currency = eligibility?.currency || "eur";
  const showFee = eligibility ? hasChargedInstantFee(eligibility) : false;
  const receiveCents = eligibility?.instantAvailableNetCents ?? 0;
  const grossCents = eligibility?.instantAvailableGrossCents ?? receiveCents;
  const feeCents = eligibility?.platformFeeCents ?? 0;
  const last4 = eligibility?.destinationLast4 ?? null;

  if (bootLoading || loading) {
    return (
      <PayoutWorkspacePanel aria-busy={true} aria-labelledby="caretip-payout-balance-heading">
        <h2 id="caretip-payout-balance-heading" className="sr-only">
          {t("business.billing.payouts.instant.balanceEyebrow")}
        </h2>
        <div className="h-7 w-28 animate-pulse rounded-md bg-muted" />
        <div className="mt-3 h-4 w-24 animate-pulse rounded-md bg-muted" />
        <span className="sr-only">{t("business.billing.payouts.instant.checking")}</span>
      </PayoutWorkspacePanel>
    );
  }

  if (!eligibility) {
    return (
      <PayoutWorkspacePanel className="space-y-3" aria-labelledby="caretip-payout-balance-heading">
        <h2 id="caretip-payout-balance-heading" className="sr-only">
          {t("business.billing.payouts.instant.balanceEyebrow")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("business.billing.payouts.instant.loadError")}</p>
        <button type="button" onClick={onRetryEligibility} className={cn(dashboardWorkspaceUi.btnGhost, "h-10 min-h-10 px-4 text-sm")}>
          {t("business.billing.payouts.instant.retry")}
        </button>
      </PayoutWorkspacePanel>
    );
  }

  const thresholdBlocked =
    eligibility.reason === "below_minimum" || eligibility.reason === "zero_balance";

  const receiveFormatted = formatConnectPayoutAmount(receiveCents, currency, locale);
  const grossFormatted = formatConnectPayoutAmount(grossCents, currency, locale);
  const feeFormatted = formatConnectPayoutAmount(feeCents, currency, locale);

  return (
    <PayoutWorkspacePanel className="min-w-0" aria-labelledby="caretip-payout-balance-heading">
      <h2 id="caretip-payout-balance-heading" className="text-sm font-medium text-foreground">
        {t("business.billing.payouts.instant.sectionTitle")}
      </h2>
      <p className="caretip-payout-instant-amount mt-2 text-foreground">
        {receiveFormatted}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {eligibility.eligible
          ? t("business.billing.payouts.instant.youReceive")
          : t(`business.billing.payouts.instant.reason.${eligibility.reason}`)}
      </p>
      {eligibility.eligible ? (
        <>
          <PayoutInstantBreakdown
            grossLabel={t("business.stripe.payoutsWorkspace.business.gross")}
            grossValue={grossFormatted}
            feeLabel={t("business.billing.payouts.instant.fee")}
            feeValue={feeFormatted}
            netLabel={t("business.stripe.payoutsWorkspace.business.net")}
            netValue={receiveFormatted}
            showFee={showFee}
          />
          {last4 ? <p className="mt-3 text-sm text-muted-foreground">•••• {last4}</p> : null}
          {eligibility.canOpenExpressDashboard ? (
            <button
              type="button"
              disabled={dashboardBusy}
              onClick={onOpenDashboard}
              className="mt-2 text-sm font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
            >
              {t("business.billing.payouts.instant.changeMethod")}
            </button>
          ) : null}
          <div className="mt-4">
            <InstantPayoutTermsCheckbox
              checked={termsAccepted}
              onCheckedChange={onTermsAcceptedChange}
              disabled={payoutBusy}
              termsPath={eligibility.terms?.path || "/terms"}
              id="business-instant-terms"
            />
          </div>
          <button
            type="button"
            disabled={payoutBusy || !termsAccepted || !eligibility.terms?.version}
            aria-busy={payoutBusy}
            onClick={onRequestPayout}
            className={cn(caretipBtnPrimaryCompact, "mt-3 h-auto min-h-11 w-full whitespace-normal")}
          >
            {payoutBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("business.billing.payouts.instant.ctaSending")}
              </>
            ) : (
              t("business.billing.payouts.instant.ctaAmount", {
                amount: formatConnectPayoutAmount(receiveCents, currency, locale),
              })
            )}
          </button>
        </>
      ) : (
        <div className="mt-4 space-y-3">
          {thresholdBlocked && last4 ? (
            <p className="text-sm text-muted-foreground">•••• {last4}</p>
          ) : null}
          {thresholdBlocked ? (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className={cn(caretipBtnPrimaryCompact, "h-auto min-h-11 w-full whitespace-normal")}
            >
              {t("business.billing.payouts.instant.ctaAmount", {
                amount: formatConnectPayoutAmount(receiveCents, currency, locale),
              })}
            </button>
          ) : null}
          <IneligibleInstantActions
            eligibility={eligibility}
            dashboardBusy={dashboardBusy}
            onOpenDashboard={onOpenDashboard}
          />
        </div>
      )}
    </PayoutWorkspacePanel>
  );
}

function IneligibleInstantActions({
  eligibility,
  dashboardBusy,
  onOpenDashboard,
}: {
  eligibility: InstantPayoutEligibility;
  dashboardBusy: boolean;
  onOpenDashboard: () => void;
}) {
  const { t } = useTranslation();
  const reason = eligibility.reason;

  if (reason === "not_connected") {
    return (
      <Link to="/dashboard/stripe/connect" className={cn(dashboardWorkspaceUi.btnSecondary, "inline-flex h-auto min-h-10 w-full items-center justify-center whitespace-normal px-4 text-sm sm:w-auto")}>
        {t("business.billing.payouts.instant.connectCta")}
      </Link>
    );
  }

  const showDashboard =
    eligibility.canOpenExpressDashboard ||
    reason === "no_instant_destination" ||
    reason === "payouts_disabled" ||
    reason === "country_unsupported";
  if (!showDashboard) return null;

  const dashboardLabel =
    reason === "no_instant_destination"
      ? t("business.billing.payouts.instant.addDestinationCta")
      : t("business.billing.payouts.instant.openStripe");

  return (
    <button
      type="button"
      disabled={dashboardBusy}
      onClick={onOpenDashboard}
      className={cn(dashboardWorkspaceUi.btnSecondary, "h-auto min-h-10 w-full whitespace-normal px-4 text-sm sm:w-auto")}
    >
      {dashboardLabel}
    </button>
  );
}

function InstantPayoutConfirmDialog({
  open,
  eligibility,
  locale,
  confirming,
  termsAccepted,
  onTermsAcceptedChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  eligibility: InstantPayoutEligibility | null;
  locale: string;
  confirming: boolean;
  termsAccepted: boolean;
  onTermsAcceptedChange: (next: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  if (!eligibility) return null;
  const currency = eligibility.currency || "eur";
  const showFee = hasChargedInstantFee(eligibility);
  const rate = feeRateLabel(eligibility);
  const sendCents = eligibility.instantAvailableNetCents;
  const masked =
    formatMaskedMethod(eligibility.destinationLast4) ?? t("business.billing.payouts.instant.methodUnknown");

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !confirming) onCancel(); }}>
      <DialogContent className="sm:max-w-md" aria-describedby="instant-payout-confirm-desc">
        <DialogHeader>
          <DialogTitle>{t("business.billing.payouts.instant.confirmTitle")}</DialogTitle>
          <DialogDescription id="instant-payout-confirm-desc">
            {t("business.billing.payouts.instant.confirmLead")}
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-sm">
          {showFee ? (
            <div className="flex items-start justify-between gap-3">
              <dt className="min-w-0 text-muted-foreground">{t("business.stripe.payoutsWorkspace.business.gross")}</dt>
              <dd className="shrink-0 tabular-nums font-medium text-foreground">
                {formatConnectPayoutAmount(eligibility.instantAvailableGrossCents, currency, locale)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <dt className="min-w-0 text-muted-foreground">{t("business.billing.payouts.instant.confirmSending")}</dt>
            <dd className="shrink-0 text-lg font-semibold tabular-nums text-foreground">
              {formatConnectPayoutAmount(sendCents, currency, locale)}
            </dd>
          </div>
          {showFee ? (
            <div className="flex items-start justify-between gap-3">
              <dt className="min-w-0 text-muted-foreground">{t("business.billing.payouts.instant.fee")}</dt>
              <dd className="min-w-0 text-right tabular-nums font-medium text-foreground">
                {rate
                  ? t("business.billing.payouts.instant.feeWithRate", {
                      amount: formatConnectPayoutAmount(eligibility.platformFeeCents, currency, locale),
                      rate,
                    })
                  : formatConnectPayoutAmount(eligibility.platformFeeCents, currency, locale)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <dt className="min-w-0 text-muted-foreground">{t("business.billing.payouts.instant.methodLabel")}</dt>
            <dd className="min-w-0 text-right font-medium text-foreground">{masked}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="min-w-0 text-muted-foreground">{t("business.billing.payouts.instant.arrivalLabel")}</dt>
            <dd className="min-w-0 text-right text-foreground">{t("business.billing.payouts.instant.confirmArrival")}</dd>
          </div>
        </dl>
        <InstantPayoutTermsCheckbox
          checked={termsAccepted}
          onCheckedChange={onTermsAcceptedChange}
          disabled={confirming}
          termsPath={eligibility.terms?.path || "/terms"}
          id="business-instant-terms-confirm"
        />
        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={confirming}>
            {t("common.cancel")}
          </Button>
          <button
            type="button"
            className={caretipBtnPrimaryCompact}
            disabled={confirming || !eligibility.eligible || !termsAccepted}
            onClick={onConfirm}
          >
            {confirming ? t("business.billing.payouts.instant.ctaSending") : t("business.billing.payouts.instant.confirmCta")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayoutMobileRow({
  payout,
  locale,
  onOpen,
}: {
  payout: ConnectPayout;
  locale: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const issue = payoutIssueText(payout, t);
  return (
    <button type="button" onClick={onOpen} className="caretip-payout-mobile-record w-full min-w-0 text-left">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-base font-semibold tabular-nums text-foreground">
          {formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}
        </p>
        <ConnectPayoutStatusBadge className="max-w-[52%] shrink-0 text-right leading-snug" status={payout.status} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <div className="min-w-0">
          <dt className="sr-only">{t("business.billing.payouts.colCreated")}</dt>
          <dd>{formatConnectPayoutDate(payout.stripeCreatedAt, locale)}</dd>
        </div>
        <div className="min-w-0 text-right sm:text-left">
          <dt className="sr-only">{t("business.billing.payouts.colMethod")}</dt>
          <dd>
            {payout.method === "instant"
              ? t("business.billing.payouts.methodInstant")
              : payout.method === "standard"
                ? t("business.billing.payouts.methodStandard")
                : t("business.billing.payouts.methodUnknown")}
          </dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="inline font-medium text-foreground/80 after:content-[':']">
            {t("business.stripe.payoutsWorkspace.business.colPayout")}
          </dt>
          <dd className="mt-0.5 inline font-mono text-[0.6875rem] text-muted-foreground" title={payout.id}>
            {payoutRefLabel(payout.id)}
          </dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="inline font-medium text-foreground/80 after:content-[':']">
            {t("business.billing.payouts.colArrival")}
          </dt>
          <dd className="mt-0.5 inline tabular-nums">{formatConnectPayoutDate(payout.arrivalDate, locale)}</dd>
        </div>
      </dl>
      {issue ? <p className="mt-2 text-xs text-destructive">{issue}</p> : null}
    </button>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-10 animate-pulse rounded-md bg-muted" />
      <div className="h-10 animate-pulse rounded-md bg-muted" />
      <div className="h-10 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

function BusinessPayoutDestinationSection({
  eligibility,
  dashboardBusy,
  onOpenDashboard,
}: {
  eligibility: InstantPayoutEligibility | null;
  dashboardBusy: boolean;
  onOpenDashboard: () => void;
}) {
  const { t } = useTranslation();
  const last4 = eligibility?.destinationLast4 ?? null;
  const kind = eligibility?.destinationKind ?? null;
  const label =
    kind === "card"
      ? t("business.stripe.payoutsWorkspace.business.methodCard")
      : t("business.stripe.payoutsWorkspace.business.methodBank");
  const masked = last4
    ? `•••• ${last4}`
    : t("business.stripe.payoutsWorkspace.business.methodMasked");

  return (
    <PayoutWorkspacePanel aria-labelledby="business-payout-destination-heading">
      <h2 id="business-payout-destination-heading" className="text-sm font-medium text-foreground">
        {t("business.stripe.payoutsWorkspace.business.methodCardAria")}
      </h2>
      <div className="mt-3">
        <PayoutDestinationCard
          methodLabel={label}
          defaultBadgeLabel={t("business.stripe.payoutsWorkspace.business.methodDefault")}
          maskedDisplay={masked}
          ariaLabel={t("business.stripe.payoutsWorkspace.business.methodCardAria")}
          changeAction={
            eligibility?.canOpenExpressDashboard
              ? (
                  <button
                    type="button"
                    disabled={dashboardBusy}
                    onClick={onOpenDashboard}
                    className="text-sm font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {t("business.billing.payouts.instant.changeMethod")}
                  </button>
                )
              : undefined
          }
        />
      </div>
    </PayoutWorkspacePanel>
  );
}

function BusinessPayoutMetrics({
  eligibility,
  eligibilityLoading,
  locale,
}: {
  eligibility: InstantPayoutEligibility | null;
  eligibilityLoading: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const mode = businessPayoutMetricsMode({
    loading: eligibilityLoading,
    eligibility,
  });

  if (mode === "loading") {
    return (
      <PayoutFinancialMetricStrip aria-busy={true}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="caretip-payout-metric">
            <div className="h-3 w-24 animate-pulse rounded-md bg-muted" />
            <div className="mt-3 h-7 w-20 animate-pulse rounded-md bg-muted" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </PayoutFinancialMetricStrip>
    );
  }

  if (mode === "setup") {
    return (
      <PayoutWorkspacePanel
        paddingClassName="sm:p-6"
        aria-labelledby="business-payout-balance-setup-heading"
      >
        <h2 id="business-payout-balance-setup-heading" className="text-base font-semibold tracking-tight">
          {t("business.stripe.payoutsWorkspace.business.setupTitle")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-snug text-muted-foreground">
          {t("business.stripe.payoutsWorkspace.business.setupBody")}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-snug text-muted-foreground">
          {t("business.stripe.payoutsWorkspace.business.setupAfter")}
        </p>
        <Link
          to="/dashboard/stripe/connect"
          className={cn(
            caretipBtnPrimaryCompact,
            "mt-5 inline-flex h-auto min-h-11 w-full items-center justify-center whitespace-normal sm:w-auto",
          )}
        >
          {t("business.billing.payouts.instant.connectCta")}
        </Link>
      </PayoutWorkspacePanel>
    );
  }

  const currency = eligibility?.currency || "eur";
  const money = (cents: number) => formatConnectPayoutAmount(cents, currency, locale);
  const instantHidden = new Set([
    "not_connected",
    "stripe_not_configured",
    "business_closed",
    "payouts_disabled",
    "country_unsupported",
  ]);
  const balancesOk = Boolean(eligibility?.connected && eligibility.balancesRetrieved === true);
  const formatStandard = (cents: number | undefined) => {
    if (!eligibility) return t("business.stripe.payoutsWorkspace.business.balanceUnavailable");
    if (!balancesOk) return t("business.stripe.payoutsWorkspace.business.balanceUnavailable");
    return money(cents ?? 0);
  };
  const formatInstant = (cents: number | undefined) => {
    if (!eligibility) return t("business.stripe.payoutsWorkspace.business.balanceUnavailable");
    if (!balancesOk || instantHidden.has(eligibility.reason)) return "—";
    return money(cents ?? 0);
  };

  const metrics = [
    {
      label: t("business.stripe.payoutsWorkspace.business.kpiAvailable"),
      hint: t("business.stripe.payoutsWorkspace.business.kpiAvailableHint"),
      value: formatStandard(eligibility?.availableCents),
    },
    {
      label: t("business.stripe.payoutsWorkspace.business.kpiPending"),
      hint: t("business.stripe.payoutsWorkspace.business.kpiPendingHint"),
      value: formatStandard(eligibility?.pendingCents),
    },
    {
      label: t("business.stripe.payoutsWorkspace.business.kpiInstant"),
      hint: t("business.stripe.payoutsWorkspace.business.kpiInstantHint"),
      value: formatInstant(eligibility?.instantAvailableNetCents),
    },
  ] as const;

  return (
    <PayoutFinancialMetricStrip>
      {metrics.map((metric) => (
        <PayoutFinancialMetric
          key={metric.label}
          label={metric.label}
          value={metric.value}
          hint={metric.hint}
        />
      ))}
    </PayoutFinancialMetricStrip>
  );
}
