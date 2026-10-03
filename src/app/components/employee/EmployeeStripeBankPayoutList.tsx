import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import {
  listEmployeeStripeBankPayouts,
  type EmployeeStripeBankPayoutItem,
} from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { formatBerlinDateTime } from "../../lib/physicalQrOrderUi";
import { logClientError } from "../../lib/clientLog";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { FinanceStatusPill } from "../finance/FinanceStatusPill";
import type { FinanceStatusTone } from "../finance/FinanceStatusDot";
import { EMPLOYEE_PAYMENTS_HISTORY_HREF } from "./employeeDashboardNav";
import { cn } from "@/lib/utils";
import { PayoutWorkspacePanel } from "../finance/payout/PayoutWorkspacePanel";
import { EmployeeBankPayoutDetailDialog } from "./EmployeeBankPayoutDetailDialog";

function bankStatusTone(status: string): FinanceStatusTone {
  const s = status.toLowerCase();
  if (s === "paid") return "success";
  if (s === "failed" || s === "canceled") return "danger";
  if (s === "pending" || s === "in_transit") return "warning";
  return "neutral";
}

function bankStatusPillClass(status: string): string | undefined {
  if (status.toLowerCase() === "in_transit") {
    return "bg-sky-500/12 text-sky-900 dark:text-sky-200";
  }
  return undefined;
}

function bankStatusLabel(status: string, t: (key: string, opts?: { defaultValue: string }) => string): string {
  const key = `employee.payouts.bankHistory.status.${status}`;
  return t(key, { defaultValue: status });
}

function payoutRef(row: EmployeeStripeBankPayoutItem): string {
  const id = row.stripePayoutId?.trim() ?? "";
  if (id.startsWith("po_") && id.length > 7) return `po_…${id.slice(-4)}`;
  return "—";
}

function bankDisplayDateIso(row: EmployeeStripeBankPayoutItem): string {
  const arrival = row.arrivalDate?.trim();
  if (arrival) return arrival;
  return row.createdAt;
}

function formatPayoutDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });
  } catch {
    return formatBerlinDateTime(iso, locale);
  }
}

export function EmployeeStripeBankPayoutList({
  variant = "page",
  take = 50,
}: {
  variant?: "page" | "panel";
  take?: number;
}) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<EmployeeStripeBankPayoutItem[] | null>(null);
  const [readable, setReadable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bankPayoutSchedule, setBankPayoutSchedule] = useState<string | null>(null);
  const [detailPayout, setDetailPayout] = useState<EmployeeStripeBankPayoutItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const panel = variant === "panel";

  useEffect(() => {
    let cancelled = false;
    void listEmployeeStripeBankPayouts({ take })
      .then((res) => {
        if (!cancelled) {
          setItems(res.items);
          setReadable(res.stripeReadable);
          setBankPayoutSchedule(res.bankPayoutSchedule ?? null);
          setError(null);
        }
      })
      .catch((err) => {
        logClientError("EmployeeStripeBankPayoutList", err);
        if (!cancelled) {
          setItems([]);
          setError(toUserFriendlyMessage(err) || t("employee.payouts.bankHistory.loadError"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t, take]);

  const openDetail = (row: EmployeeStripeBankPayoutItem) => {
    setDetailPayout(row);
    setDetailOpen(true);
  };

  const body = error ? (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  ) : items == null ? (
    <p className="text-sm text-muted-foreground">{t("employee.payouts.bankHistory.loading")}</p>
  ) : !readable ? (
    <p className="text-sm text-muted-foreground">{t("employee.payouts.bankHistory.useDashboard")}</p>
  ) : items.length === 0 ? (
    <div className={panel ? "py-8" : "py-10"}>
      <p className="text-sm text-muted-foreground">{t("employee.payouts.bankHistory.empty")}</p>
    </div>
  ) : (
    <>
      <ul className="lg:hidden">
        {items.map((row, index) => (
          <li key={`${row.createdAt}-${row.amountCents}-${index}`}>
            <button
              type="button"
              onClick={() => openDetail(row)}
              className="caretip-payout-mobile-record flex w-full min-w-0 items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">{t(`employee.payouts.bankHistory.method.${row.method}`)}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatPayoutDate(bankDisplayDateIso(row), i18n.language)}
                </p>
                <FinanceStatusPill
                  tone={bankStatusTone(row.status)}
                  label={bankStatusLabel(row.status, t)}
                  className={cn("max-w-full whitespace-normal", bankStatusPillClass(row.status))}
                />
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">{formatEur(row.amountCents / 100)}</p>
            </button>
          </li>
        ))}
      </ul>
      <div className="caretip-payout-ledger hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t("employee.payouts.history.bankTab")}</caption>
          <thead>
            <tr className="border-b border-border text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-3 pr-3 font-medium">
                {t("employee.payouts.colDate")}
              </th>
              <th scope="col" className="py-3 pr-3 font-medium">
                {t("employee.payouts.dashboard.colPayoutId")}
              </th>
              <th scope="col" className="py-3 pr-3 font-medium">
                {t("employee.payouts.colAmount")}
              </th>
              <th scope="col" className="py-3 pr-3 font-medium">
                {t("employee.payouts.bankHistory.colMethod")}
              </th>
              <th scope="col" className="py-3 pr-3 font-medium">
                {t("employee.payouts.colStatus")}
              </th>
              <th scope="col" className="w-8 py-3 font-medium">
                <span className="sr-only">{t("employee.payouts.dashboard.openRow")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, index) => (
              <tr key={`${row.createdAt}-${row.amountCents}-${index}`} className="border-b border-border/70 last:border-0">
                <td className="py-3.5 pr-3 text-muted-foreground">{formatPayoutDate(bankDisplayDateIso(row), i18n.language)}</td>
                <td className="max-w-[10rem] truncate py-3.5 pr-3 font-mono text-xs text-muted-foreground" title={row.stripePayoutId ?? undefined}>{payoutRef(row)}</td>
                <td className="whitespace-nowrap py-3.5 pr-3 font-medium tabular-nums">{formatEur(row.amountCents / 100)}</td>
                <td className="py-3.5 pr-3 text-muted-foreground">
                  {row.destinationLast4
                    ? t("employee.payouts.dashboard.methodMaskedLast4", { last4: row.destinationLast4 })
                    : t(`employee.payouts.bankHistory.method.${row.method}`)}
                </td>
                <td className="py-3.5 pr-3">
                  <FinanceStatusPill
                    tone={bankStatusTone(row.status)}
                    label={bankStatusLabel(row.status, t)}
                    className={bankStatusPillClass(row.status)}
                  />
                </td>
                <td className="py-3.5">
                  <button
                    type="button"
                    onClick={() => openDetail(row)}
                    className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={t("employee.payouts.bankHistory.openDetail")}
                  >
                    <ChevronRight className="size-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  const detailDialog = (
    <EmployeeBankPayoutDetailDialog
      open={detailOpen}
      onOpenChange={setDetailOpen}
      payout={detailPayout}
      bankPayoutSchedule={bankPayoutSchedule}
    />
  );

  if (!panel) {
    return (
      <section className="space-y-3" aria-labelledby="employee-bank-payouts-heading">
        <h2 id="employee-bank-payouts-heading" className="sr-only">
          {t("employee.payouts.history.bankTab")}
        </h2>
        {body}
        {detailDialog}
      </section>
    );
  }

  return (
    <PayoutWorkspacePanel aria-labelledby="employee-bank-payouts-heading">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id="employee-bank-payouts-heading" className="min-w-0 text-sm font-semibold tracking-tight sm:text-base">
          {t("employee.payouts.history.bankTab")}
        </h2>
        <Link
          to={EMPLOYEE_PAYMENTS_HISTORY_HREF}
          className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {t("employee.payouts.dashboard.viewHistory")}
        </Link>
      </div>
      {body}
      {detailDialog}
    </PayoutWorkspacePanel>
  );
}
