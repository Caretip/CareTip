import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import {
  listEmployeePayableActivity,
  type EmployeePayableActivityItem,
} from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { formatBerlinDateTime } from "../../lib/physicalQrOrderUi";
import { logClientError } from "../../lib/clientLog";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { employeeUi } from "./employeeDashboardUi";
import { FinanceStatusPill } from "../finance/FinanceStatusPill";
import {
  employeePayoutActivityKind,
  employeePayoutActivityKindKey,
  employeePayoutActivityShowsStatusPill,
  employeePayoutActivityStatusKey,
  employeePayoutActivityTone,
} from "./employeePayoutActivityPresentation";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

export function EmployeePayoutActivityList() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<EmployeePayableActivityItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (nextSkip: number) => {
      setItems(null);
      setError(null);
      void listEmployeePayableActivity({ take: PAGE_SIZE, skip: nextSkip })
        .then((res) => {
          setItems(res.items);
          setTotal(res.total);
          setSkip(nextSkip);
        })
        .catch((err) => {
          logClientError("EmployeePayoutActivityList", err);
          setItems([]);
          setError(toUserFriendlyMessage(err) || t("employee.payouts.activityLoadError"));
        });
    },
    [t],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + PAGE_SIZE, total);

  return (
    <section className="space-y-3" aria-labelledby="employee-payout-activity-heading">
      <div>
        <h2 id="employee-payout-activity-heading" className="sr-only">
          {t("employee.payouts.history.caretipTab")}
        </h2>
      </div>
      {items == null ? (
        <p className="text-sm text-muted-foreground">{t("employee.payouts.activityLoading")}</p>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <div className={cn(employeeUi.emptyWrap, "py-10 sm:py-12")}>
          <div className={employeeUi.emptyIcon}>
            <Receipt className="h-6 w-6" aria-hidden />
          </div>
          <h3 className={employeeUi.emptyTitle}>{t("employee.payouts.emptyActivityTitle")}</h3>
          <p className={employeeUi.emptyDesc}>{t("employee.payouts.emptyActivityBody")}</p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border/80 md:hidden">
            {items.map((row) => (
              <ActivityMobileRow key={row.id} row={row} locale={i18n.language} />
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("employee.payouts.history.caretipTab")}</caption>
              <thead>
                <tr className="border-b border-border text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("employee.payouts.colDate")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("employee.payouts.colDescription")}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    {t("employee.payouts.colAmount")}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {t("employee.payouts.colStatus")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const kind = employeePayoutActivityKind(row);
                  return (
                    <tr key={row.id} className="border-b border-border/70 last:border-0">
                      <td className="whitespace-nowrap py-2.5 pr-3 text-muted-foreground">
                        {formatBerlinDateTime(row.createdAt, i18n.language)}
                      </td>
                      <td className="max-w-[18rem] py-2.5 pr-3">{t(employeePayoutActivityKindKey(kind))}</td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right font-medium tabular-nums">
                        {formatEur(row.activityCents / 100)}
                      </td>
                      <td className="py-2.5">
                        {employeePayoutActivityShowsStatusPill(kind) ? (
                          <FinanceStatusPill
                            tone={employeePayoutActivityTone(kind)}
                            label={t(employeePayoutActivityStatusKey(kind))}
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground" aria-label={t("employee.payouts.activityStatus.held_venueAria")}>
                            {t(employeePayoutActivityStatusKey(kind))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > PAGE_SIZE ? (
            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-xs text-muted-foreground">
                {t("employee.payouts.history.showing", { from, to, total })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={skip <= 0} onClick={() => load(Math.max(0, skip - PAGE_SIZE))}>
                  {t("employee.payouts.history.prev")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={skip + PAGE_SIZE >= total}
                  onClick={() => load(skip + PAGE_SIZE)}
                >
                  {t("employee.payouts.history.next")}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ActivityMobileRow({ row, locale }: { row: EmployeePayableActivityItem; locale: string }) {
  const { t } = useTranslation();
  const kind = employeePayoutActivityKind(row);
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{t(employeePayoutActivityKindKey(kind))}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{formatBerlinDateTime(row.createdAt, locale)}</p>
        <div className="mt-1">
          {employeePayoutActivityShowsStatusPill(kind) ? (
            <FinanceStatusPill
              className="max-w-full whitespace-normal"
              tone={employeePayoutActivityTone(kind)}
              label={t(employeePayoutActivityStatusKey(kind))}
            />
          ) : (
            <span className="text-xs text-muted-foreground" aria-label={t("employee.payouts.activityStatus.held_venueAria")}>
              {t(employeePayoutActivityStatusKey(kind))}
            </span>
          )}
        </div>
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums">{formatEur(row.activityCents / 100)}</p>
    </li>
  );
}
