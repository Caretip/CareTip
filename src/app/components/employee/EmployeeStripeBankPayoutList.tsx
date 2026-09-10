import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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

function bankStatusTone(status: string): FinanceStatusTone {
  const s = status.toLowerCase();
  if (s === "paid") return "success";
  if (s === "failed" || s === "canceled") return "danger";
  if (s === "pending" || s === "in_transit") return "warning";
  return "neutral";
}

function bankStatusLabel(status: string, t: (key: string, opts?: { defaultValue: string }) => string): string {
  const key = `employee.payouts.bankHistory.status.${status}`;
  return t(key, { defaultValue: status });
}

export function EmployeeStripeBankPayoutList() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<EmployeeStripeBankPayoutItem[] | null>(null);
  const [readable, setReadable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listEmployeeStripeBankPayouts({ take: 50 })
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
  }, [t]);

  return (
    <section className="space-y-3" aria-labelledby="employee-bank-payouts-heading">
      <div className="space-y-1">
        <h2 id="employee-bank-payouts-heading" className="sr-only">
          {t("employee.payouts.history.bankTab")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("employee.payouts.history.bankHint")}</p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : items == null ? (
        <p className="text-sm text-muted-foreground">{t("employee.payouts.bankHistory.loading")}</p>
      ) : !readable ? (
        <p className="text-sm text-muted-foreground">{t("employee.payouts.bankHistory.useDashboard")}</p>
      ) : items.length === 0 ? (
        <div className="py-10">
          <p className="text-sm text-muted-foreground">{t("employee.payouts.bankHistory.empty")}</p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border/80 md:hidden">
            {items.map((row, index) => (
              <li key={`${row.createdAt}-${row.amountCents}-${index}`} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{t(`employee.payouts.bankHistory.method.${row.method}`)}</p>
                  <p className="text-xs text-muted-foreground">{formatBerlinDateTime(row.createdAt, i18n.language)}</p>
                  <FinanceStatusPill tone={bankStatusTone(row.status)} label={bankStatusLabel(row.status, t)} />
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums">{formatEur(row.amountCents / 100)}</p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("employee.payouts.history.bankTab")}</caption>
              <thead>
                <tr className="border-b border-border text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("employee.payouts.colDate")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("employee.payouts.bankHistory.colMethod")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("employee.payouts.colStatus")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("employee.payouts.colAmount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, index) => (
                  <tr key={`${row.createdAt}-${row.amountCents}-${index}`} className="border-b border-border/70 last:border-0">
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {formatBerlinDateTime(row.createdAt, i18n.language)}
                    </td>
                    <td className="py-2.5 pr-3">{t(`employee.payouts.bankHistory.method.${row.method}`)}</td>
                    <td className="py-2.5 pr-3">
                      <FinanceStatusPill tone={bankStatusTone(row.status)} label={bankStatusLabel(row.status, t)} />
                    </td>
                    <td className="py-2.5 text-right font-medium tabular-nums">{formatEur(row.amountCents / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
