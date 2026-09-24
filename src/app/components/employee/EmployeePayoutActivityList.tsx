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
  employeePayoutActivityDisplayAt,
  employeePayoutActivityKind,
  employeePayoutActivityKindKey,
  employeePayoutActivityShowsStatusPill,
  employeePayoutActivityStatusKey,
  employeePayoutActivityTone,
} from "./employeePayoutActivityPresentation";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

export function EmployeePayoutActivityList() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<EmployeePayableActivityItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (nextSkip: number) => {
      setLoading(true);
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
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [t],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const hasMore = skip + PAGE_SIZE < total;
  const pageIndex = total === 0 ? 0 : Math.floor(skip / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="space-y-3" aria-labelledby="employee-payout-activity-heading">
      <h2 id="employee-payout-activity-heading" className="sr-only">
        {t("employee.payouts.history.caretipTab")}
      </h2>
      {loading && items == null ? (
        <p className="text-sm text-muted-foreground">{t("employee.payouts.activityLoading")}</p>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : (items?.length ?? 0) === 0 ? (
        <div className={cn(employeeUi.emptyWrap, "py-10 sm:py-12")}>
          <div className={employeeUi.emptyIcon}>
            <Receipt className="h-6 w-6" aria-hidden />
          </div>
          <h3 className={employeeUi.emptyTitle}>{t("employee.payouts.emptyActivityTitle")}</h3>
          <p className={employeeUi.emptyDesc}>{t("employee.payouts.emptyActivityBody")}</p>
        </div>
      ) : (
        <>
          <div
            className={cn(
              "employee-payout-teaser-row flex gap-2.5 overflow-x-auto pb-1 snap-x snap-mandatory",
              loading && "pointer-events-none opacity-60",
            )}
            aria-busy={loading || undefined}
          >
            {(items ?? []).map((row) => (
              <ActivityTeaserCard key={row.id} row={row} locale={i18n.language} />
            ))}
          </div>
          {total > PAGE_SIZE ? (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <p className="text-xs text-muted-foreground">
                {t("employee.payouts.history.page", { page: pageIndex, pages: pageCount })}
              </p>
              <div className="flex flex-wrap gap-2">
                {skip > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={loading}
                    onClick={() => load(Math.max(0, skip - PAGE_SIZE))}
                  >
                    {t("employee.payouts.history.prev")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasMore || loading}
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

function ActivityTeaserCard({
  row,
  locale,
}: {
  row: EmployeePayableActivityItem;
  locale: string;
}) {
  const { t } = useTranslation();
  const kind = employeePayoutActivityKind(row);
  return (
    <article
      className="employee-payout-teaser shrink-0 snap-start flex w-[9.25rem] min-w-[9.25rem] flex-col gap-1.5 rounded-lg border border-border/60 bg-card p-3"
    >
      <p className="text-sm font-semibold tabular-nums leading-tight">
        {formatEur(row.activityCents / 100)}
      </p>
      <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">
        {t(employeePayoutActivityKindKey(kind))}
      </p>
      <p className="text-[0.6875rem] leading-tight text-muted-foreground">
        {formatBerlinDateTime(employeePayoutActivityDisplayAt(row), locale)}
      </p>
      <div className="mt-auto pt-0.5">
        {employeePayoutActivityShowsStatusPill(kind) ? (
          <FinanceStatusPill
            className="max-w-full whitespace-normal text-[0.625rem]"
            tone={employeePayoutActivityTone(kind)}
            label={t(employeePayoutActivityStatusKey(kind))}
          />
        ) : (
          <span
            className="text-[0.6875rem] leading-tight text-muted-foreground"
            aria-label={t("employee.payouts.activityStatus.held_venueAria")}
          >
            {t(employeePayoutActivityStatusKey(kind))}
          </span>
        )}
      </div>
    </article>
  );
}
