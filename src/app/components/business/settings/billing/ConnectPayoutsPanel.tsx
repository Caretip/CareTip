import { Link } from "react-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
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
import { useBusinessStripeHeaderActions } from "../../BusinessStripeHeaderActions";

const PAGE_SIZE = 20;

const headerActionClass = cn(
  businessUi.btnSecondary,
  "h-auto min-h-11 w-full whitespace-normal bg-white px-5 sm:w-auto",
);

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
  const headerActions = useBusinessStripeHeaderActions();
  const [items, setItems] = useState<ConnectPayout[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ReturnType<typeof classifyFetchError>>("api");
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const [eligibility, setEligibility] = useState<InstantPayoutEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const detail = useConnectPayoutDetail(getMyConnectPayout);

  const loadHistory = useCallback(
    async (nextSkip: number) => {
      setHistoryLoading(true);
      setError(null);
      try {
        const res = await listMyConnectPayouts({ take: PAGE_SIZE, skip: nextSkip });
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
    [t],
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

  const showHeaderDashboard = Boolean(eligibility?.canOpenExpressDashboard);

  useLayoutEffect(() => {
    const setActions = headerActions?.setActions;
    if (!setActions) return;
    if (!showHeaderDashboard) {
      setActions(null);
      return;
    }
    setActions(
      <Button
        type="button"
        variant="outline"
        disabled={dashboardBusy}
        aria-busy={dashboardBusy}
        onClick={() => void openStripeDashboard()}
        className={headerActionClass}
      >
        {dashboardBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {dashboardBusy ? t("business.billing.connect.starting") : t("business.billing.payouts.headerDashboardCta")}
      </Button>,
    );
    return () => setActions(null);
  }, [headerActions, showHeaderDashboard, dashboardBusy, openStripeDashboard, t]);

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
    void loadHistory(0);
    void loadEligibility();
  }, [loadHistory, loadEligibility]);

  const locale = i18n.language;

  return (
    <div className="space-y-10">
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

      <section aria-labelledby="caretip-payout-history-heading">
        <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="caretip-payout-history-heading" className={dashboardWorkspaceUi.subsectionTitle}>
              {t("business.billing.payouts.activityTitle")}
            </h2>
            <p className={cn("mt-1", dashboardWorkspaceUi.helperText)}>{t("business.billing.payouts.activityHint")}</p>
          </div>
          <button
            type="button"
            disabled={dashboardBusy}
            aria-busy={dashboardBusy}
            onClick={() => void openStripeDashboard()}
            className={cn(
              "self-start text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {dashboardBusy ? t("business.billing.connect.starting") : t("business.billing.payouts.viewInStripe")}
          </button>
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
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">{t("business.billing.payouts.tableCaption")}</caption>
                <thead>
                  <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2.5 pr-4 font-medium">{t("business.billing.payouts.colAmount")}</th>
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
                        <td className="py-3 pr-4 font-medium tabular-nums">
                          <button
                            type="button"
                            className="text-left underline-offset-2 hover:underline"
                            onClick={() => detail.openFor(payout.id, payout)}
                          >
                            {formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}
                            {payout.method === "instant" ? (
                              <span className="ml-2 text-xs font-medium text-muted-foreground">
                                {t("business.billing.payouts.methodInstant")}
                              </span>
                            ) : null}
                            <span className="sr-only">, {t("business.billing.payouts.openDetail")}</span>
                          </button>
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
  const rate = eligibility ? feeRateLabel(eligibility) : null;
  const headlineCents = eligibility
    ? showFee
      ? eligibility.instantAvailableGrossCents
      : eligibility.instantAvailableNetCents
    : 0;
  const receiveCents = eligibility?.instantAvailableNetCents ?? 0;
  const feeCents = eligibility?.platformFeeCents ?? 0;
  const masked = formatMaskedMethod(eligibility?.destinationLast4 ?? null);
  const showInstantRail =
    !eligibility ||
    eligibility.eligible ||
    eligibility.reason === "not_connected" ||
    eligibility.reason === "no_instant_destination" ||
    eligibility.reason === "payouts_disabled" ||
    eligibility.reason === "country_unsupported" ||
    eligibility.canOpenExpressDashboard;

  return (
    <section aria-labelledby="caretip-payout-balance-heading" className="border-b border-border pb-5">
      <h2 id="caretip-payout-balance-heading" className="sr-only">
        {t("business.billing.payouts.instant.balanceEyebrow")}
      </h2>

      {bootLoading || loading ? (
        <div className="mt-1 max-w-3xl space-y-6" aria-busy="true">
          <div className="space-y-3">
            <div className="h-3 w-24 animate-pulse rounded-md bg-muted" />
            <div className="h-11 w-44 max-w-full animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-28 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="h-px bg-border" />
          <div className="space-y-3">
            <div className="h-4 w-36 animate-pulse rounded-md bg-muted" />
            <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
            <div className="h-10 w-48 animate-pulse rounded-md bg-muted" />
          </div>
          <span className="sr-only">{t("business.billing.payouts.instant.checking")}</span>
        </div>
      ) : !eligibility ? (
        <div className="mt-1 max-w-xl space-y-3">
          <p className="text-sm text-muted-foreground">{t("business.billing.payouts.instant.loadError")}</p>
          <button type="button" onClick={onRetryEligibility} className={cn(dashboardWorkspaceUi.btnGhost, "h-10 min-h-10 px-4 text-sm")}>
            {t("business.billing.payouts.instant.retry")}
          </button>
        </div>
      ) : (
        <div
          className={cn(
            "mt-1 grid max-w-4xl gap-8 lg:items-start lg:gap-x-12",
            showInstantRail && "lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]",
          )}
        >
          <div className="text-center lg:self-center">
            <p className="text-xs font-medium text-muted-foreground">
              {t("business.billing.payouts.instant.balanceEyebrow")}
            </p>
            <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-foreground sm:text-4xl">
              {formatConnectPayoutAmount(headlineCents, currency, locale)}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {eligibility.eligible
                ? t("business.billing.payouts.instant.availableNow")
                : t(`business.billing.payouts.instant.reason.${eligibility.reason}`)}
            </p>
          </div>

          {showInstantRail ? (
          <div className="flex flex-col border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            <p className="text-sm font-semibold text-foreground">
              {t("business.billing.payouts.instant.sectionTitle")}
            </p>

            {eligibility.eligible ? (
              <>
                <div className="mt-4">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("business.billing.payouts.instant.youReceive")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                    {formatConnectPayoutAmount(receiveCents, currency, locale)}
                  </p>
                  <span className="sr-only">{t("business.billing.payouts.instant.youReceiveHint")}</span>
                </div>

                <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                  {masked ? (
                    <p>
                      <span className="sr-only">{t("business.billing.payouts.instant.methodLabel")}: </span>
                      {t("business.billing.payouts.instant.methodEligible", {
                        method: masked,
                        status: t("business.billing.payouts.instant.instantEligible"),
                      })}
                    </p>
                  ) : null}
                  {showFee ? (
                    <p>
                      {t("business.billing.payouts.instant.fee")}{" "}
                      <span className="tabular-nums text-foreground/80">
                        {rate
                          ? t("business.billing.payouts.instant.feeWithRate", {
                              amount: formatConnectPayoutAmount(feeCents, currency, locale),
                              rate,
                            })
                          : formatConnectPayoutAmount(feeCents, currency, locale)}
                      </span>
                    </p>
                  ) : null}
                  {eligibility.canOpenExpressDashboard ? (
                    <p>
                      <button
                        type="button"
                        disabled={dashboardBusy}
                        onClick={onOpenDashboard}
                        className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                      >
                        {t("business.billing.payouts.instant.changeMethod")}
                      </button>
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  disabled={payoutBusy}
                  aria-busy={payoutBusy}
                  onClick={onRequestPayout}
                  className={cn(
                    caretipBtnPrimaryCompact,
                    "mt-5 w-full self-end sm:mt-6 sm:w-auto",
                  )}
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
              <div className="mt-4 self-end">
                <IneligibleInstantActions
                  eligibility={eligibility}
                  dashboardBusy={dashboardBusy}
                  onOpenDashboard={onOpenDashboard}
                />
              </div>
            )}
          </div>
          ) : null}
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
  const sendCents = showFee ? eligibility.instantAvailableGrossCents : eligibility.instantAvailableNetCents;
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
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{t("business.billing.payouts.instant.confirmSending")}</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">
              {formatConnectPayoutAmount(sendCents, currency, locale)}
            </dd>
          </div>
          {showFee ? (
            <>
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
              <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
                <dt className="text-muted-foreground">{t("business.billing.payouts.instant.youReceive")}</dt>
                <dd className="text-lg font-semibold tabular-nums text-foreground">
                  {formatConnectPayoutAmount(eligibility.instantAvailableNetCents, currency, locale)}
                </dd>
              </div>
            </>
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
        <div className="font-medium tabular-nums">
          {formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}
          {payout.method === "instant" ? (
            <span className="ml-2 text-xs font-medium text-muted-foreground">
              {t("business.billing.payouts.methodInstant")}
            </span>
          ) : null}
        </div>
        <ConnectPayoutStatusBadge status={payout.status} />
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
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
