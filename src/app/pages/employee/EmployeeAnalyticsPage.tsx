import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2, TrendingUp } from "lucide-react";
import { EmployeeTransferStatusCard } from "../../components/employee/EmployeeTransferStatusCard";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { EmployeeViewInStripeButton } from "../../components/employee/EmployeeViewInStripeButton";
import { EmployeeEmptyState } from "../../components/employee/EmployeeEmptyState";
import { DashboardAnalyticsPeriodToggle } from "../../components/dashboard/DashboardAnalyticsPeriodToggle";
import { DashboardChartSkeleton } from "../../components/dashboard/DashboardAnalyticsLoader";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useEmployeeAnalytics } from "../../hooks/useEmployeeAnalytics";
import type { EmployeeAnalyticsPeriod } from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { cn } from "@/lib/utils";
import {
  DASHBOARD_CHART_AXIS,
  DASHBOARD_CHART_GRID,
  DASHBOARD_CHART_AREA_STROKE,
  getDashboardChartTooltipStyle,
} from "../../components/dashboard/dashboardChartTheme";
import { LIGHTWEIGHT_AREA } from "../../lib/lightweightChartProps";
import { Button } from "../../components/ui/button";

const RECORDS_PAGE_SIZE = 10;

function formatStripeCents(cents: number | null | undefined, currency: string | null): string {
  if (cents == null) return "—";
  const cur = (currency ?? "eur").toUpperCase();
  if (cur === "EUR") return formatEur(cents / 100);
  return `${(cents / 100).toFixed(2)} ${cur}`;
}

function payoutStatusLabel(t: (k: string) => string, label: string): string {
  const key = `employee.analytics.payoutStatus.${label}`;
  const translated = t(key);
  return translated === key ? label : translated;
}

function formatAnalyticsDate(
  iso: string,
  timeZone: string | undefined,
  locale: string,
): string {
  const tz = timeZone?.trim() || "UTC";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: tz }).format(
    new Date(iso),
  );
}

function formatEarningsCell(
  t: (k: string) => string,
  row: { employeeEarningsEur: number | null; routingMode: string | null },
): string {
  if (row.routingMode === "business_distribution") {
    return t("employee.analytics.routingBusiness");
  }
  if (row.employeeEarningsEur != null) {
    return formatEur(row.employeeEarningsEur);
  }
  return "—";
}

export function EmployeeAnalyticsPage() {
  const { t, i18n } = useTranslation();
  const { user, authReady } = useRequireAuth();
  const [period, setPeriod] = useState<EmployeeAnalyticsPeriod>("month");
  const [recordsPage, setRecordsPage] = useState(0);
  const enabled = authReady && user?.role === "employee";
  const { data, loading, refreshing, error, reload, lastFetchedAt } = useEmployeeAnalytics(
    enabled,
    period,
  );

  const tipRecords = data?.tipRecords ?? [];
  const recordsPageCount = Math.max(1, Math.ceil(tipRecords.length / RECORDS_PAGE_SIZE));
  const recordsPageIndex = tipRecords.length === 0 ? 0 : recordsPage + 1;
  const paginatedRecords = tipRecords.slice(
    recordsPage * RECORDS_PAGE_SIZE,
    recordsPage * RECORDS_PAGE_SIZE + RECORDS_PAGE_SIZE,
  );
  const hasMoreRecords = (recordsPage + 1) * RECORDS_PAGE_SIZE < tipRecords.length;

  useEffect(() => {
    setRecordsPage(0);
  }, [period]);

  const periodOptions = useMemo(
    () =>
      (["today", "week", "month", "year", "all"] as EmployeeAnalyticsPeriod[]).map((id) => ({
        id,
        label: t(`employee.analytics.period.${id}`),
        loading: refreshing && period === id,
      })),
    [t, refreshing, period],
  );

  const grossChart = useMemo(
    () =>
      (data?.chartSeries ?? []).map((p) => ({
        time: p.label,
        amount: p.grossEur,
      })),
    [data?.chartSeries],
  );

  const earningsChart = useMemo(
    () =>
      (data?.chartSeries ?? []).map((p) => ({
        time: p.label,
        amount: p.earningsEur,
      })),
    [data?.chartSeries],
  );

  const feesDisplay =
    data?.metrics.feesExact && data.metrics.caretipFeesFromPayablesEur != null
      ? formatEur(data.metrics.caretipFeesFromPayablesEur)
      : null;

  if (!user) return null;

  return (
    <div className={cn(employeeUi.page, "employee-analytics-page")}>
      <div className={cn(employeeUi.pageInner, "mx-auto max-w-6xl space-y-8")}>
        <EmployeePageHeader
          title={t("employee.analytics.title")}
          description={t("employee.analytics.subtitle")}
          backAriaLabel={t("employee.analytics.backAria")}
          actions={<EmployeeViewInStripeButton />}
        />

        <DashboardAnalyticsPeriodToggle
          options={periodOptions}
          value={period}
          onChange={setPeriod}
          ariaLabel={t("employee.analytics.periodAria")}
          className="employee-analytics-period-toggle"
        />

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
            <button type="button" className="ml-3 underline" onClick={() => void reload()}>
              {t("dashboard.tryAgain")}
            </button>
          </div>
        ) : null}

        <section className="employee-analytics-summary" aria-label={t("employee.analytics.summaryAria")}>
          <div className="employee-analytics-summary__grid">
            {[
              {
                label: t("employee.analytics.grossTips"),
                value: data?.metrics.grossTipsEur ?? 0,
                hint: t("employee.analytics.grossTipsHint"),
              },
              {
                label: t("employee.analytics.yourEarnings"),
                value: data?.metrics.employeeEarningsEur ?? 0,
                hint: t("employee.analytics.yourEarningsHint"),
                primary: true,
              },
              {
                label: t("employee.analytics.paidToStripe"),
                value: data?.lifetimeMetrics.paidToStripeEur ?? 0,
                hint: t("employee.analytics.paidToStripeHint"),
              },
              {
                label: t("employee.analytics.pendingRelease"),
                value: data?.lifetimeMetrics.pendingReleaseEur ?? 0,
                hint: t("employee.analytics.pendingReleaseHint"),
              },
            ].map((card) => (
              <div
                key={card.label}
                className={cn(
                  "employee-analytics-summary__card",
                  card.primary && "employee-analytics-summary__card--primary",
                )}
              >
                <p className="employee-analytics-summary__label">{card.label}</p>
                <p className="employee-analytics-summary__value">
                  {loading ? "—" : formatEur(card.value)}
                </p>
                <p className="employee-analytics-summary__hint">{card.hint}</p>
              </div>
            ))}
          </div>
          <p className="employee-analytics-period-note text-xs text-muted-foreground">
            {t("employee.analytics.periodBasis", { basis: t("employee.analytics.periodBasisTipDate") })}
            {period !== "all" ? ` · ${t("employee.analytics.paidPendingLifetime")}` : ""}
          </p>
        </section>

        <section className="employee-analytics-reconciliation-flow" aria-label={t("employee.analytics.reconciliationAria")}>
          <h2 className="employee-analytics-section-title">{t("employee.analytics.reconciliationTitle")}</h2>
          <div className="employee-analytics-flow">
            <div className="employee-analytics-flow__step">
              <span>{t("employee.analytics.customerTips")}</span>
              <strong>{loading ? "—" : formatEur(data?.metrics.grossTipsEur ?? 0)}</strong>
            </div>
            <div className="employee-analytics-flow__arrow" aria-hidden>↓</div>
            <div className="employee-analytics-flow__step">
              <span>{t("employee.analytics.caretipFees")}</span>
              <strong>
                {feesDisplay
                  ? `− ${feesDisplay}`
                  : t("employee.analytics.feesUnavailable")}
              </strong>
            </div>
            <div className="employee-analytics-flow__arrow" aria-hidden>↓</div>
            <div className="employee-analytics-flow__step">
              <span>{t("employee.analytics.yourEarnings")}</span>
              <strong>{loading ? "—" : formatEur(data?.metrics.employeeEarningsEur ?? 0)}</strong>
            </div>
            <div className="employee-analytics-flow__split">
              <div>
                <span>{t("employee.analytics.paidToStripe")}</span>
                <strong>{loading ? "—" : formatEur(data?.lifetimeMetrics.paidToStripeEur ?? 0)}</strong>
              </div>
              <div>
                <span>{t("employee.analytics.pendingRelease")}</span>
                <strong>{loading ? "—" : formatEur(data?.lifetimeMetrics.pendingReleaseEur ?? 0)}</strong>
              </div>
            </div>
          </div>
          {(data?.lifetimeMetrics.prePayableGrossTipsEur ?? 0) > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("employee.analytics.legacyTipsNote", {
                amount: formatEur(data?.lifetimeMetrics.prePayableGrossTipsEur ?? 0),
              })}
            </p>
          ) : null}
        </section>

        <section aria-label={t("employee.analytics.performanceAria")}>
          <h2 className="employee-analytics-section-title">{t("employee.analytics.performanceTitle")}</h2>
          <div className="employee-analytics-performance-grid">
            <div>
              <p className="text-xs text-muted-foreground">{t("employee.analytics.tipCount")}</p>
              <p className="text-lg font-semibold tabular-nums">{loading ? "—" : data?.metrics.tipCount ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("employee.analytics.averageTip")}</p>
              <p className="text-lg font-semibold tabular-nums">
                {loading ? "—" : formatEur(data?.metrics.averageTipEur ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("employee.analytics.largestTip")}</p>
              <p className="text-lg font-semibold tabular-nums">
                {loading ? "—" : formatEur(data?.metrics.largestTipEur ?? 0)}
              </p>
            </div>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {loading ? (
              <>
                <DashboardChartSkeleton variant="trend" minHeightClass="min-h-[200px]" />
                <DashboardChartSkeleton variant="trend" minHeightClass="min-h-[200px]" />
              </>
            ) : (
              <>
                <MiniTrendChart title={t("employee.analytics.chartGross")} data={grossChart} t={t} />
                <MiniTrendChart title={t("employee.analytics.chartEarnings")} data={earningsChart} t={t} />
              </>
            )}
          </div>
        </section>

        <section aria-label={t("employee.analytics.recordsAria")}>
          <h2 className="employee-analytics-section-title">{t("employee.analytics.recordsTitle")}</h2>
          {!loading && (data?.tipRecords?.length ?? 0) === 0 ? (
            <EmployeeEmptyState
              compact
              icon={<TrendingUp className="h-4 w-4" aria-hidden />}
              title={t("employee.analytics.noTipsTitle")}
              description={t("employee.analytics.noTipsDesc")}
            />
          ) : (
            <>
              <ul className="employee-analytics-mobile-list lg:hidden" aria-label={t("employee.analytics.recordsTitle")}>
                {paginatedRecords.map((row) => (
                  <li key={row.id} className="employee-analytics-mobile-card">
                    <div className="employee-analytics-mobile-card__head">
                      <span className="employee-analytics-mobile-card__date">
                        {formatAnalyticsDate(
                          row.createdAt,
                          data?.businessTimezone,
                          i18n.language || "en",
                        )}
                      </span>
                      <span className="employee-analytics-mobile-card__ref">
                        {row.receiptNumber ? `#${row.receiptNumber}` : row.id.slice(0, 8)}
                      </span>
                    </div>
                    <dl className="employee-analytics-mobile-card__grid">
                      <div>
                        <dt>{t("employee.analytics.colGross")}</dt>
                        <dd className="tabular-nums">{formatEur(row.grossEur)}</dd>
                      </div>
                      <div>
                        <dt>{t("employee.analytics.colFee")}</dt>
                        <dd className="tabular-nums">
                          {row.platformFeeEur != null ? formatEur(row.platformFeeEur) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("employee.analytics.colEarnings")}</dt>
                        <dd className="tabular-nums">{formatEarningsCell(t, row)}</dd>
                      </div>
                      <div>
                        <dt>{t("employee.analytics.colRouting")}</dt>
                        <dd>
                          {row.routingMode === "business_distribution"
                            ? t("employee.analytics.routingBusiness")
                            : t("employee.analytics.routingDirect")}
                        </dd>
                      </div>
                      <div className="employee-analytics-mobile-card__grid-span">
                        <dt>{t("employee.analytics.colStatus")}</dt>
                        <dd>{payoutStatusLabel(t, row.payoutStatusLabel)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="employee-analytics-table-wrap hidden overflow-x-auto lg:block">
                <table className="employee-analytics-table w-full min-w-[640px] text-sm">
                  <thead>
                    <tr>
                      <th>{t("employee.analytics.colDate")}</th>
                      <th>{t("employee.analytics.colReference")}</th>
                      <th>{t("employee.analytics.colGross")}</th>
                      <th>{t("employee.analytics.colFee")}</th>
                      <th>{t("employee.analytics.colEarnings")}</th>
                      <th>{t("employee.analytics.colRouting")}</th>
                      <th>{t("employee.analytics.colStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRecords.map((row) => (
                      <tr key={row.id}>
                        <td>
                          {formatAnalyticsDate(
                            row.createdAt,
                            data?.businessTimezone,
                            i18n.language || "en",
                          )}
                        </td>
                        <td>{row.receiptNumber ? `#${row.receiptNumber}` : row.id.slice(0, 8)}</td>
                        <td className="tabular-nums">{formatEur(row.grossEur)}</td>
                        <td className="tabular-nums">
                          {row.platformFeeEur != null ? formatEur(row.platformFeeEur) : "—"}
                        </td>
                        <td className="tabular-nums">{formatEarningsCell(t, row)}</td>
                        <td>
                          {row.routingMode === "business_distribution"
                            ? t("employee.analytics.routingBusiness")
                            : t("employee.analytics.routingDirect")}
                        </td>
                        <td>{payoutStatusLabel(t, row.payoutStatusLabel)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tipRecords.length > RECORDS_PAGE_SIZE ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {t("employee.payouts.history.page", { page: recordsPageIndex, pages: recordsPageCount })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {recordsPage > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRecordsPage((p) => Math.max(0, p - 1))}
                      >
                        {t("employee.payouts.history.prev")}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!hasMoreRecords}
                      onClick={() => setRecordsPage((p) => p + 1)}
                    >
                      {t("employee.payouts.history.next")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section aria-label={t("employee.analytics.stripeAria")}>
          <h2 className="employee-analytics-section-title">{t("employee.analytics.stripeTitle")}</h2>
          <div className="employee-analytics-stripe-grid">
            <div className="employee-analytics-stripe-card">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("employee.analytics.stripeBalance")}
              </p>
              <p className="mt-2 text-lg font-semibold tabular-nums">
                {data?.stripe.readable
                  ? formatStripeCents(data.stripe.availableCents, data.stripe.currency)
                  : t("employee.analytics.stripeUnavailable")}
              </p>
              {data?.stripe.readable ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("employee.analytics.stripePending")}:{" "}
                  {formatStripeCents(data.stripe.pendingCents, data.stripe.currency)}
                </p>
              ) : null}
            </div>
            <div className="employee-analytics-stripe-card">
              <p className="text-sm font-medium">{t("employee.analytics.openExpress")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("employee.analytics.openExpressHint")}</p>
              <div className="mt-3">
                <EmployeeViewInStripeButton />
              </div>
            </div>
          </div>

          <h3 className="mt-6 text-sm font-semibold">{t("employee.analytics.bankPayouts")}</h3>
          <ul className="employee-analytics-mobile-list mt-2 lg:hidden" aria-label={t("employee.analytics.bankPayouts")}>
            {(data?.stripe.bankPayouts.items ?? []).map((po, idx) => (
              <li key={po.stripePayoutId ?? `po-${idx}`} className="employee-analytics-mobile-card">
                <div className="employee-analytics-mobile-card__head">
                  <span className="employee-analytics-mobile-card__date">
                    {new Date(po.createdAt).toLocaleDateString()}
                  </span>
                  <span className="employee-analytics-mobile-card__ref">{po.status}</span>
                </div>
                <dl className="employee-analytics-mobile-card__grid employee-analytics-mobile-card__grid--two">
                  <div>
                    <dt>{t("employee.analytics.colAmount")}</dt>
                    <dd className="tabular-nums">{formatStripeCents(po.amountCents, po.currency)}</dd>
                  </div>
                  <div>
                    <dt>{t("employee.analytics.colArrival")}</dt>
                    <dd>
                      {po.arrivalDate ? new Date(po.arrivalDate).toLocaleDateString() : "—"}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="employee-analytics-table-wrap mt-2 hidden overflow-x-auto lg:block">
            <table className="employee-analytics-table w-full min-w-[520px] text-sm">
              <thead>
                <tr>
                  <th>{t("employee.analytics.colDate")}</th>
                  <th>{t("employee.analytics.colAmount")}</th>
                  <th>{t("employee.analytics.colStatus")}</th>
                  <th>{t("employee.analytics.colArrival")}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.stripe.bankPayouts.items ?? []).map((po, idx) => (
                  <tr key={po.stripePayoutId ?? `po-${idx}`}>
                    <td>{new Date(po.createdAt).toLocaleDateString()}</td>
                    <td className="tabular-nums">
                      {formatStripeCents(po.amountCents, po.currency)}
                    </td>
                    <td>{po.status}</td>
                    <td>{po.arrivalDate ? new Date(po.arrivalDate).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="employee-analytics-status" aria-label={t("employee.analytics.statusAria")}>
          <h2 className="employee-analytics-section-title">{t("employee.analytics.statusTitle")}</h2>
          {data?.reconciliation ? (
            <EmployeeTransferStatusCard
              reconciliation={data.reconciliation}
              businessTimezone={data.businessTimezone}
              lastFetchedAt={lastFetchedAt}
              refreshing={refreshing}
              onRefresh={() => void reload()}
            />
          ) : null}
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>
                {t("employee.analytics.statusEarnings")}{" "}
                <strong className="tabular-nums">
                  {formatEur(data?.lifetimeMetrics.employeeEarningsEur ?? 0)}
                </strong>
              </span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>
                {t("employee.analytics.statusTransferred")}{" "}
                <strong className="tabular-nums">
                  {formatEur(data?.lifetimeMetrics.paidToStripeEur ?? 0)}
                </strong>
              </span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              <span>
                {t("employee.analytics.statusPending")}{" "}
                <strong className="tabular-nums">
                  {formatEur(data?.lifetimeMetrics.pendingReleaseEur ?? 0)}
                </strong>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function MiniTrendChart({
  title,
  data,
  t,
}: {
  title: string;
  data: Array<{ time: string; amount: number }>;
  t: (k: string) => string;
}) {
  if (data.length === 0) {
    return (
      <div className="employee-analytics-mini-chart">
        <h3 className="employee-period-chart__title">{title}</h3>
        <EmployeeEmptyState
          compact
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
          title={t("emptyState.chart.title")}
          description={t("emptyState.chart.description")}
        />
      </div>
    );
  }
  return (
    <div className="employee-analytics-mini-chart">
      <h3 className="employee-period-chart__title">{title}</h3>
      <div className="h-[200px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="4 6" stroke={DASHBOARD_CHART_GRID} vertical={false} />
            <XAxis
              dataKey="time"
              stroke={DASHBOARD_CHART_AXIS}
              tickLine={false}
              axisLine={{ stroke: DASHBOARD_CHART_GRID }}
              tick={{ fontSize: 11 }}
              tickMargin={8}
            />
            <YAxis
              stroke={DASHBOARD_CHART_AXIS}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              tickMargin={8}
              width={48}
            />
            <Tooltip
              contentStyle={getDashboardChartTooltipStyle()}
              formatter={(value: number) => [formatEur(Number(value)), title]}
            />
            <Area
              dataKey="amount"
              stroke={DASHBOARD_CHART_AREA_STROKE}
              fill="hsl(var(--primary) / 0.12)"
              {...LIGHTWEIGHT_AREA}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
