import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, RefreshCw } from "lucide-react";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { EmployeeTipActivityDetailDialog } from "../../components/employee/EmployeeTipActivityDetailDialog";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { Button } from "../../components/ui/button";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useTipsActivityRealtime } from "../../hooks/useTipsActivityRealtime";
import {
  getEmployeeProfile,
  listEmployeePayableActivity,
  type EmployeePayableActivityFilter,
  type EmployeePayableActivityItem,
} from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { formatVenueDateTime, resolveBusinessTimezone } from "../../lib/businessVenueTime";
import { logClientError } from "../../lib/clientLog";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { isProtectedApiReady } from "../../lib/authRestore";
import {
  TIP_ACTIVITY_FILTERS,
  employeeTipActivityDateGroup,
  employeeTipActivityDisplayAt,
  employeeTipActivityKind,
  employeeTipActivityPrimaryAmountCents,
  employeeTipActivityVenueLabel,
  type TipActivityDateGroup,
} from "../../lib/employeeTipActivityPresentation";
import {
  employeePayoutActivityTone,
} from "../../components/employee/employeePayoutActivityPresentation";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

function dotToneClass(tone: ReturnType<typeof employeePayoutActivityTone>): string {
  if (tone === "success") return "employee-tip-activity-item__dot--success";
  if (tone === "warning") return "employee-tip-activity-item__dot--warning";
  if (tone === "danger") return "employee-tip-activity-item__dot--danger";
  return "employee-tip-activity-item__dot--neutral";
}

function groupLabel(t: (k: string) => string, group: TipActivityDateGroup): string {
  if (group === "today") return t("employee.tipActivity.groupToday");
  if (group === "yesterday") return t("employee.tipActivity.groupYesterday");
  return t("employee.tipActivity.groupOlder");
}

export function EmployeeTipActivityPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const { user, sessionValidated } = useRequireAuth();
  const [filter, setFilter] = useState<EmployeePayableActivityFilter>("all");
  const [items, setItems] = useState<EmployeePayableActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<EmployeePayableActivityItem | null>(null);

  const tz = resolveBusinessTimezone(timezone);
  const hasMore = items.length < total;

  const fetchActivity = useCallback(
    async (nextSkip: number, append: boolean, quiet?: boolean) => {
      if (!user) return;
      if (append) setLoadingMore(true);
      else if (!quiet) setLoading(true);
      setError(null);
      try {
        const res = await listEmployeePayableActivity({
          take: PAGE_SIZE,
          skip: nextSkip,
          filter,
        });
        setTotal(res.total);
        setSkip(nextSkip);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      } catch (err) {
        logClientError("EmployeeTipActivityPage.load", err);
        if (!append) {
          setItems([]);
          setTotal(0);
          setSkip(0);
        }
        setError(toUserFriendlyMessage(err) || t("employee.tipActivity.loadError"));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter, t, user],
  );

  const load = useCallback(
    (opts?: { append?: boolean; quiet?: boolean }) => {
      const nextSkip = opts?.append ? skip + PAGE_SIZE : 0;
      return fetchActivity(nextSkip, opts?.append === true, opts?.quiet);
    },
    [fetchActivity, skip],
  );

  useEffect(() => {
    void getEmployeeProfile({ silent: true })
      .then((profile) => setTimezone(profile.businessTimezone ?? null))
      .catch(() => setTimezone(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    setSkip(0);
    setItems([]);
    void fetchActivity(0, false);
  }, [filter, user?.id, fetchActivity]);

  const catchUp = useCallback(() => {
    void load({ quiet: true });
  }, [load]);

  useTipsActivityRealtime({
    enabled: Boolean(user) && sessionValidated && isProtectedApiReady(),
    role: user?.role,
    businessId: user?.businessId,
    employeeId: user?.employeeId,
    variant: "employee-history",
    onLiveTip: () => catchUp(),
    onCatchUp: catchUp,
  });

  const grouped = useMemo(() => {
    const groups: Record<TipActivityDateGroup, EmployeePayableActivityItem[]> = {
      today: [],
      yesterday: [],
      older: [],
    };
    for (const row of items) {
      const at = employeeTipActivityDisplayAt(row);
      const bucket = employeeTipActivityDateGroup(at, tz);
      groups[bucket].push(row);
    }
    return groups;
  }, [items, tz]);

  if (!user) return null;

  return (
    <div className={cn(employeeUi.page, "employee-tip-activity-page")}>
      <div className={cn(employeeUi.pageInner, "employee-tip-activity-inner mx-auto space-y-5")}>
        <EmployeePageHeader
          title={t("employee.tipActivity.title")}
          description={t("employee.tipActivity.subtitle")}
          backAriaLabel={t("employee.tipActivity.backAria")}
          leading={
            <div className={employeeUi.iconTileMuted}>
              <Activity className="h-5 w-5" aria-hidden />
            </div>
          }
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              disabled={loading}
              onClick={() => void load()}
              aria-label={t("employee.tipActivity.refresh")}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
            </Button>
          }
        />

        <div
          className="employee-tip-activity-filters"
          role="tablist"
          aria-label={t("employee.tipActivity.filtersAria")}
        >
          {TIP_ACTIVITY_FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              aria-pressed={filter === id}
              className="employee-tip-activity-filter"
              onClick={() => setFilter(id)}
            >
              {t(`employee.tipActivity.filter.${id}`)}
            </button>
          ))}
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
            <button type="button" className="ml-3 underline" onClick={() => void load()}>
              {t("dashboard.tryAgain")}
            </button>
          </div>
        ) : null}

        {loading && items.length === 0 ? (
          <div className="employee-tip-activity-skeleton" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="employee-tip-activity-skeleton__row" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className={cn(employeeUi.emptyWrap, "py-12")}>
            <h2 className={employeeUi.emptyTitle}>{t("employee.tipActivity.emptyTitle")}</h2>
            <p className={employeeUi.emptyDesc}>{t("employee.tipActivity.emptyBody")}</p>
          </div>
        ) : (
          <>
            {(["today", "yesterday", "older"] as TipActivityDateGroup[]).map((group) => {
              const rows = grouped[group];
              if (rows.length === 0) return null;
              return (
                <section key={group} className="employee-tip-activity-group" aria-label={groupLabel(t, group)}>
                  <h2 className="employee-tip-activity-group__label">{groupLabel(t, group)}</h2>
                  <ul className="employee-tip-activity-timeline">
                    {rows.map((row) => {
                      const kind = employeeTipActivityKind(row);
                      const tone = employeePayoutActivityTone(kind);
                      const at = employeeTipActivityDisplayAt(row);
                      const venue = employeeTipActivityVenueLabel(row);
                      const supportKey = `employee.tipActivity.support.${kind}`;
                      const support = t(supportKey);
                      const showSupport = support !== supportKey;
                      const earningsNote =
                        row.routingMode !== "business_distribution" &&
                        kind !== "refunded" &&
                        row.grossCents != null &&
                        row.platformFeeCents != null
                          ? t("employee.tipActivity.earningsAfterFee", {
                              amount: formatEur(
                                Math.max(0, row.payableCents - row.refundedCents) / 100,
                              ),
                            })
                          : null;

                      return (
                        <li key={row.id}>
                          <button
                            type="button"
                            className="employee-tip-activity-item w-full"
                            onClick={() => setDetailRow(row)}
                          >
                            <span
                              className={cn("employee-tip-activity-item__dot", dotToneClass(tone))}
                              aria-hidden
                            />
                            <span className="employee-tip-activity-item__body">
                              <p className="employee-tip-activity-item__amount">
                                {formatEur(employeeTipActivityPrimaryAmountCents(row) / 100)}
                              </p>
                              <p className="employee-tip-activity-item__title">
                                {t(`employee.tipActivity.event.${kind}`)}
                              </p>
                              {venue ? <p className="employee-tip-activity-item__venue">{venue}</p> : null}
                              <p className="employee-tip-activity-item__time">
                                {formatVenueDateTime(at, tz, locale)}
                              </p>
                              {earningsNote ? (
                                <p className="employee-tip-activity-item__support">{earningsNote}</p>
                              ) : null}
                              {showSupport ? (
                                <p className="employee-tip-activity-item__support">{support}</p>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}

            {hasMore ? (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full sm:w-auto"
                  disabled={loadingMore}
                  onClick={() => void load({ append: true })}
                >
                  {loadingMore ? t("employee.tipActivity.loadingMore") : t("employee.tipActivity.loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        )}

        <EmployeeTipActivityDetailDialog
          row={detailRow}
          timezone={timezone}
          locale={locale}
          onClose={() => setDetailRow(null)}
        />
      </div>
    </div>
  );
}
