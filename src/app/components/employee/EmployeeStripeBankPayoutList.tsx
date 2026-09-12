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
  const panel = variant === "panel";

  useEffect(() => {
    let cancelled = false;
    void listEmployeeStripeBankPayouts({ take })
      .then((res) => {
        if (!cancelled) {
          setItems(res.items);
          setReadable(res.stripeReadable);
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
      <ul className="divide-y divide-border/80 lg:hidden">
        {items.map((row, index) => (
          <li key={`${row.createdAt}-${row.amountCents}-${index}`} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{t(`employee.payouts.bankHistory.method.${row.method}`)}</p>
              <p className="text-xs text-muted-foreground">{formatPayoutDate(bankDisplayDateIso(row), i18n.language)}</p>
              {row.stripePayoutId ? (
                <p className="truncate font-mono text-[0.6875rem] text-muted-foreground" title={row.stripePayoutId}>
                  {payoutRef(row)}
                </p>
              ) : null}
              <FinanceStatusPill
                tone={bankStatusTone(row.status)}
                label={bankStatusLabel(row.status, t)}
                className={cn("max-w-full whitespace-normal", bankStatusPillClass(row.status))}
              />
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums">{formatEur(row.amountCents / 100)}</p>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto lg:block">
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
                <td className="py-3.5 text-muted-foreground">
                  <ChevronRight className="size-4" aria-hidden />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <section
      className={cn(panel ? "rounded-2xl border border-border/70 bg-card p-5" : "space-y-3")}
      aria-labelledby="employee-bank-payouts-heading"
    >
      <div className={cn("flex items-start justify-between gap-3", panel ? "mb-4" : "space-y-1")}>
        <div className="min-w-0">
          <h2
            id="employee-bank-payouts-heading"
            className={panel ? "text-base font-semibold tracking-tight" : "sr-only"}
          >
            {t("employee.payouts.history.bankTab")}
          </h2>
        </div>
        {panel ? (
          <Link
            to={EMPLOYEE_PAYMENTS_HISTORY_HREF}
            className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            {t("employee.payouts.dashboard.viewHistory")}
          </Link>
        ) : null}
      </div>
      {body}
    </section>
  );
}
