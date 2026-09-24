import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { HandCoins } from "lucide-react";
import {
  createTipDistributionBatch,
  getTipDistributionBatch,
  getTipDistributionEmployees,
  getTipDistributionHistory,
  getTipDistributionSummary,
  type TipDistributionBatchDetail,
  type TipDistributionBatchListRow,
  type TipDistributionEmployeeRow,
  type TipDistributionSummary,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { formatEur } from "../../lib/formatEur";
import { BusinessModuleWorkspaceHeader } from "../../components/business/BusinessModuleWorkspaceHeader";
import { businessUi } from "../../components/business/businessDashboardUi";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { cn } from "@/lib/utils";

function centsToEur(cents: number): string {
  return formatEur(cents / 100);
}

function formatDistributionDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function newIdempotencyKey(): string {
  return `tip-dist-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function TipDistributionPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith("de") ? "de-DE" : "en-GB";

  const [summary, setSummary] = useState<TipDistributionSummary | null>(null);
  const [employees, setEmployees] = useState<TipDistributionEmployeeRow[]>([]);
  const [history, setHistory] = useState<TipDistributionBatchListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<TipDistributionEmployeeRow | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [detailBatch, setDetailBatch] = useState<TipDistributionBatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [nextSummary, nextEmployees, nextHistory] = await Promise.all([
        getTipDistributionSummary(),
        getTipDistributionEmployees(),
        getTipDistributionHistory({ take: 20 }),
      ]);
      setSummary(nextSummary);
      setEmployees(nextEmployees.items);
      setHistory(nextHistory.items);
    } catch (err) {
      logClientError("TipDistributionPage.load", err);
      setError(toUserFriendlyMessage(err) || t("business.tipDistribution.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const isDirectToEmployee = summary?.routingMode === "direct_to_employee";
  const awaitingEmployees = useMemo(
    () => employees.filter((row) => row.remainingCents > 0 && row.employeeId),
    [employees],
  );

  const openDistribution = (row: TipDistributionEmployeeRow) => {
    setSelectedEmployee(row);
    setAmountInput((row.remainingCents / 100).toFixed(2));
    setSubmitError(null);
  };

  const closeDistribution = () => {
    if (submitting) return;
    setSelectedEmployee(null);
    setAmountInput("");
    setSubmitError(null);
  };

  const parsedAmountCents = useMemo(() => {
    const normalized = amountInput.replace(",", ".").trim();
    const value = Number(normalized);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100);
  }, [amountInput]);

  const remainingAfter = useMemo(() => {
    if (!selectedEmployee || parsedAmountCents == null) return null;
    return Math.max(0, selectedEmployee.remainingCents - parsedAmountCents);
  }, [parsedAmountCents, selectedEmployee]);

  const confirmDisabled =
    submitting ||
    !selectedEmployee?.employeeId ||
    parsedAmountCents == null ||
    parsedAmountCents <= 0 ||
    (selectedEmployee != null && parsedAmountCents > selectedEmployee.remainingCents);

  const submitDistribution = async () => {
    if (!selectedEmployee?.employeeId || parsedAmountCents == null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createTipDistributionBatch({
        idempotencyKey: newIdempotencyKey(),
        items: [{ employeeId: selectedEmployee.employeeId, amountCents: parsedAmountCents }],
      });
      closeDistribution();
      await load();
    } catch (err) {
      logClientError("TipDistributionPage.submit", err);
      setSubmitError(toUserFriendlyMessage(err) || t("business.tipDistribution.submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  const openBatchDetail = async (batchId: string) => {
    setDetailLoading(true);
    try {
      const detail = await getTipDistributionBatch(batchId);
      setDetailBatch(detail);
    } catch (err) {
      logClientError("TipDistributionPage.batchDetail", err);
      setError(toUserFriendlyMessage(err) || t("business.tipDistribution.loadError"));
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className={businessUi.modulePageShell}>
      <div className={businessUi.modulePageContained}>
        <BusinessModuleWorkspaceHeader
          personality="billing"
          badge={t("business.tipDistribution.eyebrow")}
          icon={HandCoins}
          title={t("business.tipDistribution.title")}
          subtitle={t("business.tipDistribution.subtitle")}
          hideSubtitleOnMobile
        />

        {error ? (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("business.tipDistribution.loading")}</p>
        ) : isDirectToEmployee ? (
          <section className="rounded-xl border border-border/70 bg-card p-4 sm:p-5">
            <p className="text-sm text-muted-foreground">{t("business.tipDistribution.directToEmployeeInfo")}</p>
          </section>
        ) : (
          <>
            <section className="mb-6 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-3">
              <div className={cn(businessUi.statCard, "p-4")}>
                <p className="text-xs font-medium text-muted-foreground">{t("business.tipDistribution.summary.toDistribute")}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{centsToEur(summary?.totalToDistributeCents ?? 0)}</p>
              </div>
              <div className={cn(businessUi.statCard, "p-4")}>
                <p className="text-xs font-medium text-muted-foreground">{t("business.tipDistribution.summary.employeesAwaiting")}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{summary?.employeesAwaitingCount ?? 0}</p>
              </div>
              <div className={cn(businessUi.statCard, "p-4")}>
                <p className="text-xs font-medium text-muted-foreground">{t("business.tipDistribution.summary.lastDistribution")}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {summary?.lastDistributionAt
                    ? formatDistributionDate(summary.lastDistributionAt, locale)
                    : t("business.tipDistribution.summary.noneRecorded")}
                </p>
              </div>
            </section>

            {summary?.sinceLastDistribution ? (
              <section className="mb-6 rounded-xl border border-border/70 bg-muted/20 p-4 sm:p-5">
                <h2 className="text-sm font-semibold">{t("business.tipDistribution.sinceLast.title")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("business.tipDistribution.sinceLast.body", {
                    count: summary.sinceLastDistribution.tipCount,
                    gross: centsToEur(summary.sinceLastDistribution.grossCents),
                    fees: centsToEur(summary.sinceLastDistribution.platformFeeCents),
                    net: centsToEur(summary.sinceLastDistribution.netCents),
                  })}
                </p>
              </section>
            ) : null}

            <section className="mb-8">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t("business.tipDistribution.ready.title")}</h2>
              </div>

              <div className={businessUi.tableWrap}>
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.table.employee")}</th>
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.table.gross")}</th>
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.table.fees")}</th>
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.table.netOwed")}</th>
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.table.distributed")}</th>
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.table.remaining")}</th>
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {awaitingEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-muted-foreground">
                          {t("business.tipDistribution.ready.empty")}
                        </td>
                      </tr>
                    ) : (
                      awaitingEmployees.map((row) => (
                        <tr key={row.employeeId ?? "unknown"} className="border-b border-border/50">
                          <td className="px-3 py-3 font-medium">{row.employeeName ?? t("business.tipDistribution.unassignedEmployee")}</td>
                          <td className="px-3 py-3 tabular-nums">{centsToEur(row.grossCents)}</td>
                          <td className="px-3 py-3 tabular-nums">{centsToEur(row.platformFeeCents)}</td>
                          <td className="px-3 py-3 tabular-nums">{centsToEur(row.netEntitlementCents)}</td>
                          <td className="px-3 py-3 tabular-nums">{centsToEur(row.distributedCents)}</td>
                          <td className="px-3 py-3 tabular-nums font-medium">{centsToEur(row.remainingCents)}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              <Button variant="ghost" size="sm" asChild>
                                <Link to={`/dashboard/tips/transactions?employeeId=${encodeURIComponent(row.employeeId ?? "")}`}>
                                  {t("business.tipDistribution.actions.viewTips")}
                                </Link>
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => openDistribution(row)}>
                                {t("business.tipDistribution.actions.record")}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className={businessUi.mobileList}>
                {awaitingEmployees.length === 0 ? (
                  <p className="px-1 py-4 text-sm text-muted-foreground">
                    {t("business.tipDistribution.ready.empty")}
                  </p>
                ) : (
                  awaitingEmployees.map((row) => (
                    <div key={row.employeeId ?? "unknown"} className={businessUi.mobileCard}>
                      <p className="font-medium">
                        {row.employeeName ?? t("business.tipDistribution.unassignedEmployee")}
                      </p>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{t("business.tipDistribution.table.gross")}</dt>
                          <dd className="mt-0.5 font-medium tabular-nums">{centsToEur(row.grossCents)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{t("business.tipDistribution.table.fees")}</dt>
                          <dd className="mt-0.5 font-medium tabular-nums">{centsToEur(row.platformFeeCents)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{t("business.tipDistribution.table.netOwed")}</dt>
                          <dd className="mt-0.5 font-medium tabular-nums">{centsToEur(row.netEntitlementCents)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{t("business.tipDistribution.table.distributed")}</dt>
                          <dd className="mt-0.5 font-medium tabular-nums">{centsToEur(row.distributedCents)}</dd>
                        </div>
                        <div className="col-span-2 min-w-0 border-t border-border/50 pt-2">
                          <dt className="text-xs font-medium text-muted-foreground">
                            {t("business.tipDistribution.table.remaining")}
                          </dt>
                          <dd className="mt-0.5 text-base font-semibold tabular-nums">{centsToEur(row.remainingCents)}</dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Button variant="ghost" size="sm" className="min-h-11 w-full sm:w-auto" asChild>
                          <Link to={`/dashboard/tips/transactions?employeeId=${encodeURIComponent(row.employeeId ?? "")}`}>
                            {t("business.tipDistribution.actions.viewTips")}
                          </Link>
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="min-h-11 w-full sm:w-auto"
                          onClick={() => openDistribution(row)}
                        >
                          {t("business.tipDistribution.actions.record")}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-base font-semibold">{t("business.tipDistribution.history.title")}</h2>
              <div className={businessUi.mobileList}>
                {history.length === 0 ? (
                  <p className="px-1 py-4 text-sm text-muted-foreground">
                    {t("business.tipDistribution.history.empty")}
                  </p>
                ) : (
                  history.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={cn(businessUi.mobileCard, "w-full text-left")}
                      onClick={() => void openBatchDetail(row.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-medium">{formatDistributionDate(row.completedAt, locale)}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{centsToEur(row.totalAmountCents)}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("business.tipDistribution.history.employeeCount", { count: row.employeeCount })}
                        {row.actorName ? ` · ${row.actorName}` : ""}
                      </p>
                      {row.paymentReference ? (
                        <p className="mt-1 text-xs text-muted-foreground">{row.paymentReference}</p>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
              <div className={businessUi.tableWrap}>
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.history.date")}</th>
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.history.total")}</th>
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.history.employees")}</th>
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.history.recordedBy")}</th>
                      <th className="px-3 py-2 font-medium">{t("business.tipDistribution.history.reference")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-muted-foreground">
                          {t("business.tipDistribution.history.empty")}
                        </td>
                      </tr>
                    ) : (
                      history.map((row) => (
                        <tr
                          key={row.id}
                          className="cursor-pointer border-b border-border/50 hover:bg-muted/30"
                          onClick={() => void openBatchDetail(row.id)}
                        >
                          <td className="px-3 py-3">{formatDistributionDate(row.completedAt, locale)}</td>
                          <td className="px-3 py-3 tabular-nums">{centsToEur(row.totalAmountCents)}</td>
                          <td className="px-3 py-3">{t("business.tipDistribution.history.employeeCount", { count: row.employeeCount })}</td>
                          <td className="px-3 py-3">{row.actorName ?? "—"}</td>
                          <td className="px-3 py-3">{row.paymentReference ?? "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      <Dialog open={selectedEmployee != null} onOpenChange={(open) => !open && closeDistribution()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("business.tipDistribution.modal.title", { name: selectedEmployee?.employeeName ?? "" })}</DialogTitle>
            <DialogDescription>{t("business.tipDistribution.modal.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm text-muted-foreground">{t("business.tipDistribution.modal.remainingOwed")}</p>
              <p className="text-lg font-semibold tabular-nums">{centsToEur(selectedEmployee?.remainingCents ?? 0)}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="distribution-amount">{t("business.tipDistribution.modal.amountLabel")}</Label>
              <Input
                id="distribution-amount"
                inputMode="decimal"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                disabled={submitting}
              />
            </div>
            {remainingAfter != null ? (
              <div>
                <p className="text-sm text-muted-foreground">{t("business.tipDistribution.modal.remainingAfter")}</p>
                <p className="text-lg font-semibold tabular-nums">{centsToEur(remainingAfter)}</p>
              </div>
            ) : null}
            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDistribution} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submitDistribution()} disabled={confirmDisabled}>
              {submitting ? t("business.tipDistribution.saving") : t("business.tipDistribution.modal.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailBatch != null} onOpenChange={(open) => !open && setDetailBatch(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("business.tipDistribution.detail.title")}</DialogTitle>
            <DialogDescription>
              {detailBatch ? formatDistributionDate(detailBatch.completedAt, locale) : ""}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <p className="text-sm text-muted-foreground">{t("business.tipDistribution.loading")}</p>
          ) : detailBatch ? (
            <div className="space-y-3">
              <p className="text-sm">
                {t("business.tipDistribution.detail.total", { amount: centsToEur(detailBatch.totalAmountCents) })}
              </p>
              {detailBatch.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/70 p-3">
                  <p className="font-medium">{item.employeeName ?? t("business.tipDistribution.unassignedEmployee")}</p>
                  <p className="text-sm tabular-nums text-muted-foreground">{centsToEur(item.amountCents)}</p>
                </div>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
