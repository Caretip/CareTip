import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Banknote } from "lucide-react";
import {
  fetchPlatformConnectPayout,
  fetchPlatformConnectPayouts,
  type PlatformConnectPayout,
} from "../../../lib/api";
import { logClientError } from "../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";
import { GlobalTransactionsTableSkeleton } from "../../../components/dashboard/DashboardSectionLoading";
import {
  formatConnectPayoutAmount,
  formatConnectPayoutDate,
  reconExplainI18nKey,
  sanitizePayoutFailureDisplay,
} from "../../../lib/connectPayoutDisplay";
import {
  ConnectPayoutReconBadge,
  ConnectPayoutStatusBadge,
} from "../../../components/connect/ConnectPayoutBadges";
import {
  ConnectPayoutDetailDialog,
  useConnectPayoutDetail,
} from "../../../components/connect/ConnectPayoutDetailDialog";
import {
  PlatformPage,
  PlatformPageHeader,
  PlatformResponsiveData,
  PlatformSearchField,
} from "../../../components/platform/PlatformPageChrome";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ListFilterLoadError } from "../../../components/shared/ListFilterLoadError";
import { classifyFetchError } from "../../../lib/listFilterUx";
import { platformUi } from "../../../components/platform/platformDashboardUi";

const PAGE_SIZE = 50;
const FILTER_SELECT =
  "min-h-[40px] w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground sm:w-auto";

function readPage(sp: URLSearchParams): number {
  const raw = Number(sp.get("page") ?? "0");
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function dateToStartIso(date: string): string | undefined {
  const trimmed = date.trim();
  if (!trimmed) return undefined;
  const d = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function dateToEndIso(date: string): string | undefined {
  const trimmed = date.trim();
  if (!trimmed) return undefined;
  const d = new Date(`${trimmed}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function PlatformConnectPayoutsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "all";
  const recon = searchParams.get("recon") ?? "all";
  const currency = searchParams.get("currency") ?? "all";
  const createdFrom = searchParams.get("from") ?? "";
  const createdTo = searchParams.get("to") ?? "";
  const businessId = searchParams.get("businessId") ?? "";
  const page = readPage(searchParams);
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [items, setItems] = useState<PlatformConnectPayout[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorKind, setLoadErrorKind] = useState<ReturnType<typeof classifyFetchError>>("api");
  const loadGenRef = useRef(0);
  const detail = useConnectPayoutDetail(fetchPlatformConnectPayout);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q.trim()), 400);
    return () => window.clearTimeout(id);
  }, [q]);

  const patchParams = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(searchParams);
      mutate(sp);
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setQ = useCallback(
    (next: string) => {
      patchParams((sp) => {
        if (next.trim()) sp.set("q", next.trim());
        else sp.delete("q");
        sp.delete("page");
      });
    },
    [patchParams],
  );

  const setPage = useCallback(
    (next: number) => {
      patchParams((sp) => {
        if (next > 0) sp.set("page", String(next));
        else sp.delete("page");
      });
    },
    [patchParams],
  );

  const setFilter = useCallback(
    (key: string, next: string, emptyValue = "all") => {
      patchParams((sp) => {
        if (next && next !== emptyValue) sp.set(key, next);
        else sp.delete(key);
        sp.delete("page");
      });
    },
    [patchParams],
  );

  const clearBusinessFilter = useCallback(() => {
    patchParams((sp) => {
      sp.delete("businessId");
      sp.delete("page");
    });
  }, [patchParams]);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchPlatformConnectPayouts({
        q: debouncedQ || undefined,
        status: status !== "all" ? status : undefined,
        reconciliationStatus: recon !== "all" ? recon : undefined,
        currency: currency !== "all" ? currency : undefined,
        createdFrom: dateToStartIso(createdFrom),
        createdTo: dateToEndIso(createdTo),
        businessId: businessId.trim() || undefined,
        take: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      });
      if (gen !== loadGenRef.current) return;
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      logClientError("PlatformConnectPayoutsPage", e);
      setLoadError(toUserFriendlyMessage(e));
      setLoadErrorKind(classifyFetchError(e));
      setItems([]);
      setTotal(0);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [debouncedQ, status, recon, currency, createdFrom, createdTo, businessId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Banknote}
        title={t("admin.connectPayoutsPage.title")}
        subtitle={t("admin.connectPayoutsPage.subtitle")}
      />
      <div className="mb-4 flex flex-col gap-3">
        <PlatformSearchField
          value={q}
          onChange={setQ}
          placeholder={t("admin.connectPayoutsPage.searchPlaceholder")}
          ariaLabel={t("admin.connectPayoutsPage.searchAria")}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="text-sm text-muted-foreground">
            <span className="mb-1 block">{t("admin.connectPayoutsPage.filterStatus")}</span>
            <select
              className={FILTER_SELECT}
              value={status}
              onChange={(e) => setFilter("status", e.target.value)}
            >
              <option value="all">{t("admin.connectPayoutsPage.statusFilter.all")}</option>
              <option value="pending">{t("business.billing.payouts.status.pending")}</option>
              <option value="in_transit">{t("business.billing.payouts.status.in_transit")}</option>
              <option value="paid">{t("business.billing.payouts.status.paid")}</option>
              <option value="failed">{t("business.billing.payouts.status.failed")}</option>
              <option value="canceled">{t("business.billing.payouts.status.canceled")}</option>
            </select>
          </label>
          <label className="text-sm text-muted-foreground">
            <span className="mb-1 block">{t("admin.connectPayoutsPage.filterReconciliation")}</span>
            <select
              className={FILTER_SELECT}
              value={recon}
              onChange={(e) => setFilter("recon", e.target.value)}
            >
              <option value="all">{t("admin.connectPayoutsPage.reconFilter.all")}</option>
              <option value="pending">{t("business.billing.payouts.reconciliation.pending")}</option>
              <option value="in_progress">{t("business.billing.payouts.reconciliation.in_progress")}</option>
              <option value="complete">{t("business.billing.payouts.reconciliation.complete")}</option>
              <option value="partial">{t("business.billing.payouts.reconciliation.partial")}</option>
              <option value="failed">{t("business.billing.payouts.reconciliation.failed")}</option>
            </select>
          </label>
          <label className="text-sm text-muted-foreground">
            <span className="mb-1 block">{t("admin.connectPayoutsPage.filterCurrency")}</span>
            <select
              className={FILTER_SELECT}
              value={currency}
              onChange={(e) => setFilter("currency", e.target.value)}
            >
              <option value="all">{t("admin.connectPayoutsPage.currencyFilter.all")}</option>
              <option value="eur">EUR</option>
              <option value="usd">USD</option>
              <option value="gbp">GBP</option>
            </select>
          </label>
          <label className="text-sm text-muted-foreground">
            <span className="mb-1 block">{t("admin.connectPayoutsPage.filterFrom")}</span>
            <input
              type="date"
              className={FILTER_SELECT}
              value={createdFrom}
              onChange={(e) => setFilter("from", e.target.value, "")}
            />
          </label>
          <label className="text-sm text-muted-foreground">
            <span className="mb-1 block">{t("admin.connectPayoutsPage.filterTo")}</span>
            <input
              type="date"
              className={FILTER_SELECT}
              value={createdTo}
              onChange={(e) => setFilter("to", e.target.value, "")}
            />
          </label>
        </div>
        {businessId.trim() ? (
          <p className="text-xs text-muted-foreground">
            {t("admin.connectPayoutsPage.businessFilterActive")}{" "}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={clearBusinessFilter}
            >
              {t("admin.connectPayoutsPage.clearBusinessFilter")}
            </button>
          </p>
        ) : null}
      </div>

      {loadError ? (
        <ListFilterLoadError kind={loadErrorKind} message={loadError} onRetry={() => void load()} />
      ) : loading && items.length === 0 ? (
        <GlobalTransactionsTableSkeleton rows={8} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("admin.connectPayoutsPage.empty.title")}
          description={t("admin.connectPayoutsPage.empty.description")}
        />
      ) : (
        <PlatformResponsiveData
          mobile={
            <div className="space-y-2.5">
              {items.map((payout) => (
                <AdminPayoutCard
                  key={payout.id}
                  payout={payout}
                  locale={i18n.language}
                  onOpen={() => detail.openFor(payout.id, payout)}
                />
              ))}
            </div>
          }
          desktop={
            <table className="w-full min-w-[800px] text-left text-sm">
              <caption className="sr-only">{t("admin.connectPayoutsPage.title")}</caption>
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t("admin.connectPayoutsPage.colBusiness")}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t("admin.connectPayoutsPage.colAmount")}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t("admin.connectPayoutsPage.colStatus")}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t("admin.connectPayoutsPage.colArrival")}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t("admin.connectPayoutsPage.colCreated")}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t("admin.connectPayoutsPage.colReconciliation")}
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {t("admin.connectPayoutsPage.colFailure")}
                  </th>
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
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() => detail.openFor(payout.id, payout)}
                        >
                          <span className="font-medium">{payout.businessName}</span>
                          <span className="sr-only"> — {t("business.billing.payouts.openDetail")}</span>
                        </button>
                        {payout.stripeAccountSuffix ? (
                          <div className="text-xs text-muted-foreground">…{payout.stripeAccountSuffix}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums">
                        {formatConnectPayoutAmount(payout.amountCents, payout.currency, i18n.language)}
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
                      <td className="px-4 py-3">
                        <ConnectPayoutReconBadge
                          status={payout.reconciliationStatus}
                          lineCount={payout.balanceLineCount}
                        />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{failure ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{t("admin.connectPayoutsPage.footerShowing", { from, to, total })}</span>
              {total > PAGE_SIZE ? (
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="min-h-[40px] disabled:opacity-40"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    {t("admin.connectPayoutsPage.prevPage")}
                  </button>
                  <button
                    type="button"
                    className="min-h-[40px] disabled:opacity-40"
                    disabled={to >= total}
                    onClick={() => setPage(page + 1)}
                  >
                    {t("admin.connectPayoutsPage.nextPage")}
                  </button>
                </div>
              ) : null}
            </div>
          }
        />
      )}

      <ConnectPayoutDetailDialog
        open={detail.open}
        onOpenChange={detail.setOpen}
        title={t("business.billing.payouts.detailTitle")}
        payout={detail.payout}
        loading={detail.loading}
        error={detail.error}
        showBusiness
      />
    </PlatformPage>
  );
}

function AdminPayoutCard({
  payout,
  locale,
  onOpen,
}: {
  payout: PlatformConnectPayout;
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
    <button type="button" onClick={onOpen} className={`${platformUi.mobileCard} w-full text-left`}>
      <div className="font-medium">{payout.businessName}</div>
      <div className="mt-1 tabular-nums">
        {formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <ConnectPayoutStatusBadge status={payout.status} />
        <ConnectPayoutReconBadge status={payout.reconciliationStatus} lineCount={payout.balanceLineCount} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t(reconExplainI18nKey(payout.reconciliationStatus))}</p>
      {failure ? <p className="mt-2 text-xs text-muted-foreground">{failure}</p> : null}
    </button>
  );
}
