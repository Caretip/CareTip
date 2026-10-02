import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { RotateCcw, Eye, Download } from "lucide-react";
import { downloadPlatformRefundsCsv, fetchPlatformRefunds } from "../../../lib/api";
import { mapLedgerRefundRow, type RefundRecord } from "../../../lib/platformRefunds";
import { logClientError } from "../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";
import {
  DashboardListSkeleton,
  GlobalTransactionsTableSkeleton,
} from "../../../components/dashboard/DashboardSectionLoading";
import { formatEur } from "../../../lib/formatEur";
import {
  PlatformAdminStatusBadge,
  PlatformPage,
  PlatformPageHeader,
  PlatformResponsiveData,
  PlatformSearchField,
} from "../../../components/platform/PlatformPageChrome";
import {
  ledgerEventTypeLabel,
  ledgerEventTypeTone,
  ledgerReasonLabel,
  ledgerStatusLabel,
  ledgerStatusTone,
} from "../../../lib/platformRefundSemantics";
import { PlatformRefundMobileCard } from "../../../components/platform/platformAdminMobileCards";
import { platformUi } from "../../../components/platform/platformDashboardUi";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ListFilterLoadError } from "../../../components/shared/ListFilterLoadError";
import { classifyFetchError } from "../../../lib/listFilterUx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";

const PAGE_SIZE = 50;
const TABLE_COL_COUNT = 14;

function readPage(sp: URLSearchParams): number {
  const raw = Number(sp.get("page") ?? "0");
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function formatRefundDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    });
  } catch {
    return iso;
  }
}

export function PlatformRefundsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const kind = searchParams.get("kind") ?? "all";
  const status = searchParams.get("status") ?? "all";
  const page = readPage(searchParams);
  const [debouncedQ, setDebouncedQ] = useState(q);
  const [allRefunds, setAllRefunds] = useState<RefundRecord[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [ledgerAvailable, setLedgerAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorKind, setLoadErrorKind] = useState<ReturnType<typeof classifyFetchError>>("api");
  const [detail, setDetail] = useState<RefundRecord | null>(null);
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

  const setFilter = useCallback(
    (key: "kind" | "status", next: string) => {
      const sp = new URLSearchParams(searchParams);
      if (next && next !== "all") sp.set(key, next);
      else sp.delete(key);
      sp.delete("page");
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchPlatformRefunds({
        q: debouncedQ || undefined,
        kind: kind !== "all" ? kind : undefined,
        status: status !== "all" ? status : undefined,
        take: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      });
      if (gen !== loadGenRef.current) return;
      setLedgerAvailable(res.ledgerAvailable !== false);
      setServerTotal(res.total);
      setAllRefunds((res.items ?? []).map(mapLedgerRefundRow));
    } catch (e) {
      if (gen !== loadGenRef.current) return;
      logClientError("PlatformRefundsPage", e);
      setLoadError(toUserFriendlyMessage(e));
      setLoadErrorKind(classifyFetchError(e));
      setLedgerAvailable(false);
      setAllRefunds([]);
      setServerTotal(0);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [debouncedQ, kind, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = serverTotal;
  const items = allRefunds;
  const showTableLoading = loading;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filterSummary = useMemo(() => {
    if (debouncedQ) {
      return t("admin.refundsPage.summarySearch", { total, q: debouncedQ });
    }
    return t("admin.refundsPage.summaryDefault", { total });
  }, [debouncedQ, t, total]);

  const emptyCopy = useMemo(() => {
    if (!ledgerAvailable) {
      return {
        title: t("admin.refundsPage.empty.noDataTitle"),
        description: t("admin.refundsPage.empty.noDataDescription"),
      };
    }
    if (debouncedQ) {
      return {
        title: t("admin.refundsPage.emptySearch.title"),
        description: t("admin.refundsPage.emptySearch.description", { q: debouncedQ }),
      };
    }
    return {
      title: t("admin.refundsPage.empty.noDataTitle"),
      description: t("admin.refundsPage.empty.description"),
    };
  }, [debouncedQ, ledgerAvailable, t]);

  const footer =
    !showTableLoading && !loadError && total > 0 ? (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("admin.refundsPage.footerShowing", {
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
              {t("admin.refundsPage.prevPage")}
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
              {t("admin.refundsPage.nextPage")}
            </button>
          </div>
        ) : null}
      </div>
    ) : undefined;

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={RotateCcw}
        title={t("admin.revenuePages.refunds.title")}
        subtitle={t("admin.revenuePages.refunds.subtitle")}
      />

      <p className="text-xs text-muted-foreground">{t("admin.refundsPage.statusReasonNote")}</p>

      <PlatformSearchField
        value={q}
        onChange={setQ}
        placeholder={t("admin.refundsPage.searchPlaceholder")}
        ariaLabel={t("admin.refundsPage.searchAria")}
        hint={t("admin.refundsPage.hintLiveSearch")}
      />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[10rem] flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t("admin.refundsPage.filterKind")}
          <select
            className="min-h-[40px] rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            value={kind}
            onChange={(e) => setFilter("kind", e.target.value)}
          >
            <option value="all">{t("admin.refundsPage.kind.all")}</option>
            <option value="refund">{t("admin.refundsPage.kind.refund")}</option>
            <option value="chargeback">{t("admin.refundsPage.kind.chargeback")}</option>
            <option value="dispute">{t("admin.refundsPage.kind.dispute")}</option>
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t("admin.refundsPage.filterStatus")}
          <select
            className="min-h-[40px] rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            value={status}
            onChange={(e) => setFilter("status", e.target.value)}
          >
            <option value="all">{t("admin.refundsPage.statusFilter.all")}</option>
            <option value="pending">{t("admin.refundsPage.status.pending")}</option>
            <option value="succeeded">{t("admin.refundsPage.status.succeeded")}</option>
            <option value="failed">{t("admin.refundsPage.status.failed")}</option>
            <option value="needs_response">{t("admin.refundsPage.status.needs_response")}</option>
            <option value="won">{t("admin.refundsPage.status.won")}</option>
            <option value="lost">{t("admin.refundsPage.status.lost")}</option>
            <option value="canceled">{t("admin.refundsPage.status.canceled")}</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            void downloadPlatformRefundsCsv({
              q: debouncedQ || undefined,
              kind: kind !== "all" ? kind : undefined,
              status: status !== "all" ? status : undefined,
            }).catch((e) => {
              logClientError("PlatformRefundsPage.export", e);
              setLoadError(toUserFriendlyMessage(e));
            });
          }}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted/50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t("admin.refundsPage.exportCsv")}
        </button>
      </div>

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
            items.map((row) => (
              <PlatformRefundMobileCard key={row.refundId} row={row} onView={() => setDetail(row)} />
            ))
          )
        }
        desktop={
          <table className={platformUi.table}>
            <thead>
              <tr className={platformUi.tableHeadRow}>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colRefundId")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colOriginalTransaction")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colBusiness")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colCustomer")}</th>
                <th className={`${platformUi.tableTh} text-right`}>{t("admin.refundsPage.colRefundAmount")}</th>
                <th className={`${platformUi.tableTh} text-right`}>{t("admin.refundsPage.colOriginalAmount")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colType")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colStatus")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colReason")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colRequested")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colProcessed")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colProvider")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colStaff")}</th>
                <th className={platformUi.tableTh}>{t("admin.refundsPage.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {showTableLoading ? (
                <GlobalTransactionsTableSkeleton rows={8} />
              ) : loadError ? (
                <tr>
                  <td colSpan={TABLE_COL_COUNT} className="p-0">
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
                  <td colSpan={TABLE_COL_COUNT} className="p-0">
                    <EmptyState compact title={emptyCopy.title} description={emptyCopy.description} />
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.refundId} className={platformUi.tableRow}>
                    <td className={`${platformUi.tableTd} font-mono text-xs`}>{row.refundId}</td>
                    <td className={`${platformUi.tableTd} max-w-[140px] font-mono text-xs`} title={row.originalTransactionId}>
                      {row.originalTransactionId.slice(0, 8)}…
                    </td>
                    <td className={platformUi.tableTd}>{row.businessName}</td>
                    <td className={`${platformUi.tableTd} text-muted-foreground`}>{t("admin.refundsPage.anonymousCustomer")}</td>
                    <td className={`${platformUi.tableTd} text-right tabular-nums font-medium`}>
                      {formatEur(row.refundAmountEur)}
                    </td>
                    <td className={`${platformUi.tableTd} text-right tabular-nums text-muted-foreground`}>
                      {formatEur(row.originalAmountEur)}
                    </td>
                    <td className={platformUi.tableTd}>
                      <PlatformAdminStatusBadge
                        label={ledgerEventTypeLabel(row.kind, t)}
                        tone={ledgerEventTypeTone(row.kind)}
                      />
                    </td>
                    <td className={platformUi.tableTd}>
                      <span title={row.status === "lost" ? t("admin.refundsPage.statusLostHint") : undefined}>
                        <PlatformAdminStatusBadge
                          label={ledgerStatusLabel(row.status, row.kind, t)}
                          tone={ledgerStatusTone(row.status, row.kind)}
                        />
                      </span>
                    </td>
                    <td className={platformUi.tableTd}>
                      <span
                        title={
                          row.reason?.toLowerCase() === "fraudulent"
                            ? t("admin.refundsPage.reason.fraudulentHint")
                            : undefined
                        }
                      >
                        <PlatformAdminStatusBadge label={ledgerReasonLabel(row.reason, t)} tone="neutral" />
                      </span>
                    </td>
                    <td className={`${platformUi.tableTd} whitespace-nowrap text-xs text-muted-foreground`}>
                      {formatRefundDate(row.requestedAt, i18n.language)}
                    </td>
                    <td className={`${platformUi.tableTd} whitespace-nowrap text-xs text-muted-foreground`}>
                      {row.processedAt ? formatRefundDate(row.processedAt, i18n.language) : "—"}
                    </td>
                    <td className={platformUi.tableTd}>{row.paymentProvider}</td>
                    <td className={platformUi.tableTd}>{row.employeeName}</td>
                    <td className={platformUi.tableTd}>
                      <button
                        type="button"
                        onClick={() => setDetail(row)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                        {t("admin.refundsPage.view")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        }
      />

      <Dialog open={detail != null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-lg">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle>{detail.refundId}</DialogTitle>
                <DialogDescription>{t("admin.refundsPage.detailSubtitle")}</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t("admin.refundsPage.colOriginalTransaction")}</dt>
                  <dd className="mt-0.5 font-mono text-xs">{detail.originalTransactionId}</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">{t("admin.refundsPage.colBusiness")}</dt>
                    <dd className="mt-0.5">{detail.businessName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">{t("admin.refundsPage.colStaff")}</dt>
                    <dd className="mt-0.5">{detail.employeeName}</dd>
                  </div>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t("admin.refundsPage.colRefundAmount")}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{formatEur(detail.refundAmountEur)}</dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <PlatformAdminStatusBadge
                    label={ledgerEventTypeLabel(detail.kind, t)}
                    tone={ledgerEventTypeTone(detail.kind)}
                  />
                  <span title={detail.status === "lost" ? t("admin.refundsPage.statusLostHint") : undefined}>
                    <PlatformAdminStatusBadge
                      label={ledgerStatusLabel(detail.status, detail.kind, t)}
                      tone={ledgerStatusTone(detail.status, detail.kind)}
                    />
                  </span>
                  <span
                    title={
                      detail.reason?.toLowerCase() === "fraudulent"
                        ? t("admin.refundsPage.reason.fraudulentHint")
                        : undefined
                    }
                  >
                    <PlatformAdminStatusBadge label={ledgerReasonLabel(detail.reason, t)} tone="neutral" />
                  </span>
                </div>
                {detail.stripePaymentIntentId ? (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Stripe PI</dt>
                    <dd className="mt-0.5 break-all font-mono text-xs">{detail.stripePaymentIntentId}</dd>
                  </div>
                ) : null}
              </dl>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </PlatformPage>
  );
}
