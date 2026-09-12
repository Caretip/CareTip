import { Link } from "react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Landmark, Loader2, Wallet } from "lucide-react";
import {
  createConnectLoginLink,
  createInstantPayout,
  getInstantPayoutEligibility,
  getMyConnectPayout,
  listMyConnectPayouts,
  type ConnectPayout,
  type InstantPayoutEligibility,
} from "../../../../lib/api";
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
  const [eligibility, setEligibility] = useState<InstantPayoutEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
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
    if (!eligibility?.eligible || payoutBusy) return;
    setIdempotencyKey(
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `ip_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
    );
    setConfirmOpen(true);
  }

  async function confirmInstantPayout() {
    if (!idempotencyKey || payoutBusy || !eligibility?.eligible) return;
    setPayoutBusy(true);
    try {
      const result = await createInstantPayout(idempotencyKey);
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
      logClientError("ConnectPayoutsPanel.instantCreate", err);
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

  return (
    <div className="space-y-6">
      <BusinessPayoutMetrics
        eligibility={eligibility}
        eligibilityLoading={eligibilityLoading || Boolean(bootLoading)}
        locale={locale}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <section
        className="rounded-2xl border border-border/70 bg-card p-5"
        aria-labelledby="caretip-payout-history-heading"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="caretip-payout-history-heading" className="min-w-0 text-base font-semibold tracking-tight">
            {t("business.billing.payouts.activityTitle")}
          </h2>
          <button
            type="button"
            disabled={dashboardBusy}
            aria-busy={dashboardBusy}
            aria-label={t("business.billing.payouts.viewInStripe")}
            onClick={() => void openStripeDashboard()}
            className={cn(
              "shrink-0 whitespace-nowrap text-sm font-medium text-primary underline-offset-2 hover:underline",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {dashboardBusy ? t("business.billing.connect.starting") : t("business.billing.payouts.headerDashboardCta")}
          </button>
        </div>

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
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

            <div className={businessUi.tableWrap}>
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
                            {payoutRefLabel(payout.id)}
                            <span className="sr-only">, {t("business.billing.payouts.openDetail")}</span>
                          </button>
                        </td>
                        <td className="py-3 pr-4 font-medium tabular-nums">
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
              <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {t("business.billing.payouts.showing", {
                    from: skip + 1,
                    to: Math.min(skip + items.length, total),
                    total,
                  })}
                </span>
                <div className="flex gap-2">
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
      </section>

      <div className="space-y-4">
        <InstantBalanceSection
          bootLoading={Boolean(bootLoading)}
          eligibility={eligibility}
          loading={eligibilityLoading}
          locale={locale}
          dashboardBusy={dashboardBusy}
          payoutBusy={payoutBusy}
          onRetryEligibility={() => void loadEligibility()}
          onOpenDashboard={() => void openStripeDashboard()}
          onRequestPayout={openInstantConfirm}
        />
        <BusinessPayoutMethodCard
          last4={eligibility?.destinationLast4 ?? null}
          kind={eligibility?.destinationKind ?? null}
        />
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
      <section className="rounded-2xl border border-border/70 bg-card p-5" aria-busy="true">
        <h2 id="caretip-payout-balance-heading" className="sr-only">
          {t("business.billing.payouts.instant.balanceEyebrow")}
        </h2>
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
        <div className="mt-3 h-4 w-24 animate-pulse rounded-md bg-muted" />
        <span className="sr-only">{t("business.billing.payouts.instant.checking")}</span>
      </section>
    );
  }

  if (!eligibility) {
    return (
      <section className="rounded-2xl border border-border/70 bg-card p-5 space-y-3">
        <h2 id="caretip-payout-balance-heading" className="sr-only">
          {t("business.billing.payouts.instant.balanceEyebrow")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("business.billing.payouts.instant.loadError")}</p>
        <button type="button" onClick={onRetryEligibility} className={cn(dashboardWorkspaceUi.btnGhost, "h-10 min-h-10 px-4 text-sm")}>
          {t("business.billing.payouts.instant.retry")}
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-5" aria-labelledby="caretip-payout-balance-heading">
      <h2 id="caretip-payout-balance-heading" className="sr-only">
        {t("business.billing.payouts.instant.sectionTitle")}
      </h2>
      <p className="text-[1.75rem] font-semibold tabular-nums tracking-tight sm:text-[1.875rem]">
        {formatConnectPayoutAmount(receiveCents, currency, locale)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {eligibility.eligible
          ? t("business.billing.payouts.instant.youReceive")
          : t(`business.billing.payouts.instant.reason.${eligibility.reason}`)}
      </p>
      {eligibility.eligible ? (
        <>
          <div className="mt-4 space-y-2.5 border-t border-border/70 pt-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">{t("business.stripe.payoutsWorkspace.business.gross")}</span>
              <span className="tabular-nums">{formatConnectPayoutAmount(grossCents, currency, locale)}</span>
            </div>
            {showFee ? (
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">{t("business.billing.payouts.instant.fee")}</span>
                <span className="tabular-nums text-red-700 dark:text-red-300">
                  −{formatConnectPayoutAmount(feeCents, currency, locale)}
                </span>
              </div>
            ) : null}
            <div className="flex items-start justify-between gap-3 border-t border-border/70 pt-2.5 font-medium">
              <span>{t("business.stripe.payoutsWorkspace.business.net")}</span>
              <span className="tabular-nums">{formatConnectPayoutAmount(receiveCents, currency, locale)}</span>
            </div>
          </div>
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
          <button
            type="button"
            disabled={payoutBusy}
            aria-busy={payoutBusy}
            onClick={onRequestPayout}
            className={cn(caretipBtnPrimaryCompact, "mt-5 w-full")}
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
        <div className="mt-4">
          <IneligibleInstantActions
            eligibility={eligibility}
            dashboardBusy={dashboardBusy}
            onOpenDashboard={onOpenDashboard}
          />
        </div>
      )}
    </section>
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
      <Link to="/dashboard/stripe/connect" className={cn(dashboardWorkspaceUi.btnSecondary, "h-10 min-h-10 px-4 text-sm")}>
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
      className={cn(dashboardWorkspaceUi.btnSecondary, "h-10 min-h-10 px-4 text-sm")}
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
  onCancel,
  onConfirm,
}: {
  open: boolean;
  eligibility: InstantPayoutEligibility | null;
  locale: string;
  confirming: boolean;
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
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">{t("business.stripe.payoutsWorkspace.business.gross")}</dt>
              <dd className="tabular-nums font-medium text-foreground">
                {formatConnectPayoutAmount(eligibility.instantAvailableGrossCents, currency, locale)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{t("business.billing.payouts.instant.confirmSending")}</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">
              {formatConnectPayoutAmount(sendCents, currency, locale)}
            </dd>
          </div>
          {showFee ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">{t("business.billing.payouts.instant.fee")}</dt>
              <dd className="tabular-nums font-medium text-foreground">
                {rate
                  ? t("business.billing.payouts.instant.feeWithRate", {
                      amount: formatConnectPayoutAmount(eligibility.platformFeeCents, currency, locale),
                      rate,
                    })
                  : formatConnectPayoutAmount(eligibility.platformFeeCents, currency, locale)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{t("business.billing.payouts.instant.methodLabel")}</dt>
            <dd className="font-medium text-foreground">{masked}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{t("business.billing.payouts.instant.arrivalLabel")}</dt>
            <dd className="text-foreground">{t("business.billing.payouts.instant.confirmArrival")}</dd>
          </div>
        </dl>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={confirming}>
            {t("common.cancel")}
          </Button>
          <button
            type="button"
            className={caretipBtnPrimaryCompact}
            disabled={confirming || !eligibility.eligible}
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
    <button type="button" onClick={onOpen} className={cn(businessUi.mobileCard, "w-full text-left")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{payoutRefLabel(payout.id)}</p>
          <div className="mt-0.5 font-medium tabular-nums">
            {formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}
          </div>
        </div>
        <ConnectPayoutStatusBadge status={payout.status} />
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        {payout.method === "instant"
          ? t("business.billing.payouts.methodInstant")
          : payout.method === "standard"
            ? t("business.billing.payouts.methodStandard")
            : t("business.billing.payouts.methodUnknown")}
        {" · "}
        {t("business.billing.payouts.colArrival")}: {formatConnectPayoutDate(payout.arrivalDate, locale)}
      </div>
      {issue ? <p className="mt-1.5 text-xs text-destructive">{issue}</p> : null}
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

function BusinessPayoutMethodCard({
  last4,
  kind,
}: {
  last4: string | null;
  kind: "card" | "bank_account" | null;
}) {
  const { t } = useTranslation();
  const label =
    kind === "card"
      ? t("business.stripe.payoutsWorkspace.business.methodCard")
      : t("business.stripe.payoutsWorkspace.business.methodBank");

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#8b7cff] via-[#7b61ff] to-[#5b4ae0] p-5 text-white shadow-sm"
      aria-label={t("business.stripe.payoutsWorkspace.business.methodCardAria")}
    >
      <div className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-white/15" />
      <div className="pointer-events-none absolute -bottom-12 right-10 size-28 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm font-semibold tracking-tight">{label}</p>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide">
          {t("business.stripe.payoutsWorkspace.business.methodDefault")}
        </span>
      </div>
      <p className="relative mt-8 font-mono text-lg tracking-[0.28em]">
        {last4 ? `···· ···· ${last4}` : t("business.stripe.payoutsWorkspace.business.methodMasked")}
      </p>
    </div>
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
    if (eligibilityLoading) return "—";
    if (!eligibility) return t("business.stripe.payoutsWorkspace.business.balanceUnavailable");
    if (!eligibility.connected) return t("business.stripe.payoutsWorkspace.business.balanceNotConnected");
    if (!balancesOk) return t("business.stripe.payoutsWorkspace.business.balanceUnavailable");
    return money(cents ?? 0);
  };
  const formatInstant = (cents: number | undefined) => {
    if (eligibilityLoading) return "—";
    if (!eligibility) return t("business.stripe.payoutsWorkspace.business.balanceUnavailable");
    if (!eligibility.connected) return t("business.stripe.payoutsWorkspace.business.balanceNotConnected");
    if (!balancesOk || instantHidden.has(eligibility.reason)) return "—";
    return money(cents ?? 0);
  };

  const cards = [
    {
      icon: CalendarDays,
      label: t("business.stripe.payoutsWorkspace.business.kpiInstant"),
      hint: t("business.stripe.payoutsWorkspace.business.kpiInstantHint"),
      value: formatInstant(eligibility?.instantAvailableNetCents),
    },
    {
      icon: Wallet,
      label: t("business.stripe.payoutsWorkspace.business.kpiAvailable"),
      hint: t("business.stripe.payoutsWorkspace.business.kpiAvailableHint"),
      value: formatStandard(eligibility?.availableCents),
    },
    {
      icon: Landmark,
      label: t("business.stripe.payoutsWorkspace.business.kpiPending"),
      hint: t("business.stripe.payoutsWorkspace.business.kpiPendingHint"),
      value: formatStandard(eligibility?.pendingCents),
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-3.5">
      {cards.map((card) => (
        <section key={card.label} className="min-h-[8.25rem] rounded-2xl border border-border/70 bg-card p-4 shadow-none sm:p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <card.icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-foreground">{card.label}</h2>
              <p className="mt-3 text-[1.75rem] font-semibold tabular-nums tracking-tight text-foreground sm:text-[1.875rem]">
                {card.value}
              </p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{card.hint}</p>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
