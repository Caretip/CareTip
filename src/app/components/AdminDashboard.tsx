import { lazy, Suspense, useEffect, useMemo, useState, memo } from "react";
import { Link, Navigate } from "react-router";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { de, enUS } from "date-fns/locale";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Building2,
  CircleCheck,
  CreditCard,
  Euro,
  Package,
  Receipt,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import {
  fetchPlatformHealth,
  fetchPlatformStats,
  fetchPlatformBusinesses,
  fetchOnboardingQueueMetrics,
  fetchPlatformSubscriptionMonitoring,
  fetchPlatformAuditLogs,
  fetchPlatformCommercialIntelligence,
  fetchPlatformAnalytics,
  fetchPlatformPhysicalQrOrders,
  type PlatformHealthResponse,
  type PlatformGlobalStats,
  type PlatformBusinessRow,
  type OnboardingQueueMetrics,
  type PlatformAnalytics,
  type PlatformSubscriptionMonitoring,
  type PhysicalQrAdminOrder,
} from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { logClientError } from "../lib/clientLog";
import { DashboardChartsIdleMount } from "./dashboard/DashboardChartsIdleMount";
import { DashboardLoadErrorNotice } from "./dashboard/DashboardLoadErrorNotice";
import { DashboardChartSkeleton } from "./dashboard/DashboardAnalyticsLoader";
import { toUserFriendlyMessage } from "../lib/errorMessages";
import { PlatformAdminFreshnessIndicator } from "./platform/PlatformPageChrome";
import {
  PLATFORM_BUSINESS_BASE,
  PLATFORM_BRANDING_ORDERS_BASE,
  PLATFORM_REVENUE_BASE,
  PLATFORM_REPORTS_BASE,
  PLATFORM_SYSTEM_BASE,
} from "./platform/platformAdminNav";
import { formatEur } from "../lib/formatEur";
import { formatDashboardFormalGreeting } from "../lib/dashboardFormalGreeting";
import { isPhysicalQrFulfillable } from "../lib/physicalQrOrderUi";
import {
  CONSOLE_CHART,
  ConsoleAttentionList,
  ConsoleAvatar,
  ConsoleCallout,
  ConsoleCard,
  ConsoleDot,
  ConsoleEmpty,
  ConsoleHeader,
  ConsoleKpi,
  ConsoleKpiGrid,
  ConsoleKv,
  ConsoleList,
  ConsoleListRow,
  ConsolePage,
  ConsoleSkeletonRows,
  ConsoleSplitBar,
  ConsoleStatus,
  type ConsoleAttentionItem,
} from "./platform/console/AdminConsole";
import { formatCount, formatPercent, formatRelative, humanizeAuditAction } from "./platform/console/consoleFormat";
import {
  useDashboardKpiProfile,
  useDashboardPageFullyLoaded,
  useDashboardRenderProbe,
} from "../hooks/useDashboardRuntimeProfile";

const PlatformOverviewSummaryCharts = lazy(() =>
  import("./platform/PlatformOverviewSummaryCharts").then((mod) => ({
    default: mod.PlatformOverviewSummaryCharts,
  })),
);

const VERIFICATION_TEASER_LIMIT = 3;
const RECENT_ACTIVITY_LIMIT = 6;

function onboardingTeaserPriority(status: PlatformBusinessRow["onboardingVerificationStatus"]): number {
  if (status === "submitted") return 0;
  if (status === "rejected") return 1;
  return 2;
}

function computeNewBusinessesThisWeek(analytics: PlatformAnalytics | null): number {
  return (analytics?.growth ?? []).slice(-7).reduce((sum, row) => sum + row.newBusinesses, 0);
}

type QrQueueSummary = { readyToFulfil: number; onHold: number; inTransit: number };

function summarizeQrOrders(orders: PhysicalQrAdminOrder[]): QrQueueSummary {
  let readyToFulfil = 0;
  let onHold = 0;
  let inTransit = 0;
  for (const o of orders) {
    const fulfillable = isPhysicalQrFulfillable(o.paymentStatus, o.holdReleasedAt);
    if (["PAID", "PROCESSING", "PRINTING"].includes(o.fulfillmentStatus)) {
      if (fulfillable) readyToFulfil += 1;
      else if (["IN_REVIEW", "PARTIALLY_REFUNDED", "DISPUTED"].includes(o.paymentStatus)) onHold += 1;
    } else if (o.paymentStatus === "IN_REVIEW") {
      onHold += 1;
    }
    if (o.fulfillmentStatus === "SHIPPED") inTransit += 1;
  }
  return { readyToFulfil, onHold, inTransit };
}

export const AdminDashboard = memo(function AdminDashboard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { user, authHydrated, sessionValidated } = useAuth();
  const [health, setHealth] = useState<PlatformHealthResponse | null>(null);
  const [stats, setStats] = useState<PlatformGlobalStats | null>(null);
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [onboardingTeaser, setOnboardingTeaser] = useState<PlatformBusinessRow[]>([]);
  const [onboardingMetrics, setOnboardingMetrics] = useState<OnboardingQueueMetrics | null>(null);
  const [subscriptionMonitoring, setSubscriptionMonitoring] = useState<PlatformSubscriptionMonitoring | null>(null);
  const [qrSummary, setQrSummary] = useState<QrQueueSummary | null>(null);
  const [commercialSummary, setCommercialSummary] = useState<{
    upgrades: number;
    trials: number;
    atRisk: number;
  } | null>(null);
  const [recentLogs, setRecentLogs] = useState<Array<{ action: string; at: string; email?: string | null }>>([]);

  /** Stage 1 — health + stats (KPI / hero). */
  const [criticalLoading, setCriticalLoading] = useState(true);
  /** Stage 2 — onboarding metrics, recent businesses, audit logs, print-order queue. */
  const [secondaryLoading, setSecondaryLoading] = useState(true);
  /** Stage 3 — commercial intelligence, subscriptions, 30d analytics. */
  const [heavyLoading, setHeavyLoading] = useState(true);
  /** A failed read must never look like a real zero: operators act on these numbers. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [chartsFailed, setChartsFailed] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useDashboardRenderProbe("platform_admin:AdminDashboard");
  // First KPI when critical stage settles — do not wait for heavy APIs.
  useDashboardKpiProfile("platform_admin", !criticalLoading);
  useDashboardPageFullyLoaded(
    "platform_admin",
    !criticalLoading && !secondaryLoading && !heavyLoading,
  );

  useEffect(() => {
    if (!authHydrated || !sessionValidated || user?.role !== "platform_admin") return;

    let cancelled = false;
    let heavyIdleId: number | null = null;
    let heavyTimeoutId: number | null = null;

    setLoadError(null);
    setStatsFailed(false);
    setChartsFailed(false);

    /** Records a failed read and returns null, so the other reads on this page still land. */
    const noteFailure = (source: string, onFail?: () => void) => (err: unknown) => {
      logClientError(`AdminDashboard.${source}`, err);
      if (!cancelled) {
        onFail?.();
        setLoadError((current) => current ?? toUserFriendlyMessage(err));
      }
      return null;
    };

    const loadCritical = async () => {
      setCriticalLoading(true);
      void fetchPlatformHealth()
        .then((healthRes) => {
          if (!cancelled && healthRes) setHealth(healthRes);
        })
        .catch((e) => logClientError("AdminDashboard.loadHealth", e));
      try {
        const statsRes = await fetchPlatformStats().catch(noteFailure("loadStats", () => setStatsFailed(true)));
        if (cancelled) return;
        if (statsRes) setStats(statsRes);
      } catch (e) {
        logClientError("AdminDashboard.loadCritical", e);
      } finally {
        if (!cancelled) setCriticalLoading(false);
      }
    };

    const loadSecondary = async () => {
      setSecondaryLoading(true);
      try {
        const [onboardingRes, onboardingSubmittedRes, logsRes, qrRes] = await Promise.all([
          fetchOnboardingQueueMetrics().catch(noteFailure("loadOnboardingMetrics", () => setStatsFailed(true))),
          fetchPlatformBusinesses({
            workflow: "onboarding",
            status: "submitted",
            take: VERIFICATION_TEASER_LIMIT,
            sort: "newest",
          }).catch((err: unknown) => {
            noteFailure("loadOnboardingQueue")(err);
            return { businesses: [] as PlatformBusinessRow[] };
          }),
          fetchPlatformAuditLogs({ take: RECENT_ACTIVITY_LIMIT, skip: 0 }).catch((err: unknown) => {
            noteFailure("loadAuditLogs")(err);
            return { items: [], total: 0 };
          }),
          // Print-order queue is a secondary signal: a failure hides the card instead of showing zeros.
          fetchPlatformPhysicalQrOrders().catch((err: unknown) => {
            logClientError("AdminDashboard.loadQrOrders", err);
            return null;
          }),
        ]);
        if (cancelled) return;

        if (onboardingRes) setOnboardingMetrics(onboardingRes);
        setQrSummary(qrRes ? summarizeQrOrders(qrRes.orders ?? []) : null);

        const onboardingQueue = (onboardingSubmittedRes.businesses ?? [])
          .sort(
            (a, b) =>
              onboardingTeaserPriority(a.onboardingVerificationStatus) -
                onboardingTeaserPriority(b.onboardingVerificationStatus) ||
              a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
          )
          .slice(0, VERIFICATION_TEASER_LIMIT);
        setOnboardingTeaser(onboardingQueue);

        setRecentLogs(
          (logsRes.items ?? []).map((row) => ({
            action: row.action,
            at: row.createdAt,
            email: row.userEmail,
          })),
        );
      } catch (e) {
        logClientError("AdminDashboard.loadSecondary", e);
      } finally {
        if (!cancelled) setSecondaryLoading(false);
      }
    };

    const loadHeavy = async () => {
      setHeavyLoading(true);
      try {
        const [analyticsRes, subRes, commercialRes] = await Promise.all([
          fetchPlatformAnalytics(30).catch(noteFailure("loadAnalytics", () => setChartsFailed(true))),
          fetchPlatformSubscriptionMonitoring(30).catch(
            noteFailure("loadSubscriptions", () => setChartsFailed(true)),
          ),
          fetchPlatformCommercialIntelligence().catch(noteFailure("loadCommercial")),
        ]);
        if (cancelled) return;

        if (analyticsRes) setAnalytics(analyticsRes);
        if (subRes) setSubscriptionMonitoring(subRes);
        if (commercialRes?.segments) {
          setCommercialSummary({
            upgrades: commercialRes.segments.premiumOpportunities?.length ?? 0,
            trials: commercialRes.segments.growthCandidates?.length ?? 0,
            atRisk: commercialRes.segments.atRisk?.length ?? 0,
          });
        }
      } catch (e) {
        logClientError("AdminDashboard.loadHeavy", e);
      } finally {
        if (!cancelled) setHeavyLoading(false);
      }
    };

    // KPI + secondary load immediately. Heavy commercial/analytics waits until idle
    // so it does not contend with health/stats/onboarding on first paint.
    void loadCritical();
    void loadSecondary();
    if (typeof requestIdleCallback === "function") {
      heavyIdleId = requestIdleCallback(
        () => {
          if (!cancelled) void loadHeavy();
        },
        { timeout: 1200 },
      );
    } else {
      heavyTimeoutId = window.setTimeout(() => {
        if (!cancelled) void loadHeavy();
      }, 400);
    }

    return () => {
      cancelled = true;
      if (heavyIdleId != null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(heavyIdleId);
      }
      if (heavyTimeoutId != null) window.clearTimeout(heavyTimeoutId);
    };
  }, [authHydrated, sessionValidated, user?.role, reloadCount]);

  const activeBusinessesCount = onboardingMetrics?.approved ?? 0;
  const pendingOnboardingCount = onboardingMetrics?.submitted ?? 0;
  const newBusinessesWeek = useMemo(() => computeNewBusinessesThisWeek(analytics), [analytics]);
  const failedPaymentsToday = subscriptionMonitoring?.widgets?.failedPaymentsToday ?? 0;

  const tipsWindow = useMemo(() => {
    const rows = analytics?.tipVolume ?? [];
    const volume = rows.reduce((s, r) => s + r.tipsEur, 0);
    const count = rows.reduce((s, r) => s + r.tipCount, 0);
    return { volume, count, avg: rows.length ? volume / rows.length : 0 };
  }, [analytics?.tipVolume]);

  const platformStatus: "operational" | "degraded" | "checking" = !health
    ? "checking"
    : health.database === "online" && health.stripe === "online"
      ? "operational"
      : "degraded";

  const attentionAlerts = useMemo((): ConsoleAttentionItem[] => {
    const alerts: ConsoleAttentionItem[] = [];
    const review = t("admin.overview.alerts.review");

    if (health && (health.database !== "online" || health.stripe !== "online")) {
      alerts.push({
        id: "health",
        message: t("admin.overview.alerts.systemHealth"),
        href: `${PLATFORM_SYSTEM_BASE}/health`,
        severity: "critical",
        cta: review,
        icon: ShieldAlert,
      });
    }

    if (!secondaryLoading && pendingOnboardingCount > 0) {
      alerts.push({
        id: "onboarding",
        message: t("admin.overview.alerts.pendingOnboarding", { count: pendingOnboardingCount }),
        href: `${PLATFORM_BUSINESS_BASE}/onboarding-verification`,
        severity: "warning",
        cta: review,
        icon: UserCheck,
      });
    }

    if (!secondaryLoading && (qrSummary?.onHold ?? 0) > 0) {
      alerts.push({
        id: "qr-hold",
        message: `${t("admin.physicalQr.holdTitle")} · ${qrSummary?.onHold ?? 0}`,
        href: PLATFORM_BRANDING_ORDERS_BASE,
        severity: "warning",
        cta: review,
        icon: Package,
      });
    }

    if (!heavyLoading && failedPaymentsToday > 0) {
      alerts.push({
        id: "failed-payments",
        message: t("admin.overview.alerts.failedPaymentsToday", {
          count: failedPaymentsToday,
        }),
        href: `${PLATFORM_BUSINESS_BASE}/subscriptions?filter=failed`,
        severity: "warning",
        cta: review,
        icon: CreditCard,
      });
    }

    if (!heavyLoading && (commercialSummary?.atRisk ?? 0) > 0) {
      alerts.push({
        id: "at-risk",
        message: t("admin.overview.alerts.atRiskSubscriptions", { count: commercialSummary?.atRisk ?? 0 }),
        href: `${PLATFORM_REPORTS_BASE}/commercial`,
        severity: "warning",
        cta: review,
        icon: TrendingUp,
      });
    }

    return alerts;
  }, [
    commercialSummary?.atRisk,
    failedPaymentsToday,
    health,
    heavyLoading,
    pendingOnboardingCount,
    qrSummary?.onHold,
    secondaryLoading,
    t,
  ]);

  if (!authHydrated || !sessionValidated || !user) return null;
  if (user.role !== "platform_admin") return <Navigate to="/unauthorized" replace />;

  const dateLocale = lang?.toLowerCase().startsWith("de") ? de : enUS;
  const nowLabel = format(new Date(), dateLocale === de ? "EEEE, d. MMMM · HH:mm" : "EEEE, MMMM d · h:mm a", {
    locale: dateLocale,
  });
  const allSettled = !criticalLoading && !secondaryLoading && !heavyLoading;
  const overview = subscriptionMonitoring?.overview;
  const widgets = subscriptionMonitoring?.widgets;

  return (
    <ConsolePage className="platform-dashboard-overview">
      <ConsoleHeader
        crumbs={[{ label: formatDashboardFormalGreeting(t, user.name) }]}
        title={t("admin.overview.title")}
        description={t("admin.overview.hero.summary")}
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" aria-hidden />
              <time dateTime={new Date().toISOString()}>{nowLabel}</time>
            </span>
            <PlatformAdminFreshnessIndicator
              generatedAt={stats?.generatedAt}
              cacheTtlSeconds={stats?.cacheTtlSeconds}
              locale={lang}
            />
          </>
        }
        actions={
          <Link to={`${PLATFORM_SYSTEM_BASE}/health`} className="ac-pulse" aria-label={t("admin.overview.hero.statusLinkAria")}>
            <ConsoleDot
              tone={platformStatus === "operational" ? "success" : platformStatus === "degraded" ? "failure" : "neutral"}
            />
            {platformStatus === "operational"
              ? t("admin.overview.hero.statusOperational")
              : platformStatus === "degraded"
                ? t("admin.overview.hero.statusDegraded")
                : t("admin.overview.hero.statusChecking")}
          </Link>
        }
      />

      {loadError ? (
        <DashboardLoadErrorNotice message={loadError} onRetry={() => setReloadCount((n) => n + 1)} />
      ) : null}

      {/* 1 · What needs a decision right now */}
      {attentionAlerts.length > 0 ? (
        <ConsoleCard
          id="overview-attention"
          tone={attentionAlerts.some((a) => a.severity === "critical") ? "danger" : "accent"}
          title={t("admin.overview.alerts.title")}
          actions={
            <ConsoleStatus tone={attentionAlerts.some((a) => a.severity === "critical") ? "failure" : "attention"}>
              {t("admin.console.overview.openItems", { count: attentionAlerts.length })}
            </ConsoleStatus>
          }
          flush
        >
          <ConsoleAttentionList items={attentionAlerts} />
        </ConsoleCard>
      ) : allSettled && !loadError ? (
        <ConsoleCallout tone="success" icon={CircleCheck} title={t("admin.console.overview.allClearTitle")}>
          {t("admin.console.overview.allClearBody")}
        </ConsoleCallout>
      ) : null}

      {/* 2 · Platform KPIs */}
      {statsFailed ? null : (
        <section aria-labelledby="platform-kpis-title" className="flex flex-col gap-3">
          <h2 id="platform-kpis-title" className="ac-section-label">
            {t("admin.overview.kpisTitle")}
          </h2>
          <ConsoleKpiGrid columns={4} label={t("admin.overview.kpisTitle")}>
            <ConsoleKpi
              icon={Euro}
              tone="attention"
              label={t("admin.overview.kpi.tipVolume")}
              value={
                typeof stats?.totalVolumeEur === "number"
                  ? formatEur(stats.totalVolumeEur)
                  : (stats?.totalVolumeEurFormatted ?? formatEur(0))
              }
              hint={
                heavyLoading
                  ? undefined
                  : `${t("admin.console.overview.last30Volume")}: ${formatEur(tipsWindow.volume)}`
              }
              loading={criticalLoading}
              href={`${PLATFORM_REVENUE_BASE}/transactions`}
            />
            <ConsoleKpi
              icon={Receipt}
              label={t("admin.overview.kpi.transactions")}
              value={formatCount(stats?.successTransactionCount, lang)}
              hint={
                heavyLoading ? undefined : `${t("admin.console.overview.last30Count")}: ${formatCount(tipsWindow.count, lang)}`
              }
              loading={criticalLoading}
            />
            <ConsoleKpi
              icon={Building2}
              label={t("admin.overview.kpi.totalBusinesses")}
              value={formatCount(stats?.businessesCount, lang)}
              hint={`${t("admin.overview.kpi.activeBusinesses")}: ${formatCount(activeBusinessesCount, lang)} · ${t("admin.overview.businessGrowth.newThisWeek")}: ${heavyLoading ? "—" : formatCount(newBusinessesWeek, lang)}`}
              loading={criticalLoading || secondaryLoading}
              href={`${PLATFORM_BUSINESS_BASE}/all`}
            />
            <ConsoleKpi
              icon={Users}
              label={t("admin.overview.kpi.staff")}
              value={formatCount(stats?.employeesCount, lang)}
              hint={`${t("admin.console.overview.locations")}: ${formatCount(stats?.locationsCount, lang)} · ${t("admin.console.overview.activeUsers")}: ${formatCount(stats?.activeUsersCount, lang)}`}
              loading={criticalLoading}
            />
          </ConsoleKpiGrid>
        </section>
      )}

      {/* 3 · Trends: money in + subscription health */}
      {chartsFailed ? null : (
        <div className="ac-grid ac-grid--wide-narrow">
          <ConsoleCard
            id="overview-tips"
            title={t("admin.overview.charts.tipsTitle")}
            description={t("admin.overview.charts.tipsDesc")}
            actions={
              <Link to={`${PLATFORM_REVENUE_BASE}/transactions`} className="ac-link">
                {t("admin.overview.viewAll")}
                <ArrowRight aria-hidden />
              </Link>
            }
          >
            <dl className="mb-4 grid grid-cols-3 gap-3 border-b border-border/60 pb-4">
              {[
                [t("admin.console.overview.last30Volume"), formatEur(tipsWindow.volume)],
                [t("admin.console.overview.last30Count"), formatCount(tipsWindow.count, lang)],
                [t("admin.console.overview.dailyAverage"), formatEur(tipsWindow.avg)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-base font-bold tabular-nums sm:text-lg">{heavyLoading ? "—" : value}</dd>
                </div>
              ))}
            </dl>
            <div className="ac-chart">
              <DashboardChartsIdleMount whenVisible fallback={<DashboardChartSkeleton />}>
                <Suspense fallback={<DashboardChartSkeleton />}>
                  <PlatformOverviewSummaryCharts analytics={analytics} loading={heavyLoading} />
                </Suspense>
              </DashboardChartsIdleMount>
            </div>
          </ConsoleCard>

          <ConsoleCard
            id="overview-subscriptions"
            title={t("admin.overview.charts.subscriptionsTitle")}
            description={t("admin.overview.charts.subscriptionsDesc")}
            actions={
              <Link to={`${PLATFORM_BUSINESS_BASE}/subscriptions`} className="ac-link">
                {t("admin.overview.viewAll")}
                <ArrowRight aria-hidden />
              </Link>
            }
          >
            {heavyLoading || !overview ? (
              <ConsoleSkeletonRows rows={6} />
            ) : (
              <div className="flex flex-col gap-5">
                <div>
                  <p className="ac-big-number">{formatPercent(widgets?.successRatePercent, lang, 1)}</p>
                  <p className="ac-small ac-muted mt-1">{t("admin.subscriptions.widgets.successRate")}</p>
                </div>
                <ConsoleSplitBar
                  label={t("admin.subscriptions.overviewTitle")}
                  parts={[
                    { key: "active", label: t("admin.subscriptions.kpi.active"), value: overview.active, color: CONSOLE_CHART.success },
                    { key: "trialing", label: t("admin.subscriptions.kpi.trialing"), value: overview.trialing, color: CONSOLE_CHART.info },
                    { key: "failed", label: t("admin.subscriptions.kpi.failed"), value: overview.failed, color: CONSOLE_CHART.failure },
                    { key: "cancelled", label: t("admin.overview.charts.cancelled"), value: overview.cancelled, color: CONSOLE_CHART.neutral },
                    { key: "expired", label: t("admin.overview.charts.expired"), value: overview.expired, color: "#57534e" },
                  ]}
                />
                <ConsoleKv
                  items={[
                    { label: t("admin.subscriptions.widgets.failedToday"), value: formatCount(widgets?.failedPaymentsToday, lang) },
                    { label: t("admin.subscriptions.widgets.failedWeek"), value: formatCount(widgets?.failedPaymentsThisWeek, lang) },
                    { label: t("admin.subscriptions.widgets.trialsEndingSoon"), value: formatCount(widgets?.trialsEndingSoon, lang) },
                    { label: t("admin.subscriptions.widgets.renewalsDueToday"), value: formatCount(widgets?.renewalsDueToday, lang) },
                  ]}
                />
              </div>
            )}
          </ConsoleCard>
        </div>
      )}

      {/* 4 · Work queues */}
      <section aria-labelledby="platform-queues-title" className="flex flex-col gap-3">
        <div>
          <h2 id="platform-queues-title" className="ac-section-label" style={{ marginBottom: 0 }}>
            {t("admin.console.overview.workQueues")}
          </h2>
        </div>
        <div className="ac-grid ac-grid--3">
          <ConsoleCard
            id="overview-verification"
            icon={BadgeCheck}
            title={t("admin.sections.verificationQueue.title")}
            actions={
              <Link to={`${PLATFORM_BUSINESS_BASE}/onboarding-verification`} className="ac-link">
                {t("admin.verificationTeaser.viewAll")}
              </Link>
            }
            flush
          >
            <div className="grid grid-cols-2 border-b border-border/60">
              <QueueStat
                label={t("admin.onboardingVerificationPage.kpi.submitted")}
                value={secondaryLoading ? "—" : formatCount(pendingOnboardingCount, lang)}
                tone={pendingOnboardingCount > 0 ? "attention" : undefined}
              />
              <QueueStat
                label={t("admin.onboardingVerificationPage.kpi.rejected")}
                value={secondaryLoading ? "—" : formatCount(onboardingMetrics?.rejected, lang)}
                divider
              />
            </div>
            {secondaryLoading ? (
              <ConsoleSkeletonRows rows={3} />
            ) : onboardingTeaser.length === 0 ? (
              <ConsoleEmpty compact icon={BadgeCheck} title={t("admin.overview.verification.empty")} />
            ) : (
              <ConsoleList>
                {onboardingTeaser.map((b) => (
                  <ConsoleListRow
                    key={b.id}
                    href={`${PLATFORM_BUSINESS_BASE}/${b.id}`}
                    leading={<ConsoleAvatar name={b.name} size="sm" />}
                    title={b.name}
                    subtitle={b.ownerEmail}
                  />
                ))}
              </ConsoleList>
            )}
          </ConsoleCard>

          {qrSummary || secondaryLoading ? (
            <ConsoleCard
              id="overview-qr"
              icon={Package}
              title={t("admin.physicalQr.title")}
              actions={
                <Link to={PLATFORM_BRANDING_ORDERS_BASE} className="ac-link">
                  {t("admin.overview.viewAll")}
                </Link>
              }
              footer={t("admin.console.overview.qrDesc")}
              flush
            >
              <div className="grid grid-cols-3">
                <QueueStat
                  label={t("admin.console.overview.qrReadyToFulfil")}
                  value={secondaryLoading ? "—" : formatCount(qrSummary?.readyToFulfil, lang)}
                  tone={(qrSummary?.readyToFulfil ?? 0) > 0 ? "attention" : undefined}
                />
                <QueueStat
                  label={t("admin.console.overview.qrOnHold")}
                  value={secondaryLoading ? "—" : formatCount(qrSummary?.onHold, lang)}
                  tone={(qrSummary?.onHold ?? 0) > 0 ? "failure" : undefined}
                  divider
                />
                <QueueStat
                  label={t("admin.console.overview.qrInTransit")}
                  value={secondaryLoading ? "—" : formatCount(qrSummary?.inTransit, lang)}
                  divider
                />
              </div>
            </ConsoleCard>
          ) : null}

          <ConsoleCard
            id="overview-commercial"
            icon={Sparkles}
            title={t("admin.sections.commercialIntelligence.title")}
            actions={
              <Link to={`${PLATFORM_REPORTS_BASE}/commercial`} className="ac-link">
                {t("admin.overview.viewAll")}
              </Link>
            }
            footer={t("admin.overview.commercial.desc")}
            flush
          >
            <div className="grid grid-cols-3">
              <QueueStat
                label={t("admin.overview.commercial.upgrades")}
                value={heavyLoading || !commercialSummary ? "—" : formatCount(commercialSummary.upgrades, lang)}
              />
              <QueueStat
                label={t("admin.overview.commercial.trials")}
                value={heavyLoading || !commercialSummary ? "—" : formatCount(commercialSummary.trials, lang)}
                divider
              />
              <QueueStat
                label={t("admin.overview.commercial.atRisk")}
                value={heavyLoading || !commercialSummary ? "—" : formatCount(commercialSummary.atRisk, lang)}
                tone={(commercialSummary?.atRisk ?? 0) > 0 ? "failure" : undefined}
                divider
              />
            </div>
          </ConsoleCard>
        </div>
      </section>

      {/* 5 · Audit trail */}
      <ConsoleCard
        id="overview-activity"
        title={t("admin.overview.recentActivity.title")}
        description={t("admin.overview.recentActivity.desc")}
        actions={
          <Link to={`${PLATFORM_REPORTS_BASE}/audit-logs`} className="ac-link">
            {t("admin.overview.viewAll")}
            <ArrowRight aria-hidden />
          </Link>
        }
        flush
      >
        {secondaryLoading ? (
          <ConsoleSkeletonRows rows={4} />
        ) : recentLogs.length === 0 ? (
          <ConsoleEmpty compact title={t("admin.overview.recentActivity.empty")} />
        ) : (
          <ConsoleList>
            {recentLogs.map((row, i) => (
              <ConsoleListRow
                key={`${row.action}-${row.at}-${i}`}
                leading={<ConsoleAvatar name={row.email ?? row.action} size="sm" />}
                title={humanizeAuditAction(row.action)}
                subtitle={
                  <>
                    <span className="ac-mono">{row.action}</span>
                    {row.email ? ` · ${row.email}` : ""}
                  </>
                }
                end={
                  <time dateTime={row.at} title={new Date(row.at).toLocaleString()}>
                    {formatRelative(row.at, lang)}
                  </time>
                }
              />
            ))}
          </ConsoleList>
        )}
      </ConsoleCard>
    </ConsolePage>
  );
});

function QueueStat({
  label,
  value,
  tone,
  divider = false,
}: {
  label: string;
  value: string;
  tone?: "attention" | "failure";
  divider?: boolean;
}) {
  return (
    <div className={divider ? "min-w-0 border-l border-border/60 px-4 py-4 sm:px-5" : "min-w-0 px-4 py-4 sm:px-5"}>
      <p className="flex items-center gap-1.5 text-2xl font-bold tabular-nums tracking-tight">
        {tone ? <ConsoleDot tone={tone} /> : null}
        {value}
      </p>
      <p className="mt-1 text-xs font-medium leading-snug text-muted-foreground">{label}</p>
    </div>
  );
}
