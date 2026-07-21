import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { CreditCard } from "lucide-react";
import { fetchPlatformTransactions, type GlobalTransactionRow } from "../../lib/api";
import { logClientError } from "../../lib/clientLog";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import {
  DashboardListSkeleton,
  GlobalTransactionsTableSkeleton,
} from "../../components/dashboard/DashboardSectionLoading";
import { formatEur } from "../../lib/formatEur";
import {
  PlatformPage,
  PlatformPageHeader,
  PlatformResponsiveData,
  PlatformSearchField,
} from "../../components/platform/PlatformPageChrome";
import { PlatformTransactionMobileCard } from "../../components/platform/platformAdminMobileCards";
import { platformUi } from "../../components/platform/platformDashboardUi";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListFilterLoadError } from "../../components/shared/ListFilterLoadError";
import { classifyFetchError } from "../../lib/listFilterUx";
import { setPageSessionCache } from "../../lib/pageSessionCache";

const PAGE_SIZE = 50;

/** Align with platform analytics day buckets (cross-business list has no per-row TZ). */
const PLATFORM_TX_TIMEZONE = "Europe/Berlin";

/** Locale-aware date+time — same options as PlatformRefundsPage, with platform TZ. */
function formatTransactionAt(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: PLATFORM_TX_TIMEZONE,
    });
  } catch {
    return iso;
  }
}

function payoutStatusLabel(status: string, t: TFunction) {
  const key = `admin.globalTransactionsPage.payoutStatus.${status}`;
  const label = t(key);
  return label === key ? status.replace(/_/g, " ") : label;
}

function payoutBadgeClass(status: string): string {
  if (status === "paid") {
    return "bg-success text-success-foreground dark:bg-success/80 dark:text-success-foreground";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  }
  if (status === "not_applicable") {
    return "bg-muted text-muted-foreground";
  }
  return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
}

function readPage(sp: URLSearchParams): number {
  const raw = Number(sp.get("page") ?? "0");
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

export function GlobalTransactionsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const page = readPage(searchParams);
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [items, setItems] = useState<GlobalTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorKind, setLoadErrorKind] = useState<ReturnType<typeof classifyFetchError>>("api");
  const loadGenRef = useRef(0);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q.trim()), 400);
    return () => window.clearTimeout(id);
  }, [q]);

  const setQ = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(searchParams);
      if (next.trim()) sp.set("q", next.trim());
      else sp.delete("q");
      sp.delete("page");
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setPage = useCallback(
    (next: number) => {
      const sp = new URLSearchParams(searchParams);
      if (next > 0) sp.set("page", String(next));
      else sp.delete("page");
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    setLoadError(null);
    const cacheKey = `platform:transactions:${debouncedQ || "_"}:${page}`;
    try {
      const res = await fetchPlatformTransactions({
        q: debouncedQ || undefined,
        take: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      });
      if (gen !== loadGenRef.current) return;
      setItems(res.items);
      setTotal(res.total);
      setPageSessionCache(cacheKey, { items: res.items, total: res.total });
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      logClientError("GlobalTransactionsPage", e);
      setLoadError(toUserFriendlyMessage(e));
      setLoadErrorKind(classifyFetchError(e));
      setItems([]);
      setTotal(0);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [debouncedQ, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const showTableLoading = loading;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterSummary = useMemo(() => {
    if (debouncedQ) {
      return t("admin.globalTransactionsPage.summarySearch", { total, q: debouncedQ });
    }
    return t("admin.globalTransactionsPage.summaryDefault", { total });
  }, [debouncedQ, t, total]);

  const emptyCopy = useMemo(() => {
    if (debouncedQ) {
      return {
        title: t("admin.globalTransactionsPage.emptySearch.title"),
        description: t("admin.globalTransactionsPage.emptySearch.description", { q: debouncedQ }),
      };
    }
    return { title: t("admin.globalTransactionsPage.empty") };
  }, [debouncedQ, t]);

  const footer =
    !showTableLoading && !loadError && total > 0 ? (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("admin.globalTransactionsPage.footerShowing", {
            from: page * PAGE_SIZE + 1,
            to: Math.min((page + 1) * PAGE_SIZE, total),
            total,
          })}
        </p>
        {total > PAGE_SIZE ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0 || loading}
              onClick={() => setPage(page - 1)}
              className="min-h-[40px] rounded-lg border border-border px-3 text-xs font-medium text-foreground disabled:opacity-50"
            >
              {t("admin.globalTransactionsPage.prevPage")}
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pageCount || loading}
              onClick={() => setPage(page + 1)}
              className="min-h-[40px] rounded-lg border border-border px-3 text-xs font-medium text-foreground disabled:opacity-50"
            >
              {t("admin.globalTransactionsPage.nextPage")}
            </button>
          </div>
        ) : null}
      </div>
    ) : undefined;

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={CreditCard}
        title={t("admin.globalTransactionsPage.title")}
        subtitle={t("admin.globalTransactionsPage.subtitle", {
          feePercent: items[0]?.caretipFeePercent ?? 5,
        })}
      />

      <PlatformSearchField
        value={q}
        onChange={setQ}
        placeholder={t("admin.globalTransactionsPage.searchPlaceholder")}
        ariaLabel={t("admin.globalTransactionsPage.searchAria")}
        hint={t("admin.globalTransactionsPage.hintLiveSearch")}
      />

      {!loadError && !showTableLoading ? (
        <p className="mb-3 text-sm font-medium text-foreground" role="status">
          {filterSummary}
        </p>
      ) : null}

      <PlatformResponsiveData
        footer={footer}
        mobile={
          showTableLoading ? (
            <DashboardListSkeleton rows={5} minHeightClass="min-h-[12rem]" />
          ) : loadError ? (
            <ListFilterLoadError message={loadError} kind={loadErrorKind} onRetry={() => void load()} />
          ) : items.length === 0 ? (
            <EmptyState compact title={emptyCopy.title} description={emptyCopy.description} />
          ) : (
            items.map((row) => <PlatformTransactionMobileCard key={row.id} row={row} />)
          )
        }
        desktop={
          <table className={platformUi.table}>
            <thead>
              <tr className={platformUi.tableHeadRow}>
                <th className={platformUi.tableTh}>{t("admin.globalTransactionsPage.colTransaction")}</th>
                <th className={platformUi.tableTh}>{t("admin.globalTransactionsPage.colBusiness")}</th>
                <th className={platformUi.tableTh}>{t("admin.globalTransactionsPage.colDateTime")}</th>
                <th className={`${platformUi.tableTh} text-right`}>{t("admin.globalTransactionsPage.colAmountEur")}</th>
                <th className={`${platformUi.tableTh} text-right`}>{t("admin.globalTransactionsPage.colCaretipFee")}</th>
                <th className={`${platformUi.tableTh} text-right`}>{t("admin.globalTransactionsPage.colNetToStaff")}</th>
                <th className={platformUi.tableTh}>{t("admin.globalTransactionsPage.colPayout")}</th>
              </tr>
            </thead>
            <tbody>
              {showTableLoading ? (
                <GlobalTransactionsTableSkeleton />
              ) : loadError ? (
                <tr>
                  <td colSpan={7} className="p-0">
                    <ListFilterLoadError
                      message={loadError}
                      kind={loadErrorKind}
                      onRetry={() => void load()}
                      compact
                    />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState compact title={emptyCopy.title} description={emptyCopy.description} />
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className={platformUi.tableRow}>
                    <td className={`${platformUi.tableTd} max-w-[200px] font-mono text-xs`} title={row.id}>
                      {row.id}
                      {row.stripePaymentIntentId ? (
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {row.stripePaymentIntentId}
                        </span>
                      ) : null}
                    </td>
                    <td className={platformUi.tableTd}>{row.businessName}</td>
                    <td
                      className={`${platformUi.tableTd} whitespace-nowrap text-xs tabular-nums text-muted-foreground`}
                      title={row.createdAt}
                    >
                      {formatTransactionAt(row.createdAt, i18n.language)}
                    </td>
                    <td className={`${platformUi.tableTd} text-right tabular-nums`}>{formatEur(row.amountEur)}</td>
                    <td className={`${platformUi.tableTd} text-right tabular-nums text-muted-foreground`}>
                      {row.caretipFeePercent}% ({formatEur(row.caretipFeeEur)})
                    </td>
                    <td className={`${platformUi.tableTd} text-right font-medium tabular-nums`}>
                      {formatEur(row.netToStaffEur)}
                    </td>
                    <td className={platformUi.tableTd}>
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${payoutBadgeClass(row.payoutStatus)}`}
                      >
                        {payoutStatusLabel(row.payoutStatus, t)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        }
      />
    </PlatformPage>
  );
}
