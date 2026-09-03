import { lazy, Suspense, useEffect, useMemo, useState, memo } from "react";
import { Link, Navigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  fetchPlatformHealth,
  fetchPlatformStats,
  fetchPlatformBusinesses,
  fetchOnboardingQueueMetrics,
  fetchPlatformSubscriptionMonitoring,
  fetchPlatformAuditLogs,
  fetchPlatformCommercialIntelligence,
  fetchPlatformAnalytics,
  type PlatformHealthResponse,
  type PlatformGlobalStats,
  type PlatformBusinessRow,
  type OnboardingQueueMetrics,
  type PlatformAnalytics,
  type PlatformSubscriptionMonitoring,
} from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { logClientError } from "../lib/clientLog";
import { PlatformStatCard } from "./platform/PlatformStatCard";
import { PlatformOverviewTeaserCard } from "./platform/PlatformOverviewTeaserCard";
import { PlatformBusinessMobileCard } from "./platform/PlatformBusinessMobileCard";
import { PlatformAdminOverviewHero } from "./platform/PlatformAdminOverviewHero";
import { DashboardChartsIdleMount } from "./dashboard/DashboardChartsIdleMount";
import { AdminDashboardAnalyticsChartsFallback } from "./AdminDashboardAnalyticsChartsFallback";
import {
  PlatformAdminAttentionAlerts,
  type PlatformAdminAlert,
} from "./platform/PlatformAdminAttentionAlerts";
import { platformUi } from "./platform/platformDashboardUi";
import {
  PLATFORM_BUSINESS_BASE,
  PLATFORM_REVENUE_BASE,
  PLATFORM_REPORTS_BASE,
  PLATFORM_SYSTEM_BASE,
} from "./platform/platformAdminNav";
import { cn } from "@/lib/utils";
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
const RECENT_ACTIVITY_LIMIT = 4;

function onboardingTeaserPriority(status: PlatformBusinessRow["onboardingVerificationStatus"]): number {
  if (status === "submitted") return 0;
  if (status === "rejected") return 1;
  return 2;
}

function computeNewBusinessesThisWeek(analytics: PlatformAnalytics | null): number {
  return (analytics?.growth ?? []).slice(-7).reduce((sum, row) => sum + row.newBusinesses, 0);
}

export const AdminDashboard = memo(function AdminDashboard() {
  const { t, i18n } = useTranslation();
  const { user, authHydrated, sessionValidated } = useAuth();
  const [health, setHealth] = useState<PlatformHealthResponse | null>(null);
  const [stats, setStats] = useState<PlatformGlobalStats | null>(null);
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [onboardingTeaser, setOnboardingTeaser] = useState<PlatformBusinessRow[]>([]);
  const [onboardingMetrics, setOnboardingMetrics] = useState<OnboardingQueueMetrics | null>(null);
  const [subscriptionMonitoring, setSubscriptionMonitoring] = useState<PlatformSubscriptionMonitoring | null>(null);
  const [commercialSummary, setCommercialSummary] = useState<{
    upgrades: number;
    trials: number;
    atRisk: number;
  } | null>(null);
  const [recentLogs, setRecentLogs] = useState<Array<{ action: string; at: string; email?: string | null }>>([]);

  /** Stage 1 — health + stats (KPI / hero). */
  const [criticalLoading, setCriticalLoading] = useState(true);
  /** Stage 2 — onboarding metrics, recent businesses, audit logs. */
  const [secondaryLoading, setSecondaryLoading] = useState(true);
  /** Stage 3 — commercial intelligence, subscriptions, 30d analytics. */
  const [heavyLoading, setHeavyLoading] = useState(true);

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

    const loadCritical = async () => {
      setCriticalLoading(true);
      try {
        const [healthRes, statsRes] = await Promise.all([
          fetchPlatformHealth().catch(() => null),
          fetchPlatformStats().catch(() => null),
        ]);
        if (cancelled) return;
        if (healthRes) setHealth(healthRes);
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
        const [onboardingRes, onboardingSubmittedRes, logsRes] = await Promise.all([
          fetchOnboardingQueueMetrics().catch(() => null),
          fetchPlatformBusinesses({
            workflow: "onboarding",
            status: "submitted",
            take: VERIFICATION_TEASER_LIMIT,
            sort: "newest",
          }).catch(() => ({ businesses: [] as PlatformBusinessRow[] })),
          fetchPlatformAuditLogs({ take: RECENT_ACTIVITY_LIMIT, skip: 0 }).catch(() => ({
            items: [],
            total: 0,
          })),
        ]);
        if (cancelled) return;

        if (onboardingRes) setOnboardingMetrics(onboardingRes);

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
          fetchPlatformAnalytics(30).catch(() => null),
          fetchPlatformSubscriptionMonitoring(30).catch(() => null),
          fetchPlatformCommercialIntelligence().catch(() => null),
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
  }, [authHydrated, sessionValidated, user?.role]);

  const activeBusinessesCount = onboardingMetrics?.approved ?? 0;
  const pendingOnboardingCount = onboardingMetrics?.submitted ?? 0;
  const newBusinessesWeek = useMemo(() => computeNewBusinessesThisWeek(analytics), [analytics]);
  const failedPaymentsToday = subscriptionMonitoring?.widgets?.failedPaymentsToday ?? 0;

  const attentionAlerts = useMemo((): PlatformAdminAlert[] => {
    const alerts: PlatformAdminAlert[] = [];

    if (health && (health.database !== "online" || health.stripe !== "online")) {
      alerts.push({
        id: "health",
        message: t("admin.overview.alerts.systemHealth"),
        href: `${PLATFORM_SYSTEM_BASE}/health`,
        severity: "critical",
      });
    }

    if (!secondaryLoading && pendingOnboardingCount > 0) {
      alerts.push({
        id: "onboarding",
        message: t("admin.overview.alerts.pendingOnboarding", { count: pendingOnboardingCount }),
        href: `${PLATFORM_BUSINESS_BASE}/onboarding-verification`,
        severity: "warning",
      });
    }

    if (!heavyLoading && failedPaymentsToday > 0) {
      alerts.push({
        id: "failed-payments",
        message: t("admin.overview.alerts.failedPaymentsToday", {
          count: failedPaymentsToday,
        }),
        href: `${PLATFORM_REVENUE_BASE}/failed-payments`,
        severity: "warning",
      });
    }

    if (!heavyLoading && (commercialSummary?.atRisk ?? 0) > 0) {
      alerts.push({
        id: "at-risk",
        message: t("admin.overview.alerts.atRiskSubscriptions", { count: commercialSummary?.atRisk ?? 0 }),
        href: `${PLATFORM_REPORTS_BASE}/commercial`,
        severity: "warning",
      });
    }

    return alerts;
  }, [
    commercialSummary?.atRisk,
    failedPaymentsToday,
    health,
    heavyLoading,
    pendingOnboardingCount,
    secondaryLoading,
    t,
  ]);

  if (!authHydrated || !sessionValidated || !user) return null;
  if (user.role !== "platform_admin") return <Navigate to="/unauthorized" replace />;

  const kpiGridBusy = criticalLoading || secondaryLoading;

  return (
    <div className={cn(platformUi.page, "platform-dashboard-overview overflow-x-hidden")}>
      <div className={cn(platformUi.pageInner, "platform-dashboard-body", platformUi.overviewSection, "pt-3 sm:pt-4")}>
        <PlatformAdminOverviewHero health={health} adminName={user.name} locale={i18n.language} />

        <PlatformAdminAttentionAlerts alerts={attentionAlerts} />

        <section aria-labelledby="platform-kpis-heading" className="platform-overview-kpis">
          <div className="mb-5 flex items-end justify-between gap-3">
            <h2 id="platform-kpis-heading" className="text-xs font-medium tracking-normal text-muted-foreground">
              {t("admin.overview.kpisTitle")}
            </h2>
          </div>
          <div className={cn(platformUi.overviewKpiGrid, kpiGridBusy && "platform-admin-stat-grid--loading")}>
            <PlatformStatCard
              label={t("admin.overview.kpi.activeBusinesses")}
              value={String(activeBusinessesCount)}
              numericValue={activeBusinessesCount}
              loading={secondaryLoading}
            />
            <PlatformStatCard
              label={t("admin.overview.kpi.staff")}
              value={String(stats?.employeesCount ?? 0)}
              numericValue={stats?.employeesCount ?? 0}
              loading={criticalLoading}
            />
            <PlatformStatCard
              label={t("admin.overview.kpi.transactions")}
              value={String(stats?.successTransactionCount ?? 0)}
              numericValue={stats?.successTransactionCount ?? 0}
              loading={criticalLoading}
            />
            <PlatformStatCard
              label={t("admin.overview.kpi.pendingOnboarding")}
              value={String(pendingOnboardingCount)}
              numericValue={pendingOnboardingCount}
              loading={secondaryLoading}
              featured={pendingOnboardingCount > 0}
            />
          </div>
        </section>

        <DashboardChartsIdleMount
          whenVisible
          fallback={<AdminDashboardAnalyticsChartsFallback chartCount={2} />}
        >
          <Suspense fallback={<AdminDashboardAnalyticsChartsFallback chartCount={2} />}>
            <PlatformOverviewSummaryCharts
              analytics={analytics}
              subscriptionMonitoring={subscriptionMonitoring}
              loading={heavyLoading}
            />
          </Suspense>
        </DashboardChartsIdleMount>

        <section aria-labelledby="platform-teasers-heading" className="platform-overview-teasers">
          <h2 id="platform-teasers-heading" className="sr-only">
            {t("admin.overview.teasersTitle")}
          </h2>
          <div className={platformUi.overviewTeaserGrid}>
            <PlatformOverviewTeaserCard
              title={t("admin.overview.businessGrowth.title")}
              viewAllHref={`${PLATFORM_BUSINESS_BASE}/all`}
              viewAllLabel={t("admin.overview.viewAll")}
              loading={criticalLoading}
              metrics={[
                { label: t("admin.overview.kpi.totalBusinesses"), value: String(stats?.businessesCount ?? 0) },
                {
                  label: t("admin.overview.businessGrowth.newThisWeek"),
                  value: heavyLoading ? "—" : String(newBusinessesWeek),
                },
                {
                  label: t("admin.overview.kpi.staff"),
                  value: String(stats?.employeesCount ?? 0),
                },
              ]}
            />

            <PlatformOverviewTeaserCard
              title={t("admin.sections.verificationQueue.title")}
              viewAllHref={`${PLATFORM_BUSINESS_BASE}/onboarding-verification`}
              viewAllLabel={t("admin.verificationTeaser.viewAll")}
              loading={secondaryLoading}
              metrics={[
                {
                  label: t("admin.onboardingVerificationPage.kpi.submitted"),
                  value: String(pendingOnboardingCount),
                },
                {
                  label: t("admin.onboardingVerificationPage.kpi.rejected"),
                  value: String(onboardingMetrics?.rejected ?? 0),
                },
              ]}
            >
              {secondaryLoading ? (
                <p className="text-sm text-muted-foreground">{t("admin.overview.verification.empty")}</p>
              ) : onboardingTeaser.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("admin.overview.verification.empty")}</p>
              ) : (
                <>
                  <ul className="hidden divide-y divide-border/60 sm:block">
                    {onboardingTeaser.map((b) => (
                      <li key={b.id}>
                        <Link
                          to={`${PLATFORM_BUSINESS_BASE}/${b.id}`}
                          className="flex items-center justify-between py-2.5 text-sm transition-colors hover:text-foreground"
                        >
                          <span className="font-medium text-foreground">{b.name}</span>
                          <span className="text-xs text-muted-foreground">{b.ownerEmail}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <div className="divide-y divide-border/60 sm:hidden">
                    {onboardingTeaser.map((b) => (
                      <PlatformBusinessMobileCard
                        key={b.id}
                        business={b}
                        className="rounded-none border-0 bg-transparent p-0 py-2.5 shadow-none"
                      />
                    ))}
                  </div>
                </>
              )}
            </PlatformOverviewTeaserCard>

            <PlatformOverviewTeaserCard
              title={t("admin.sections.commercialIntelligence.title")}
              viewAllHref={`${PLATFORM_REPORTS_BASE}/commercial`}
              viewAllLabel={t("admin.overview.viewAll")}
              loading={heavyLoading}
              metrics={
                commercialSummary
                  ? [
                      { label: t("admin.overview.commercial.upgrades"), value: String(commercialSummary.upgrades) },
                      { label: t("admin.overview.commercial.trials"), value: String(commercialSummary.trials) },
                      { label: t("admin.overview.commercial.atRisk"), value: String(commercialSummary.atRisk) },
                    ]
                  : []
              }
            />
          </div>
        </section>

        <PlatformOverviewTeaserCard
          title={t("admin.overview.recentActivity.title")}
          viewAllHref={`${PLATFORM_REPORTS_BASE}/audit-logs`}
          viewAllLabel={t("admin.overview.viewAll")}
          metrics={[]}
          loading={secondaryLoading}
          className="w-full max-w-none"
        >
          {secondaryLoading ? (
            <p className="text-sm text-muted-foreground">{t("admin.overview.recentActivity.empty")}</p>
          ) : recentLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.overview.recentActivity.empty")}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {recentLogs.map((row, i) => (
                <li
                  key={`${row.action}-${row.at}-${i}`}
                  className="flex flex-col gap-0.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-medium text-foreground">{row.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.email ? `${row.email} · ` : ""}
                    {new Date(row.at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PlatformOverviewTeaserCard>

        <p className="text-center text-xs leading-relaxed text-muted-foreground lg:text-left">
          {t("admin.overview.footerHint")}
        </p>
      </div>
    </div>
  );
});
