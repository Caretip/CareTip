import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  fetchScheduledPayoutOpsDetail,
  fetchScheduledPayoutOpsList,
  fetchScheduledPayoutOpsSummary,
  postScheduledPayoutOpsReconcile,
  postScheduledPayoutOpsRunRecovery,
  type ScheduledPayoutOpsDetail,
  type ScheduledPayoutOpsListItem,
  type ScheduledPayoutOpsSummary,
  type ScheduledPayoutOpsMutationResult,
  type ScheduledPayoutOpsType,
} from "../../../lib/api";
import { formatConnectPayoutAmount, payoutMethodI18nKey } from "../../../lib/connectPayoutDisplay";
import { formatAdminFinancialDateTime } from "../../../lib/adminFinancialTimezone";
import { logClientError } from "../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";
import {
  PlatformPage,
  PlatformPageHeader,
  PlatformResponsiveData,
  PlatformSearchField,
} from "../../../components/platform/PlatformPageChrome";
import { GlobalTransactionsTableSkeleton } from "../../../components/dashboard/DashboardSectionLoading";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ListFilterLoadError } from "../../../components/shared/ListFilterLoadError";
import { classifyFetchError } from "../../../lib/listFilterUx";
import { Button } from "../../../components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { platformUi } from "../../../components/platform/platformDashboardUi";

const PAGE_SIZE = 50;
const FILTER_SELECT =
  "min-h-[40px] w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground sm:w-auto";

function scheduledPayoutOpsActionMessage(
  res: ScheduledPayoutOpsMutationResult,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  if (res.status === "failed" && res.code === "audit_log_failed") {
    return res.ledgerMutationMayHaveOccurred
      ? t("admin.scheduledPayoutOps.actionAuditFailedMutationUncertain")
      : t("admin.scheduledPayoutOps.actionAuditFailedNoMutation");
  }
  if (res.status === "blocked") {
    return t("admin.scheduledPayoutOps.actionBlocked", { reason: res.blockedReason ?? "blocked" });
  }
  if (res.status === "inconclusive") {
    return t("admin.scheduledPayoutOps.actionReconcileInconclusive");
  }
  if (res.status === "completed" && res.outcome === "matched") {
    return t("admin.scheduledPayoutOps.actionReconcileMatched");
  }
  if (res.status === "completed" && res.outcome === "already_matched") {
    return t("admin.scheduledPayoutOps.actionReconcileAlreadyMatched");
  }
  if (res.status === "completed" && res.outcome === "no_match") {
    return t("admin.scheduledPayoutOps.actionReconcileNoMatch");
  }
  if (res.status === "completed" && res.outcome === "created") {
    return t("admin.scheduledPayoutOps.actionRecoveryCreated");
  }
  if (res.status === "completed") {
    return t("admin.scheduledPayoutOps.actionRecoveryOutcome", { outcome: res.outcome ?? res.status });
  }
  return res.message ?? res.status;
}

export function PlatformScheduledPayoutOperationsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const payoutType = searchParams.get("payoutType") ?? "all";
  const method = searchParams.get("method") ?? "all";
  const manualOnly = searchParams.get("manualOnly") === "1";
  const page = Math.max(0, Number(searchParams.get("page") ?? "0") || 0);
  const detailType = searchParams.get("detailType") as ScheduledPayoutOpsType | null;
  const detailId = searchParams.get("detailId");

  const [summary, setSummary] = useState<ScheduledPayoutOpsSummary | null>(null);
  const [items, setItems] = useState<ScheduledPayoutOpsListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorKind, setLoadErrorKind] = useState<ReturnType<typeof classifyFetchError>>("api");
  const [detail, setDetail] = useState<ScheduledPayoutOpsDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const loadGen = useRef(0);

  const patchParams = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(searchParams);
      mutate(sp);
      setSearchParams(sp, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [sum, list] = await Promise.all([
        fetchScheduledPayoutOpsSummary(),
        fetchScheduledPayoutOpsList({
          take: PAGE_SIZE,
          skip: page * PAGE_SIZE,
          q: q.trim() || undefined,
          payoutType: payoutType === "employee" || payoutType === "business" ? payoutType : undefined,
          manualOnly: manualOnly || undefined,
          method:
            method === "instant" || method === "standard" || method === "unknown" ? method : undefined,
        }),
      ]);
      if (gen !== loadGen.current) return;
      setSummary(sum);
      setItems(list.items);
      setTotal(list.total);
    } catch (err) {
      if (gen !== loadGen.current) return;
      logClientError("scheduledPayoutOps.load", err);
      setLoadError(toUserFriendlyMessage(err));
      setLoadErrorKind(classifyFetchError(err));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [page, q, payoutType, method, manualOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detailType || !detailId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setActionMessage(null);
    void fetchScheduledPayoutOpsDetail(detailType, detailId)
      .then(setDetail)
      .catch((err) => {
        logClientError("scheduledPayoutOps.detail", err);
        setDetail(null);
      })
      .finally(() => setDetailLoading(false));
  }, [detailType, detailId]);

  const openDetail = (row: ScheduledPayoutOpsListItem) => {
    patchParams((sp) => {
      sp.set("detailType", row.payoutType);
      sp.set("detailId", row.id);
    });
  };

  const closeDetail = () => {
    patchParams((sp) => {
      sp.delete("detailType");
      sp.delete("detailId");
    });
  };

  const runReconcile = async () => {
    if (!detail) return;
    setActionBusy(true);
    setActionMessage(null);
    try {
      const res = await postScheduledPayoutOpsReconcile(detail.payoutType, detail.id);
      setActionMessage(scheduledPayoutOpsActionMessage(res, t));
      await load();
      const refreshed = await fetchScheduledPayoutOpsDetail(detail.payoutType, detail.id);
      setDetail(refreshed);
    } catch (err) {
      setActionMessage(toUserFriendlyMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const runRecovery = async () => {
    if (!detail) return;
    if (!window.confirm(t("admin.scheduledPayoutOps.confirmRunRecovery"))) return;
    setActionBusy(true);
    setActionMessage(null);
    try {
      const res = await postScheduledPayoutOpsRunRecovery(detail.payoutType, detail.id);
      setActionMessage(scheduledPayoutOpsActionMessage(res, t));
      await load();
      const refreshed = await fetchScheduledPayoutOpsDetail(detail.payoutType, detail.id);
      setDetail(refreshed);
    } catch (err) {
      setActionMessage(toUserFriendlyMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const summaryCards = summary
    ? [
        { key: "failedOrBlocked", value: summary.counts.failedOrBlocked },
        { key: "reconciliationOpen", value: summary.counts.reconciliationOpen },
        { key: "retryScheduled", value: summary.counts.retryScheduled },
        { key: "retryExhausted", value: summary.counts.retryExhausted },
        { key: "submittedToStripe", value: summary.counts.submittedToStripe },
        { key: "manualInterventionRequired", value: summary.counts.manualInterventionRequired },
      ]
    : [];

  return (
    <PlatformPage>
      <PlatformPageHeader
        title={t("admin.scheduledPayoutOps.title")}
        subtitle={t("admin.scheduledPayoutOps.subtitle")}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
            {t("admin.scheduledPayoutOps.refresh")}
          </Button>
        }
      />

      {summary ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaryCards.map((card) => (
            <div
              key={card.key}
              className="rounded-lg border border-border/80 bg-card px-4 py-3 shadow-sm"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(`admin.scheduledPayoutOps.summary.${card.key}`)}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("admin.scheduledPayoutOps.summary.countHint")}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <PlatformSearchField
          value={q}
          onChange={(next) =>
            patchParams((sp) => {
              if (next.trim()) sp.set("q", next.trim());
              else sp.delete("q");
              sp.delete("page");
            })
          }
          placeholder={t("admin.scheduledPayoutOps.searchPlaceholder")}
          ariaLabel={t("admin.scheduledPayoutOps.searchPlaceholder")}
          className="sm:max-w-xs"
        />
        <select
          className={FILTER_SELECT}
          value={payoutType}
          onChange={(e) =>
            patchParams((sp) => {
              const v = e.target.value;
              if (v === "all") sp.delete("payoutType");
              else sp.set("payoutType", v);
              sp.delete("page");
            })
          }
          aria-label={t("admin.scheduledPayoutOps.filterPayoutType")}
        >
          <option value="all">{t("admin.scheduledPayoutOps.filterAllTypes")}</option>
          <option value="employee">{t("admin.scheduledPayoutOps.typeEmployee")}</option>
          <option value="business">{t("admin.scheduledPayoutOps.typeBusiness")}</option>
        </select>
        <select
          className={FILTER_SELECT}
          value={method}
          onChange={(e) =>
            patchParams((sp) => {
              const v = e.target.value;
              if (v === "all") sp.delete("method");
              else sp.set("method", v);
              sp.delete("page");
            })
          }
          aria-label={t("admin.scheduledPayoutOps.filterMethod")}
        >
          <option value="all">{t("admin.scheduledPayoutOps.filterAllMethods")}</option>
          <option value="instant">{t("business.billing.payouts.methodInstant")}</option>
          <option value="standard">{t("business.billing.payouts.methodStandard")}</option>
          <option value="unknown">{t("business.billing.payouts.methodUnknown")}</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={manualOnly}
            onChange={(e) =>
              patchParams((sp) => {
                if (e.target.checked) sp.set("manualOnly", "1");
                else sp.delete("manualOnly");
                sp.delete("page");
              })
            }
          />
          {t("admin.scheduledPayoutOps.filterManualOnly")}
        </label>
      </div>

      {loadError ? (
        <ListFilterLoadError kind={loadErrorKind} message={loadError} onRetry={() => void load()} />
      ) : loading ? (
        <GlobalTransactionsTableSkeleton />
      ) : items.length === 0 ? (
        <EmptyState title={t("admin.scheduledPayoutOps.emptyTitle")} description={t("admin.scheduledPayoutOps.emptyDesc")} />
      ) : (
        <PlatformResponsiveData
          mobile={
            <ul className="space-y-3">
              {items.map((row) => (
                <li
                  key={`${row.payoutType}:${row.id}`}
                  className="rounded-lg border border-border bg-card p-3 shadow-sm"
                >
                  <button
                    type="button"
                    className="text-left font-medium text-primary hover:underline"
                    onClick={() => openDetail(row)}
                  >
                    {row.employeeName ?? row.businessName}
                  </button>
                  <p className="mt-1 text-sm text-muted-foreground">{row.businessName}</p>
                  <p className="mt-2 text-sm tabular-nums">
                    {formatConnectPayoutAmount(row.amountCents, row.currency, i18n.language)} · {row.status}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(payoutMethodI18nKey(row.payoutMethod))} ·{" "}
                    {t(`admin.scheduledPayoutOps.type${row.payoutType === "employee" ? "Employee" : "Business"}`)} ·{" "}
                    {row.attemptCount}/{row.maxAttempts} · {formatAdminFinancialDateTime(row.updatedAt, i18n.language)}
                  </p>
                  {row.manualInterventionRequired ? (
                    <p className="mt-2 flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t("admin.scheduledPayoutOps.manualRequired")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          }
          desktop={
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className={platformUi.table}>
                <thead>
                  <tr>
                    <th>{t("admin.scheduledPayoutOps.colRecipient")}</th>
                    <th>{t("admin.scheduledPayoutOps.colBusiness")}</th>
                    <th>{t("admin.scheduledPayoutOps.colAmount")}</th>
                    <th>{t("admin.scheduledPayoutOps.colMethod")}</th>
                    <th>{t("admin.scheduledPayoutOps.colStatus")}</th>
                    <th>{t("admin.scheduledPayoutOps.colAttempts")}</th>
                    <th>{t("admin.scheduledPayoutOps.colUpdated")}</th>
                    <th aria-label={t("admin.scheduledPayoutOps.colManual")} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={`${row.payoutType}:${row.id}`}>
                      <td>
                        <button
                          type="button"
                          className="text-left font-medium text-primary hover:underline"
                          onClick={() => openDetail(row)}
                        >
                          {row.employeeName ?? row.businessName}
                        </button>
                      </td>
                      <td className="text-muted-foreground">{row.businessName}</td>
                      <td className="tabular-nums">
                        {formatConnectPayoutAmount(row.amountCents, row.currency, i18n.language)}
                      </td>
                      <td className="text-muted-foreground">{t(payoutMethodI18nKey(row.payoutMethod))}</td>
                      <td>{row.status}</td>
                      <td className="tabular-nums">{row.attemptCount}/{row.maxAttempts}</td>
                      <td className="text-muted-foreground">
                        {formatAdminFinancialDateTime(row.updatedAt, i18n.language)}
                      </td>
                      <td>
                        {row.manualInterventionRequired ? (
                          <AlertTriangle className="h-4 w-4 text-amber-600" aria-label={t("admin.scheduledPayoutOps.manualRequired")} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        />
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {t("admin.scheduledPayoutOps.pagination", {
            from: total === 0 ? 0 : page * PAGE_SIZE + 1,
            to: Math.min((page + 1) * PAGE_SIZE, total),
            total,
          })}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 0 || loading}
            onClick={() => patchParams((sp) => sp.set("page", String(page - 1)))}
          >
            {t("admin.scheduledPayoutOps.prev")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={(page + 1) * PAGE_SIZE >= total || loading}
            onClick={() => patchParams((sp) => sp.set("page", String(page + 1)))}
          >
            {t("admin.scheduledPayoutOps.next")}
          </Button>
        </div>
      </div>

      <Sheet open={Boolean(detailType && detailId)} onOpenChange={(open) => !open && closeDetail()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("admin.scheduledPayoutOps.detailTitle")}</SheetTitle>
            <SheetDescription>{t("admin.scheduledPayoutOps.detailLead")}</SheetDescription>
          </SheetHeader>
          {detailLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("admin.globalTransactionsPage.loading")}</p>
          ) : detail ? (
            <div className="mt-4 space-y-4 text-sm">
              <p className="font-medium">{detail.employeeName ?? detail.businessName}</p>
              <p className="text-muted-foreground">{detail.scheduleWindowKey}</p>
              <p>
                {formatConnectPayoutAmount(detail.amountCents, detail.currency, i18n.language)} · {detail.status}
              </p>
              <p className="text-muted-foreground">
                {t("admin.scheduledPayoutOps.colMethod")}: {t(payoutMethodI18nKey(detail.payoutMethod))}
              </p>
              {detail.blockedReason ? (
                <p className="rounded-md bg-muted px-3 py-2 text-foreground">
                  {t("admin.scheduledPayoutOps.blockedReason", { reason: detail.blockedReason })}
                </p>
              ) : null}
              {detail.failureMessageSanitized ? (
                <p className="text-muted-foreground">{detail.failureMessageSanitized}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("admin.scheduledPayoutOps.submittedNotSettlement")}</p>
              {detail.stripePayoutIdMasked ? (
                <p className="font-mono text-xs">{detail.stripePayoutIdMasked}</p>
              ) : null}
              {detail.relatedConnectPayoutAdminPath ? (
                <Link to={detail.relatedConnectPayoutAdminPath} className="text-primary underline">
                  {t("admin.scheduledPayoutOps.viewConnectPayout")}
                </Link>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("admin.scheduledPayoutOps.runbookHint")}</p>
              <div className="flex flex-wrap gap-2 pt-2">
                {detail.allowedActions.includes("reconcile") ? (
                  <Button type="button" size="sm" disabled={actionBusy} onClick={() => void runReconcile()}>
                    {t("admin.scheduledPayoutOps.actionReconcile")}
                  </Button>
                ) : null}
                {detail.allowedActions.includes("run_recovery") ? (
                  <Button type="button" size="sm" variant="secondary" disabled={actionBusy} onClick={() => void runRecovery()}>
                    {t("admin.scheduledPayoutOps.actionRunRecovery")}
                  </Button>
                ) : null}
              </div>
              {actionMessage ? <p className="text-sm text-foreground">{actionMessage}</p> : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </PlatformPage>
  );
}
