import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, Loader2 } from "lucide-react";
import {
  createConnectLoginLink,
  getMyConnectPayout,
  listMyConnectPayouts,
  type ConnectPayout,
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
import { EmptyState } from "../../../ui/EmptyState";
import { ListFilterLoadError } from "../../../shared/ListFilterLoadError";
import { classifyFetchError } from "../../../../lib/listFilterUx";
import { logClientError } from "../../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import { performExternalStripeRedirect } from "../../../../lib/externalStripeRedirect";
import { toast } from "sonner";
import { dashboardWorkspaceUi } from "../../../dashboard/dashboardWorkspaceUi";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

export function ConnectPayoutsPanel({ loading: bootLoading }: { loading?: boolean }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<ConnectPayout[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ReturnType<typeof classifyFetchError>>("api");
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const detail = useConnectPayoutDetail(getMyConnectPayout);

  const load = useCallback(
    async (nextSkip: number) => {
      setLoading(true);
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
        setLoading(false);
      }
    },
    [t],
  );

  async function openStripeDashboard() {
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
  }

  useEffect(() => {
    void load(0);
  }, [load]);

  if (bootLoading || (loading && items.length === 0 && !error)) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <span className="sr-only">{t("business.billing.payouts.loading")}</span>
      </div>
    );
  }

  if (error) {
    return <ListFilterLoadError kind={errorKind} message={error} onRetry={() => void load(skip)} />;
  }

  const toolbar = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <p className="text-sm text-muted-foreground">{t("business.billing.payouts.hint")}</p>
      <button
        type="button"
        disabled={dashboardBusy}
        aria-busy={dashboardBusy}
        onClick={() => void openStripeDashboard()}
        className={cn(
          "inline-flex h-10 w-full shrink-0 items-center justify-center rounded-md px-4 text-sm font-semibold sm:w-auto",
          "bg-foreground text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {dashboardBusy ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            {t("business.billing.connect.starting")}
          </>
        ) : (
          t("business.billing.payouts.viewInStripe")
        )}
      </button>
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        {toolbar}
        <EmptyState
          icon={<Banknote className="h-8 w-8 text-muted-foreground/60" aria-hidden />}
          title={t("business.billing.payouts.emptyTitle")}
          description={t("business.billing.payouts.emptyBody")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toolbar}

      <div className="space-y-2.5 md:hidden">
        {items.map((payout) => (
          <PayoutCard
            key={payout.id}
            payout={payout}
            locale={i18n.language}
            onOpen={() => detail.openFor(payout.id, payout)}
          />
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">{t("business.billing.payouts.tableCaption")}</caption>
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">{t("business.billing.payouts.colAmount")}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t("business.billing.payouts.colStatus")}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t("business.billing.payouts.colArrival")}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t("business.billing.payouts.colCreated")}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t("business.billing.payouts.colFailure")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((payout) => {
              const failure =
                payout.status === "failed"
                  ? sanitizePayoutFailureDisplay(payout.failureMessage) ||
                    payout.failureCode ||
                    t("business.billing.payouts.failedFallback")
                  : payout.status === "canceled"
                    ? t("business.billing.payouts.canceledFallback")
                    : null;
              return (
                <tr key={payout.id} className="border-b border-border/70 last:border-0">
                  <td className="px-4 py-3 font-medium tabular-nums">
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline"
                      onClick={() => detail.openFor(payout.id, payout)}
                    >
                      {formatConnectPayoutAmount(payout.amountCents, payout.currency, i18n.language)}
                      <span className="sr-only">, {t("business.billing.payouts.openDetail")}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <ConnectPayoutStatusBadge status={payout.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatConnectPayoutDate(payout.arrivalDate, i18n.language)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatConnectPayoutDate(payout.stripeCreatedAt, i18n.language)}
                  </td>
                  <td className={cn("px-4 py-3", failure ? "font-medium text-red-800 dark:text-red-200" : "text-muted-foreground")}>
                    {failure ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
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
              className={cn(dashboardWorkspaceUi.btnGhost, "underline-offset-2 disabled:opacity-40")}
              disabled={skip === 0 || loading}
              onClick={() => void load(Math.max(0, skip - PAGE_SIZE))}
            >
              {t("business.billing.payouts.prev")}
            </button>
            <button
              type="button"
              className={cn(dashboardWorkspaceUi.btnGhost, "underline-offset-2 disabled:opacity-40")}
              disabled={skip + PAGE_SIZE >= total || loading}
              onClick={() => void load(skip + PAGE_SIZE)}
            >
              {t("business.billing.payouts.next")}
            </button>
          </div>
        </div>
      ) : null}

      <ConnectPayoutDetailDialog
        open={detail.open}
        onOpenChange={detail.setOpen}
        title={t("business.billing.payouts.detailTitle")}
        payout={detail.payout}
        loading={detail.loading}
        error={detail.error}
      />
    </div>
  );
}

function PayoutCard({
  payout,
  locale,
  onOpen,
}: {
  payout: ConnectPayout;
  locale: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const failure =
    payout.status === "failed"
      ? sanitizePayoutFailureDisplay(payout.failureMessage) ||
        payout.failureCode ||
        t("business.billing.payouts.failedFallback")
      : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-border bg-card p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      aria-label={`${formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}, ${t("business.billing.payouts.openDetail")}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium tabular-nums">
          {formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}
        </div>
        <ConnectPayoutStatusBadge status={payout.status} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {t("business.billing.payouts.colArrival")}: {formatConnectPayoutDate(payout.arrivalDate, locale)}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {t("business.billing.payouts.colCreated")}: {formatConnectPayoutDate(payout.stripeCreatedAt, locale)}
      </div>
      {failure ? <p className="mt-2 text-xs text-destructive">{failure}</p> : null}
    </button>
  );
}
