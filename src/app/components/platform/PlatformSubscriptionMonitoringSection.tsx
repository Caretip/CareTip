import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronRight, HeartPulse, Layers, Loader2 } from "lucide-react";
import {
  fetchPlatformSubscriptionActivity,
  fetchPlatformSubscriptionMonitoring,
  type PlatformSubscriptionActivityFilter,
  type PlatformSubscriptionActivityRow,
  type PlatformSubscriptionMonitoring,
  type PlatformSubscriptionPaymentStatus,
  type SubscriptionStatus,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { formatEur } from "../../lib/formatEur";
import { subscriptionPlanDisplayName } from "../../lib/subscriptionPlanDisplayName";
import { platformUi } from "./platformDashboardUi";
import {
  CONSOLE_CHART,
  ConsoleCallout,
  ConsoleCard,
  ConsoleDot,
  ConsoleEmpty,
  ConsoleKv,
  ConsolePager,
  ConsoleSearch,
  ConsoleSegments,
  ConsoleSkeletonRows,
  ConsoleSplitBar,
  ConsoleStatus,
  ConsoleToolbar,
  useRowLink,
  type ConsoleTone,
} from "./console/AdminConsole";
import { formatCount, formatPercent, formatRelative } from "./console/consoleFormat";

const ACTIVITY_FILTERS: PlatformSubscriptionActivityFilter[] = [
  "all",
  "successful",
  "failed",
  "trialing",
  "active",
  "cancelled",
  "past_due",
];

const PAGE_SIZE = 25;

function formatAdminDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function formatAmountCents(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return formatEur(cents / 100);
}

const SUBSCRIPTION_TONE: Record<SubscriptionStatus, ConsoleTone> = {
  active: "success",
  trialing: "info",
  past_due: "attention",
  canceled: "neutral",
  unpaid: "failure",
  incomplete: "failure",
};

function subscriptionStatusBadge(status: SubscriptionStatus, t: ReturnType<typeof useTranslation>["t"]) {
  return <ConsoleStatus tone={SUBSCRIPTION_TONE[status] ?? "neutral"}>{t(`business.billing.status.${status}`)}</ConsoleStatus>;
}

const PAYMENT_TONE: Record<PlatformSubscriptionPaymentStatus, ConsoleTone> = {
  succeeded: "success",
  failed: "failure",
  pending: "info",
  none: "neutral",
};

function paymentStatusBadge(
  paymentStatus: PlatformSubscriptionPaymentStatus,
  t: ReturnType<typeof useTranslation>["t"],
) {
  return (
    <ConsoleStatus tone={PAYMENT_TONE[paymentStatus] ?? "neutral"}>
      {t(`admin.subscriptions.paymentStatus.${paymentStatus}`)}
    </ConsoleStatus>
  );
}

function ActivityMobileCard({ row, locale }: { row: PlatformSubscriptionActivityRow; locale: string }) {
  const { t } = useTranslation();
  return (
    <div className={platformUi.mobileCard}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{row.businessName}</p>
          {row.contactEmail ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.contactEmail}</p>
          ) : null}
        </div>
        <Link
          to={`/platform-admin/businesses/${row.businessId}`}
          className="shrink-0 text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          {t("admin.view")}
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {subscriptionStatusBadge(row.status, t)}
        {paymentStatusBadge(row.paymentStatus, t)}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">{t("admin.subscriptions.colPlan")}</dt>
          <dd className="font-medium text-foreground">
            {subscriptionPlanDisplayName(row.planKey as "basic" | "premium" | "enterprise", t)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("admin.subscriptions.colAmount")}</dt>
          <dd className="tabular-nums font-medium text-foreground">{formatAmountCents(row.amountCents)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("admin.subscriptions.colBillingPeriod")}</dt>
          <dd className="font-medium text-foreground">
            {t(`business.billing.${row.billingCycle === "yearly" ? "cycleYearly" : "cycleMonthly"}`)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("admin.subscriptions.colDate")}</dt>
          <dd className="font-medium text-foreground">{formatAdminDate(row.activityAt, locale)}</dd>
        </div>
      </dl>
    </div>
  );
}

export type PlatformSubscriptionMonitoringPart = "full" | "overview" | "activity";

type PlatformSubscriptionMonitoringSectionProps = {
  part?: PlatformSubscriptionMonitoringPart;
  /** When true, omit outer Card chrome (parent provides collapsible header). */
  embedded?: boolean;
  initialFilter?: PlatformSubscriptionActivityFilter;
  allowedFilters?: readonly PlatformSubscriptionActivityFilter[];
  onFilterChange?: (filter: PlatformSubscriptionActivityFilter) => void;
  /** Hide filter chips when the page preset is fixed (e.g. successful subscriptions). */
  hideActivityFilters?: boolean;
};

export function PlatformSubscriptionMonitoringSection({
  part = "full",
  embedded = false,
  initialFilter = "all",
  allowedFilters,
  onFilterChange,
  hideActivityFilters = false,
}: PlatformSubscriptionMonitoringSectionProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const showOverview = part === "full" || part === "overview";
  const showActivity = part === "full" || part === "activity";

  const [monitoring, setMonitoring] = useState<PlatformSubscriptionMonitoring | null>(null);
  const [monitoringLoading, setMonitoringLoading] = useState(true);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);

  const [filter, setFilter] = useState<PlatformSubscriptionActivityFilter>(initialFilter);

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [activity, setActivity] = useState<PlatformSubscriptionActivityRow[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadMonitoring = useCallback(async () => {
    setMonitoringLoading(true);
    setMonitoringError(null);
    try {
      const data = await fetchPlatformSubscriptionMonitoring(30);
      setMonitoring(data);
    } catch (err) {
      setMonitoringError(toUserFriendlyMessage(err) || t("admin.subscriptions.loadFailed"));
    } finally {
      setMonitoringLoading(false);
    }
  }, [t]);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError(null);
    try {
      const data = await fetchPlatformSubscriptionActivity({
        filter,
        q: debouncedSearch,
        take: PAGE_SIZE,
        skip: page * PAGE_SIZE,
        sort: "date",
        sortDir: "desc",
      });
      setActivity(data.items);
      setActivityTotal(data.total);
    } catch (err) {
      setActivityError(toUserFriendlyMessage(err) || t("admin.subscriptions.activityLoadFailed"));
    } finally {
      setActivityLoading(false);
    }
  }, [debouncedSearch, filter, page, t]);

  useEffect(() => {
    if (showOverview) void loadMonitoring();
  }, [loadMonitoring, showOverview]);

  useEffect(() => {
    if (!showActivity) return;
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search, showActivity]);

  useEffect(() => {
    if (!showActivity) return;
    setPage(0);
  }, [filter, debouncedSearch, showActivity]);

  useEffect(() => {
    if (showActivity) void loadActivity();
  }, [loadActivity, showActivity]);

  const visibleFilters = allowedFilters?.length ? allowedFilters : ACTIVITY_FILTERS;
  const pageCount = Math.max(1, Math.ceil(activityTotal / PAGE_SIZE));
  const overview = monitoring?.overview;
  const widgets = monitoring?.widgets;
  const rowLink = useRowLink();

  const n = (v: number | undefined) => (monitoringLoading || v == null ? "—" : formatCount(v, locale));

  const overviewBody = showOverview ? (
    <div className="ac-stack ac-stack--lg">
      {monitoringError ? <ConsoleCallout tone="failure">{monitoringError}</ConsoleCallout> : null}

      <div className="ac-grid ac-grid--2">
        <ConsoleCard icon={Layers} title={t("admin.subscriptions.overviewTitle")}>
          {monitoringLoading || !overview ? (
            <ConsoleSkeletonRows rows={4} />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex items-end gap-6">
                <div>
                  <p className="ac-big-number">{n(overview.active)}</p>
                  <p className="ac-small ac-muted mt-1">{t("admin.subscriptions.kpi.active")}</p>
                </div>
                <div>
                  <p className="text-xl font-bold tabular-nums">{n(overview.successful)}</p>
                  <p className="ac-small ac-muted mt-1">{t("admin.subscriptions.kpi.successful")}</p>
                </div>
              </div>
              <ConsoleSplitBar
                label={t("admin.subscriptions.overviewTitle")}
                parts={[
                  { key: "active", label: t("admin.subscriptions.kpi.active"), value: overview.active, color: CONSOLE_CHART.success },
                  { key: "trialing", label: t("admin.subscriptions.kpi.trialing"), value: overview.trialing, color: CONSOLE_CHART.info },
                  { key: "failed", label: t("admin.subscriptions.kpi.failed"), value: overview.failed, color: CONSOLE_CHART.failure },
                  { key: "cancelled", label: t("admin.subscriptions.kpi.cancelled"), value: overview.cancelled, color: CONSOLE_CHART.neutral },
                  { key: "expired", label: t("admin.subscriptions.kpi.expired"), value: overview.expired, color: "#57534e" },
                ]}
              />
            </div>
          )}
        </ConsoleCard>

        <ConsoleCard icon={HeartPulse} title={t("admin.subscriptions.healthTitle")}>
          {monitoringLoading ? (
            <ConsoleSkeletonRows rows={4} />
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
              <div className="shrink-0">
                <p className="ac-big-number">{formatPercent(widgets?.successRatePercent, locale, 1)}</p>
                <p className="ac-small ac-muted mt-1">{t("admin.subscriptions.widgets.successRate")}</p>
              </div>
              <div className="min-w-0 flex-1">
                <ConsoleKv
                  items={[
                    {
                      label: t("admin.subscriptions.widgets.failedToday"),
                      value: (
                        <span className="inline-flex items-center gap-1.5">
                          {(widgets?.failedPaymentsToday ?? 0) > 0 ? <ConsoleDot tone="failure" /> : null}
                          {n(widgets?.failedPaymentsToday)}
                        </span>
                      ),
                    },
                    { label: t("admin.subscriptions.widgets.failedWeek"), value: n(widgets?.failedPaymentsThisWeek) },
                    { label: t("admin.subscriptions.widgets.trialsEndingSoon"), value: n(widgets?.trialsEndingSoon) },
                    { label: t("admin.subscriptions.widgets.renewalsDueToday"), value: n(widgets?.renewalsDueToday) },
                  ]}
                />
              </div>
            </div>
          )}
        </ConsoleCard>
      </div>
    </div>
  ) : null;

  const activityBody = showActivity ? (
    <ConsoleCard
      title={part === "full" ? t("admin.subscriptions.activityTitle") : undefined}
      flush
      footer={
        activityTotal > PAGE_SIZE ? undefined : activityTotal > 0 ? (
          t("admin.subscriptions.pagination", { from: 1, to: activityTotal, total: activityTotal })
        ) : undefined
      }
    >
      <ConsoleToolbar
        start={
          !hideActivityFilters ? (
            <ConsoleSegments
              label={t("admin.subscriptions.colStatus")}
              options={visibleFilters.map((chip) => ({ value: chip, label: t(`admin.subscriptions.filters.${chip}`) }))}
              value={filter}
              onChange={(chip) => {
                setFilter(chip);
                onFilterChange?.(chip);
              }}
            />
          ) : null
        }
        end={
          <ConsoleSearch
            value={search}
            onChange={setSearch}
            placeholder={t("admin.subscriptions.searchPlaceholder")}
            label={t("admin.subscriptions.searchPlaceholder")}
          />
        }
      />

      {activityError ? (
        <div className="p-4">
          <ConsoleCallout tone="failure">{activityError}</ConsoleCallout>
        </div>
      ) : null}

      {activityLoading && activity.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status" aria-busy="true">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t("admin.subscriptions.activityLoading")}
        </div>
      ) : activity.length === 0 ? (
        <ConsoleEmpty icon={Layers} title={t("admin.subscriptions.activityEmpty")} />
      ) : (
        <>
          <div className={platformUi.mobileList}>
            {activity.map((row) => (
              <ActivityMobileCard key={`${row.businessId}-${row.activityAt}`} row={row} locale={locale} />
            ))}
          </div>
          <div className={platformUi.tableWrap}>
            <table className={platformUi.table}>
              <thead>
                <tr>
                  <th>{t("admin.subscriptions.colBusiness")}</th>
                  <th>{t("admin.subscriptions.colPlan")}</th>
                  <th>{t("admin.subscriptions.colStatus")}</th>
                  <th>{t("admin.subscriptions.colPaymentStatus")}</th>
                  <th className="ac-num">{t("admin.subscriptions.colAmount")}</th>
                  <th>{t("admin.subscriptions.colBillingPeriod")}</th>
                  <th>{t("admin.subscriptions.colDate")}</th>
                  <th>{t("admin.subscriptions.colLastPaymentAttempt")}</th>
                  <th className="ac-actions">
                    <span className="sr-only">{t("admin.colActions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={`${row.businessId}-${row.activityAt}`} {...rowLink(`/platform-admin/businesses/${row.businessId}`)}>
                    <td>
                      <div className="ac-cell-primary">{row.businessName}</div>
                      {row.contactEmail ? <span className="ac-cell-secondary">{row.contactEmail}</span> : null}
                    </td>
                    <td>{subscriptionPlanDisplayName(row.planKey as "basic" | "premium" | "enterprise", t)}</td>
                    <td>{subscriptionStatusBadge(row.status, t)}</td>
                    <td>{paymentStatusBadge(row.paymentStatus, t)}</td>
                    <td className="ac-num">{formatAmountCents(row.amountCents)}</td>
                    <td>{t(`business.billing.${row.billingCycle === "yearly" ? "cycleYearly" : "cycleMonthly"}`)}</td>
                    <td className="ac-nowrap">
                      {formatRelative(row.activityAt, locale)}
                      <span className="ac-cell-secondary">{formatAdminDate(row.activityAt, locale)}</span>
                    </td>
                    <td className="ac-nowrap ac-muted">{formatAdminDate(row.lastPaymentAttemptAt, locale)}</td>
                    <td className="ac-actions">
                      <Link to={`/platform-admin/businesses/${row.businessId}`} className="ac-btn ac-btn--ghost ac-btn--sm">
                        {t("admin.view")}
                        <ChevronRight aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activityTotal > PAGE_SIZE ? (
        <ConsolePager
          summary={t("admin.subscriptions.pagination", {
            from: page * PAGE_SIZE + 1,
            to: Math.min((page + 1) * PAGE_SIZE, activityTotal),
            total: activityTotal,
          })}
          prevLabel={t("admin.subscriptions.prevPage")}
          nextLabel={t("admin.subscriptions.nextPage")}
          prevDisabled={page === 0 || activityLoading}
          nextDisabled={page + 1 >= pageCount || activityLoading}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      ) : null}
    </ConsoleCard>
  ) : null;

  const inner = (
    <div className="ac-stack ac-stack--lg">
      {overviewBody}
      {activityBody}
    </div>
  );

  if (embedded) {
    return <div className="min-w-0">{inner}</div>;
  }

  return (
    <section className="ac-stack" aria-label={t("admin.subscriptions.title")}>
      {inner}
    </section>
  );
}
