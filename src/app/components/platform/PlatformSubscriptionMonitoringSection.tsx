import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Loader2, Search } from "lucide-react";
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
import { billingStatusStyles } from "../business/settings/billing/billingUi";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { platformUi } from "./platformDashboardUi";
import { PlatformStatCard } from "./PlatformStatCard";

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

function subscriptionStatusBadge(status: SubscriptionStatus, t: ReturnType<typeof useTranslation>["t"]) {
  const emoji: Record<SubscriptionStatus, string> = {
    active: "🟢",
    trialing: "🟡",
    past_due: "🟠",
    canceled: "⚪",
    unpaid: "🔴",
    incomplete: "🔴",
  };
  const styles = billingStatusStyles(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        styles.badge,
      )}
    >
      <span aria-hidden>{emoji[status]}</span>
      {t(`business.billing.status.${status}`)}
    </span>
  );
}

function paymentStatusBadge(
  paymentStatus: PlatformSubscriptionPaymentStatus,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const config: Record<
    PlatformSubscriptionPaymentStatus,
    { emoji: string; className: string; labelKey: string }
  > = {
    succeeded: {
      emoji: "🟢",
      className: "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-500/30",
      labelKey: "admin.subscriptions.paymentStatus.succeeded",
    },
    failed: {
      emoji: "🔴",
      className: "bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-500/30",
      labelKey: "admin.subscriptions.paymentStatus.failed",
    },
    pending: {
      emoji: "🟡",
      className: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-500/30",
      labelKey: "admin.subscriptions.paymentStatus.pending",
    },
    none: {
      emoji: "⚪",
      className: "bg-muted text-muted-foreground ring-border/40",
      labelKey: "admin.subscriptions.paymentStatus.none",
    },
  };
  const item = config[paymentStatus];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        item.className,
      )}
    >
      <span aria-hidden>{item.emoji}</span>
      {t(item.labelKey)}
    </span>
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
  /** Hide filter chips when the page preset is fixed (e.g. failed payments module). */
  hideActivityFilters?: boolean;
};

export function PlatformSubscriptionMonitoringSection({
  part = "full",
  embedded = false,
  initialFilter = "all",
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

  const pageCount = Math.max(1, Math.ceil(activityTotal / PAGE_SIZE));
  const overview = monitoring?.overview;
  const widgets = monitoring?.widgets;

  const kpiCards = useMemo(
    () =>
      [
        { key: "active", label: t("admin.subscriptions.kpi.active"), value: overview?.active },
        { key: "trialing", label: t("admin.subscriptions.kpi.trialing"), value: overview?.trialing },
        { key: "successful", label: t("admin.subscriptions.kpi.successful"), value: overview?.successful },
        { key: "failed", label: t("admin.subscriptions.kpi.failed"), value: overview?.failed },
        { key: "cancelled", label: t("admin.subscriptions.kpi.cancelled"), value: overview?.cancelled },
        { key: "expired", label: t("admin.subscriptions.kpi.expired"), value: overview?.expired },
      ] as const,
    [overview, t],
  );

  const overviewBody = showOverview ? (
    <>
      {monitoringError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {monitoringError}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpiCards.map((card) => (
          <PlatformStatCard
            key={card.key}
            label={card.label}
            value={card.value != null ? String(card.value) : "—"}
            numericValue={card.value}
            loading={monitoringLoading}
            className="min-w-0"
          />
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t("admin.subscriptions.widgets.successRate")}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {monitoringLoading ? "—" : `${widgets?.successRatePercent ?? 0}%`}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t("admin.subscriptions.widgets.failedToday")}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {monitoringLoading ? "—" : (widgets?.failedPaymentsToday ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t("admin.subscriptions.widgets.failedWeek")}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {monitoringLoading ? "—" : (widgets?.failedPaymentsThisWeek ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t("admin.subscriptions.widgets.trialsEndingSoon")}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {monitoringLoading ? "—" : (widgets?.trialsEndingSoon ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("admin.subscriptions.widgets.renewalsDueToday")}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {monitoringLoading ? "—" : (widgets?.renewalsDueToday ?? 0)}
          </p>
        </div>
      </div>
    </>
  ) : null;

  const activityBody = showActivity ? (
    <>
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className={cn(platformUi.searchWrap, "w-full sm:max-w-xs")}>
            <Search className={platformUi.searchIcon} aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("admin.subscriptions.searchPlaceholder")}
              className={platformUi.searchInput}
              aria-label={t("admin.subscriptions.searchPlaceholder")}
            />
          </div>
        </div>

        {!hideActivityFilters ? (
          <div className="flex gap-2 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {ACTIVITY_FILTERS.map((chip) => {
              const active = filter === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setFilter(chip)}
                  className={cn(
                    "inline-flex min-h-[40px] shrink-0 touch-manipulation items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    active
                      ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                      : "border-border/80 bg-background text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {t(`admin.subscriptions.filters.${chip}`)}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {activityError ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {activityError}
        </p>
      ) : null}

      {activityLoading && activity.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t("admin.subscriptions.activityLoading")}
        </div>
      ) : activity.length === 0 ? (
        <p className={platformUi.emptyState}>{t("admin.subscriptions.activityEmpty")}</p>
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
                <tr className={platformUi.tableHeadRow}>
                  <th className={platformUi.tableTh}>{t("admin.subscriptions.colBusiness")}</th>
                  <th className={platformUi.tableTh}>{t("admin.subscriptions.colPlan")}</th>
                  <th className={platformUi.tableTh}>{t("admin.subscriptions.colStatus")}</th>
                  <th className={platformUi.tableTh}>{t("admin.subscriptions.colPaymentStatus")}</th>
                  <th className={platformUi.tableTh}>{t("admin.subscriptions.colAmount")}</th>
                  <th className={platformUi.tableTh}>{t("admin.subscriptions.colBillingPeriod")}</th>
                  <th className={platformUi.tableTh}>{t("admin.subscriptions.colDate")}</th>
                  <th className={platformUi.tableTh}>{t("admin.subscriptions.colLastPaymentAttempt")}</th>
                  <th className={cn(platformUi.tableTh, "text-right")}>{t("admin.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={`${row.businessId}-${row.activityAt}`} className={platformUi.tableRow}>
                    <td className={platformUi.tableTd}>
                      <div className="font-medium text-foreground">{row.businessName}</div>
                      {row.contactEmail ? (
                        <div className="text-xs text-muted-foreground">{row.contactEmail}</div>
                      ) : null}
                    </td>
                    <td className={platformUi.tableTd}>
                      {subscriptionPlanDisplayName(row.planKey as "basic" | "premium" | "enterprise", t)}
                    </td>
                    <td className={platformUi.tableTd}>{subscriptionStatusBadge(row.status, t)}</td>
                    <td className={platformUi.tableTd}>{paymentStatusBadge(row.paymentStatus, t)}</td>
                    <td className={cn(platformUi.tableTd, "tabular-nums")}>
                      {formatAmountCents(row.amountCents)}
                    </td>
                    <td className={platformUi.tableTd}>
                      {t(`business.billing.${row.billingCycle === "yearly" ? "cycleYearly" : "cycleMonthly"}`)}
                    </td>
                    <td className={cn(platformUi.tableTd, "whitespace-nowrap text-xs")}>
                      {formatAdminDate(row.activityAt, locale)}
                    </td>
                    <td className={cn(platformUi.tableTd, "whitespace-nowrap text-xs")}>
                      {formatAdminDate(row.lastPaymentAttemptAt, locale)}
                    </td>
                    <td className={cn(platformUi.tableTd, "text-right")}>
                      <Link
                        to={`/platform-admin/businesses/${row.businessId}`}
                        className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {t("admin.view")}
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
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            {t("admin.subscriptions.pagination", {
              from: page * PAGE_SIZE + 1,
              to: Math.min((page + 1) * PAGE_SIZE, activityTotal),
              total: activityTotal,
            })}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0 || activityLoading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="min-h-[40px] rounded-lg border border-border px-3 text-xs font-medium text-foreground disabled:opacity-50"
            >
              {t("admin.subscriptions.prevPage")}
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pageCount || activityLoading}
              onClick={() => setPage((p) => p + 1)}
              className="min-h-[40px] rounded-lg border border-border px-3 text-xs font-medium text-foreground disabled:opacity-50"
            >
              {t("admin.subscriptions.nextPage")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  ) : null;

  const inner = (
    <>
      {overviewBody}
      {part === "full" && showOverview && showActivity ? <div className="my-6 border-t border-border" /> : null}
      {part === "full" && showActivity ? (
        <h3 className="mb-4 text-sm font-semibold text-foreground">{t("admin.subscriptions.activityTitle")}</h3>
      ) : null}
      {activityBody}
    </>
  );

  if (embedded) {
    return <div className="min-w-0">{inner}</div>;
  }

  return (
    <Card className={cn(platformUi.contentCard, "mb-6")}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("admin.subscriptions.title")}</CardTitle>
        <CardDescription>{t("admin.subscriptions.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{inner}</CardContent>
    </Card>
  );
}
