import { motion } from "motion/react";
import { dashboardBlockMotion, useMinWidthMedia } from "@/lib/motionPerf";
import { useState, useMemo, lazy, memo } from "react";
import { Link, Navigate } from "react-router";
import { MarketingPicture } from "@/lib/marketingPicture";
import {
  Sparkles,
} from "lucide-react";
import { CareIcon } from "@/components/icons";
import { useTranslation } from "react-i18next";
import { useBusinessPageBoot } from "../../lib/useBusinessPageBoot";
import {
  useDashboardPageFullyLoaded,
  useDashboardRenderProbe,
} from "../../hooks/useDashboardRuntimeProfile";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { DashboardRefreshIndicator } from "../../components/dashboard/DashboardRefreshIndicator";
import { DashboardRealtimeStatusStrip } from "../../components/dashboard/DashboardRealtimeStatusStrip";
import { BusinessDashboardRealtimeSync } from "../../components/business/BusinessDashboardRealtimeSync";
import { FixPrompt } from "../../components/FixPrompt";
import { BusinessStripeConnectPrompt } from "../../components/business/BusinessStripeConnectPrompt";
import { useBusinessDashboardStats } from "../../hooks/useBusinessDashboardStats";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import { useBusinessEntitlementsContext } from "../../contexts/BusinessEntitlementsContext";
import { FeatureGate } from "../../components/subscription/FeatureGate";
import { ProUpgradeCard } from "../../components/subscription/ProUpgradeCard";
import { BasicPlanStatusCard } from "../../components/business/dashboard/BasicPlanStatusCard";
import { isUnsubscribedDashboardPreview } from "../../components/business/dashboard/isUnsubscribedDashboardPreview";
import {
  DashboardHeroMetricSkeleton,
} from "../../components/dashboard/DashboardAnalyticsLoader";
import {
  DashboardStableChartSlot,
  GoalsTableLoadingShell,
} from "../../components/dashboard/DashboardSectionLoading";
import { CountUpMetric } from "../../components/dashboard/CountUpMetric";
import { DashboardAnalyticsPeriodToggle } from "../../components/dashboard/DashboardAnalyticsPeriodToggle";
import { DashboardChartsIdleMount } from "../../components/dashboard/DashboardChartsIdleMount";
import { runWithViewportScrollPreserved } from "../../lib/dashboardScrollStability";
import { formatEur } from "../../lib/formatEur";
import type {
  EmployeeGoalProgressStatus,
  GoalPeriod,
} from "../../lib/api";
import { QuickStartGuideBanner } from "../../components/business/QuickStartGuideBanner";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { cn } from "@/lib/utils";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { PremiumPageHero } from "../../components/premium/PremiumPageHero";
import { TracingBeam } from "@/components/ui/tracing-beam";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BusinessDashboardMetricsGrid } from "../../components/business/BusinessDashboardMetricsGrid";
import { RecentCustomerFeedbackPanel } from "../../components/business/RecentCustomerFeedbackPanel";
import { BusinessDashboardAnalyticsEmpty } from "../../components/business/BusinessDashboardAnalyticsEmpty";
import { businessUi } from "../../components/business/businessDashboardUi";
import { BusinessResponsiveData } from "../../components/business/BusinessResponsiveData";
import { DashboardViewAllLink } from "../../components/dashboard/DashboardViewAllLink";
import { EmployeeGoalMobileCard } from "../../components/business/businessDashboardMobileCards";

import {
  buildEmployeePerformanceChartRows,
  hasTipPerformanceChartActivity,
  resolveBusinessDashboardChartStats,
  resolveTipPerformanceChartRows,
  sumTipPerformanceTotal,
} from "../../lib/businessDashboardChartData";
import {
  resolveBusinessTimezone,
  venueLocalTodayKey,
} from "../../lib/businessVenueTime";
import { DASHBOARD_EMPLOYEE_TEASER_LIMIT } from "../../components/business/insights/TopPerformersTeaser";
import { BusinessDashboardChartsFallback } from "./BusinessDashboardChartsFallback";

const BusinessDashboardAnalyticsCharts = lazy(() =>
  import("./BusinessDashboardAnalyticsCharts").then((mod) => ({
    default: mod.BusinessDashboardAnalyticsCharts,
  })),
);
import { getAuthSessionFlags } from "../../lib/authSessionBootstrap";
import { isOnboardingCompleted } from "../../lib/onboardingProgress";
import bizzyHeroWebp from "../../../../images/finalbizzy-hero.webp";
import bizzyHeroAvif from "../../../../images/finalbizzy-hero.avif";
import { BusinessDashboardMobileHero } from "../../components/business/BusinessDashboardMobileHero";
import { BusinessDashboardHeroActions } from "../../components/business/BusinessDashboardHeroActions";

function goalStatusClass(s: EmployeeGoalProgressStatus): string {
  if (s === "achieved") return "text-[#34D399]";
  if (s === "on_track") return "text-primary";
  return "text-amber-700";
}

export const BusinessDashboard = memo(function BusinessDashboard() {
  const { t } = useTranslation();
  const goalPeriodLabels = useMemo(
    () =>
      ({
        daily: t("business.period.daily"),
        weekly: t("business.period.weekly"),
        monthly: t("business.period.monthly"),
      }) satisfies Record<GoalPeriod, string>,
    [t],
  );
  const { user, logout, isBusiness, exitImpersonation, sessionValidated, authReady } =
    useRequireAuth();

  const handleLogout = () => {
    if (user?.impersonation) {
      void exitImpersonation();
      return;
    }
    logout();
  };

  const businessEntitlements = useBusinessEntitlementsContext();
  const fallbackEntitlements = useSubscriptionEntitlements({
    enabled: user?.role === "business" && authReady && businessEntitlements == null,
    role: user?.role === "business" ? "business" : null,
  });
  const { ready: entitlementsReady, hasActiveEntitlements, advancedAnalyticsEnabled, tier } =
    businessEntitlements ?? fallbackEntitlements;
  const isPreviewMode = isUnsubscribedDashboardPreview(entitlementsReady, hasActiveEntitlements);
  const showProUpgradePromo = entitlementsReady && (tier === "basic" || isPreviewMode);
  const onboardingReviewRejected = Boolean(
    isBusiness &&
      user &&
      !user.impersonation &&
      user.onboardingVerificationStatus === "rejected",
  );

  const {
    analyticsTimeframe,
    setAnalyticsTimeframe,
    heroStats,
    analyticsTimeframeLoading,
    statsLoadFailed,
    pendingVerification,
    displayStats,
    displayMetrics,
    statsTimeframe,
    dataRevision,
    isMetricsInitialLoad,
    isGoalsInitialLoad,
    isPeriodRefreshing,
    isPeriodSyncing,
    isMetricsSettled,
    hasVisibleMetrics,
    isAnalyticsSettled,
    hasPeriodActivity,
    lastUpdatedAt,
    analyticsLoading: isAnalyticsSectionLoading,
    showStatsSkeleton,
    refreshStatsQuiet,
    retryStats,
    applyLiveTip,
  } = useBusinessDashboardStats(
    user?.role === "business" && authReady && user.hasCompletedOnboarding === true,
    sessionValidated,
    advancedAnalyticsEnabled,
  );
  const showOnboardingReviewNotice = onboardingReviewRejected;

  const [employeeGoalsExpanded, setEmployeeGoalsExpanded] = useState(true);

  const employees = displayStats?.employees;
  const activeRosterCount = useMemo(
    () =>
      (employees ?? []).filter(
        (e) => e.isActive === true && e.activationStatus === "active" && e.emailVerified === true,
      ).length,
    [employees],
  );
  /** Always from GET /api/business/me/stats — never client-side financial KPI mocks. */
  const operationalPulse =
    analyticsTimeframe === "month"
      ? (displayStats?.operationalPulse ?? heroStats?.operationalPulse)
      : (heroStats?.operationalPulse ?? displayStats?.operationalPulse);

  const hasTipActivityInPeriod = (displayMetrics?.totalTips ?? 0) > 0;

  const chartPeriodStats = useMemo(
    () => resolveBusinessDashboardChartStats(analyticsTimeframe, displayStats, statsTimeframe),
    [analyticsTimeframe, displayStats, statsTimeframe, dataRevision],
  );

  const dailyTipRows = useMemo(
    () => chartPeriodStats?.dailyTipDistribution ?? [],
    [chartPeriodStats?.dailyTipDistribution],
  );

  const tipDistributionChartData = useMemo(() => {
    const venueToday = venueLocalTodayKey(resolveBusinessTimezone());
    const venueDayOfMonth = Number(venueToday.slice(8, 10)) || undefined;
    const periodTotal =
      chartPeriodStats?.totalTips ?? displayMetrics?.totalTips ?? displayStats?.totalTips;
    const resolved = resolveTipPerformanceChartRows({
      rows: dailyTipRows,
      timeframe: analyticsTimeframe,
      t,
      periodTotalTips: periodTotal,
      venueDayOfMonth,
    });
    // null = distribution not ready / SSOT mismatch — keep empty so chart slot stays loading
    return resolved ?? [];
  }, [
    dailyTipRows,
    analyticsTimeframe,
    t,
    chartPeriodStats?.totalTips,
    displayMetrics?.totalTips,
    displayStats?.totalTips,
  ]);

  const tipDistributionTotal = useMemo(
    () => sumTipPerformanceTotal(tipDistributionChartData),
    [tipDistributionChartData],
  );

  const chartAwaitingDistribution =
    (Number(chartPeriodStats?.totalTips ?? displayMetrics?.totalTips ?? 0) > 0 &&
      tipDistributionTotal === 0) ||
    false;

  const hasChartTipActivity = hasTipPerformanceChartActivity(
    dailyTipRows,
    chartPeriodStats?.totalTips ?? displayMetrics?.totalTips,
  );

  const employeePerformance = useMemo(
    () => buildEmployeePerformanceChartRows(chartPeriodStats?.employees ?? displayStats?.employees, 3),
    [chartPeriodStats?.employees, displayStats?.employees],
  );

  const showChartsLoading = isAnalyticsSectionLoading || chartAwaitingDistribution;

  const employeeGoalsList =
    chartPeriodStats?.employeeGoals ?? displayStats?.employeeGoals ?? [];
  const employeeGoalsTeaser = useMemo(
    () =>
      [...employeeGoalsList]
        .sort((a, b) => b.percent - a.percent)
        .slice(0, DASHBOARD_EMPLOYEE_TEASER_LIMIT),
    [employeeGoalsList],
  );
  const hasMoreGoals = employeeGoalsList.length > DASHBOARD_EMPLOYEE_TEASER_LIMIT;
  const goalsTableColumns = useMemo(
    () => [
      t("business.dashboard.tableTeamMember"),
      t("business.dashboard.tablePeriod"),
      t("business.dashboard.tableTarget"),
      t("business.dashboard.tableCurrent"),
      t("business.dashboard.tableProgress"),
      t("business.dashboard.tableStatus"),
    ],
    [t],
  );
  const employeeGoalsSummary = useMemo(() => {
    const goals = employeeGoalsList;
    if (goals.length === 0) return null;
    const onTrack = goals.filter((g) => g.status === "achieved" || g.status === "on_track").length;
    return { total: goals.length, onTrack };
  }, [employeeGoalsList]);

  const analyticsPeriodLabel = (period: "week" | "month" | "year") => {
    if (period === "week") return t("dashboard.filter_week");
    if (period === "year") return t("dashboard.filter_year");
    return t("dashboard.filter_month");
  };

  const brokenQrLinks =
    (displayStats?.employees ?? []).length > 0 &&
    (displayStats?.employees ?? []).some((e) => e.slug == null || e.slug === "");

  const metricsBootBlocking = isMetricsInitialLoad;
  const {
    showInitialSkeleton: showMetricsSkeleton,
    coveredByGlobalLoader: globalLoaderCoversBoot,
  } = useBusinessPageBoot("overview", metricsBootBlocking);

  const periodMetricsLoading = showMetricsSkeleton || !displayMetrics;
  const heroPulseLoading = !isMetricsSettled && !operationalPulse;
  const showGoalsLoading = isGoalsInitialLoad && !globalLoaderCoversBoot;
  const periodRefreshingLabel = t("dashboard.refresh.updating");
  const isLargeScreen = useMinWidthMedia(1024);

  useDashboardRenderProbe("business:BusinessDashboard");
  useDashboardPageFullyLoaded(
    "business",
    !periodMetricsLoading && isMetricsSettled && (isAnalyticsSettled || !advancedAnalyticsEnabled),
  );

  const kpiUsable =
    !periodMetricsLoading && (Boolean(displayMetrics) || hasVisibleMetrics);
  // Gate Motion on KPI usability (same commit as metrics) — avoid idle flip adding a render.
  const blockMotion = useMemo(
    () =>
      kpiUsable
        ? dashboardBlockMotion
        : ({
            initial: false as const,
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0 },
          } as const),
    [kpiUsable],
  );
  const motionReady = kpiUsable;

  /** Prefer API `employeeCount` (tipping-ready SSOT) — do not override with client roster filters. */
  const dashboardMetrics = displayMetrics;

  // ProtectedRoute guarantees user; avoid a second full-screen hold under layout chrome.
  if (!user) {
    return null;
  }

  const { onboardingStatusFromServer } = getAuthSessionFlags();
  if (
    user.role === "business" &&
    onboardingStatusFromServer &&
    !isOnboardingCompleted(user)
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <div className={cn(businessUi.page, "business-dashboard-overview overflow-x-hidden")}>
      <BusinessDashboardRealtimeSync
        enabled={authReady && user?.role === "business"}
        businessId={user?.businessId}
        refreshStatsQuiet={refreshStatsQuiet}
        applyLiveTip={applyLiveTip}
      />
      <QuickStartGuideBanner className="mb-4" />
      {statsLoadFailed && !isMetricsInitialLoad && !showStatsSkeleton && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">{statsLoadFailed}</p>
          <button
            type="button"
            onClick={retryStats}
            className="mt-2 text-primary hover:underline text-sm font-medium"
          >
            {t("dashboard.tryAgain")}
          </button>
        </div>
      )}
      {user?.impersonation && (
        <div
          className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/15 px-4 py-2.5 text-sm text-foreground"
          role="status"
        >
          <span>{t("business.dashboard.impersonationBanner")}</span>
          <button
            type="button"
            onClick={() => void exitImpersonation()}
            className="font-semibold text-foreground underline underline-offset-2"
          >
            {t("business.dashboard.exitImpersonation")}
          </button>
        </div>
      )}

      {!isLargeScreen ? (
        <div>
          <div className="business-dashboard-overview__prompts">
            <BusinessStripeConnectPrompt density="compact" />
          </div>
          <BusinessDashboardMobileHero
            welcomeName={user.name?.split(" ")[0]}
            isPreviewMode={isPreviewMode}
            heroPulseLoading={heroPulseLoading}
            operationalPulse={operationalPulse ?? null}
            isPeriodRefreshing={isPeriodRefreshing}
          />
        </div>
      ) : null}

      {isLargeScreen ? (
      <div className={businessUi.pageInner}>
        <BusinessStripeConnectPrompt density="compact" className="mb-3" />
        <PremiumPageHero personality="overview" autoHeight className="business-dashboard-hero">
        <DashboardHero
          stackHeroOnMobile
          hideTabs
          actionsPlacement="belowText"
          mobileAlign="left"
          className="business-hero-dashboard-root !mb-0"
          cardClassName="border-0 bg-transparent shadow-none max-lg:border-0 max-lg:bg-transparent max-lg:shadow-none lg:rounded-[calc(1.75rem-3px)] lg:border-0 lg:bg-transparent lg:shadow-none"
          badgeClassName="business-hero-badge normal-case border-transparent bg-transparent px-0 py-0 text-[11px] max-lg:text-[12px] font-medium tracking-normal text-muted-foreground shadow-none"
          titleClassName="business-hero-title max-lg:!leading-[1.05] lg:!leading-[1.1] tracking-tight max-lg:text-left lg:max-w-[14ch] lg:text-left xl:text-[1.875rem]"
          descriptionClassName="business-hero-description !line-clamp-2 max-w-[32ch] leading-snug max-lg:mb-0 max-lg:text-left lg:max-w-sm"
          textColumnClassName="lg:py-1 xl:pr-1"
          badge={
            <>
              <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground/80" aria-hidden />
              <span>
                {user.name
                  ? t("business.hero.welcomeBackNamed", { name: user.name.split(" ")[0] })
                  : t("business.hero.welcomeBack")}
              </span>
            </>
          }
          title={
            <>
              {t("business.hero.headlineLine1")}
              <br />
              <span className="business-hero-title">{t("business.hero.headlineLine2")}</span>            </>
          }
          description={t("business.hero.sub")}
          image={
            <motion.div
              initial={motionReady ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={motionReady ? { duration: 0.45, ease: "easeOut" } : { duration: 0 }}
              className="business-hero-visual relative flex w-full max-w-full flex-col items-center justify-center touch-manipulation max-lg:mx-auto lg:items-start lg:justify-start lg:justify-self-stretch"
            >
              <div className="business-hero-illustration-card w-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <MarketingPicture
                  src={bizzyHeroWebp}
                  webpSrc={bizzyHeroWebp}
                  avifSrc={bizzyHeroAvif}
                  alt=""
                  className="business-hero-illustration relative z-[1] block w-full max-w-[min(100%,20rem)] object-cover object-center max-lg:mx-auto lg:max-w-none lg:object-left"
                  priority
                  loading="eager"
                  fetchPriority="high"
                  fadeIn={false}
                  decoding="sync"
                />
              </div>
            </motion.div>
          }
          imageOverlay={false}
          actions={
            <motion.div
              className="business-hero-cta-block"
              initial={motionReady ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={
                motionReady ? { duration: 0.4, delay: 0.08, ease: "easeOut" } : { duration: 0 }
              }
            >
              <BusinessDashboardHeroActions
                isPreviewMode={isPreviewMode}
                buttonClassName="min-w-0 max-lg:w-full"
                secondaryButtonClassName="min-w-0 max-lg:w-full"
              />
              <dl
                className={cn(
                  "business-hero-account-stats dashboard-swr-swap",
                  heroPulseLoading && "dashboard-hero-account-stats--loading",
                  isPeriodRefreshing && "dashboard-swr-swap--revalidating",
                )}
                aria-label={t("business.hero.pulse.sectionLabel")}
                aria-busy={heroPulseLoading}
              >
                <div>
                  <dt>{t("business.hero.pulse.lastHour")}</dt>
                  <dd>
                    {heroPulseLoading ? (
                      <DashboardHeroMetricSkeleton variant="pulse" />
                    ) : operationalPulse ? (
                      <>
                        <span className="dashboard-hero-metric-value--live">
                          <CountUpMetric
                            value={operationalPulse.tipsLast60m.count}
                            kind="integer"
                            format={(n) => {
                              const count = Math.round(n);
                              return count === 0
                                ? t("format.metricZeroTips")
                                : t("business.hero.pulse.tipsCount", { count });
                            }}
                          />
                        </span>
                        {operationalPulse.tipsLast60m.count > 0 ? (
                          <span className="business-hero-pulse-subline dashboard-hero-metric-value--live text-muted-foreground/90">
                            <CountUpMetric
                              value={operationalPulse.tipsLast60m.amount}
                              kind="eur"
                              format={(n) =>
                                t("business.hero.pulse.volume", { amount: formatEur(n) })
                              }
                            />
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="block">{t("format.noDataYet")}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("business.hero.pulse.today")}</dt>
                  <dd>
                    {heroPulseLoading ? (
                      <DashboardHeroMetricSkeleton variant="pulse" />
                    ) : operationalPulse ? (
                      <>
                        <span className="dashboard-hero-metric-value--live">
                          <CountUpMetric
                            value={operationalPulse.tipsToday.count}
                            kind="integer"
                            format={(n) => {
                              const count = Math.round(n);
                              return count === 0
                                ? t("format.metricZeroTips")
                                : t("business.hero.pulse.tipsCount", { count });
                            }}
                          />
                        </span>
                        {operationalPulse.tipsToday.count > 0 ? (
                          <span className="business-hero-pulse-subline dashboard-hero-metric-value--live text-muted-foreground/90">
                            <CountUpMetric
                              value={operationalPulse.tipsToday.amount}
                              kind="eur"
                              format={(n) =>
                                t("business.hero.pulse.volume", { amount: formatEur(n) })
                              }
                            />
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="block">{t("format.noDataYet")}</span>
                    )}
                  </dd>
                </div>
              </dl>
            </motion.div>
          }
        />
        </PremiumPageHero>
      </div>
      ) : null}

      <TracingBeam className={cn(businessUi.pageInner, "business-dashboard-body business-dashboard-mobile-body !pt-2 sm:!pt-3")}>
        <section
          className={cn(
            "business-dashboard-analytics-intro mb-1",
            isPeriodRefreshing && !showMetricsSkeleton && "business-dashboard-analytics-intro--refreshing",
          )}
          aria-labelledby="business-analytics-period-heading"
        >
          <div className="business-dashboard-analytics-intro__head">
            <div className="min-w-0 space-y-1">
              <h2
                id="business-analytics-period-heading"
                className="text-base font-semibold tracking-tight text-foreground"
              >
                {t("business.dashboard.analyticsSectionTitle")}
              </h2>
              <DashboardRefreshIndicator
                isRefreshing={isPeriodSyncing}
                lastUpdatedAt={lastUpdatedAt}
                refreshFailed={Boolean(statsLoadFailed && hasVisibleMetrics)}
              />
            </div>
            <DashboardRealtimeStatusStrip
              role="business"
              isPeriodSyncing={isPeriodSyncing}
              isMetricsSettled={isMetricsSettled}
              hasPeriodActivity={hasPeriodActivity}
              hasVisibleMetrics={hasVisibleMetrics}
              pendingVerification={showOnboardingReviewNotice}
              statsLoadFailed={statsLoadFailed}
            />
          </div>
          <DashboardAnalyticsPeriodToggle
            ariaLabel={t("business.dashboard.analyticsPeriodAria")}
            value={analyticsTimeframe}
            onChange={(period) => {
              runWithViewportScrollPreserved(() => setAnalyticsTimeframe(period));
            }}
            options={(["week", "month", "year"] as const).map((period) => ({
              id: period,
              label: analyticsPeriodLabel(period),
              loading: analyticsTimeframeLoading === period,
            }))}
          />
        </section>

        <div className={cn(businessUi.section, "pt-1")}>
          {!isPreviewMode ? (
            <FixPrompt
              id="missingQR"
              issueActive={brokenQrLinks}
              conditionVersion={brokenQrLinks ? "employees_missing_qr" : "ok"}
              title={t("business.fixQr.title")}
              description={t("business.fixQr.description")}
              actionLabel={t("business.fixQr.action")}
              actionTo="/dashboard/qr-studio/employees"
            />
          ) : null}

          <motion.div
            {...blockMotion}
            className={cn(
              "business-dashboard-block business-dashboard-block--primary dashboard-swr-swap",
              isPeriodRefreshing && "dashboard-swr-swap--revalidating",
            )}
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <BusinessDashboardMetricsGrid
              analyticsTimeframe={analyticsTimeframe}
              metrics={dashboardMetrics}
              loading={periodMetricsLoading}
              isPeriodRefreshing={isPeriodRefreshing}
              refreshingLabel={periodRefreshingLabel}
              hasTipActivityInPeriod={hasTipActivityInPeriod}
              topPerformersCount={employeePerformance.length}
              kpiReady={kpiUsable}
            />
          </motion.div>

          {showProUpgradePromo ? (
            <motion.div
              {...blockMotion}
              transition={{ delay: 0.3 }}
              className="business-dashboard-block business-dashboard-block--primary"
            >
              <div className="dashboard-upgrade-stack">
                <BasicPlanStatusCard className="business-dashboard-panel-card w-full" />
                <ProUpgradeCard className="business-dashboard-panel-card w-full" />
              </div>
            </motion.div>
          ) : null}

          <motion.div
            {...blockMotion}
            transition={{ delay: 0.32 }}
            className="business-dashboard-block business-dashboard-block--primary"
          >
            <FeatureGate featureKey="advancedAnalytics" role="business" enabled={isBusiness}>
              <DashboardChartsIdleMount
                whenVisible
                mountSignal={`${analyticsTimeframe}-${dataRevision}`}
                fallback={<BusinessDashboardChartsFallback />}
              >
                <BusinessDashboardAnalyticsCharts
                  showChartsLoading={showChartsLoading}
                  hasTipActivityInPeriod={hasChartTipActivity}
                  tipDistributionChartData={tipDistributionChartData}
                  tipDistributionTotal={tipDistributionTotal}
                  employeePerformance={employeePerformance}
                  employeeCount={activeRosterCount}
                  analyticsTimeframe={analyticsTimeframe}
                  chartRenderKey={`${analyticsTimeframe}-${dataRevision}-${tipDistributionChartData.length}`}
                />
              </DashboardChartsIdleMount>
            </FeatureGate>
          </motion.div>

          <motion.div
            {...blockMotion}
            transition={{ delay: 0.35 }}
            className="business-dashboard-block business-dashboard-block--secondary"
          >
            <FeatureGate featureKey="employeeGoals" role="business" enabled={isBusiness}>
            <Card className={cn(businessUi.cardStatic, "business-dashboard-panel-card business-dashboard-panel-card--secondary w-full")}>
              <CardHeader className="business-dashboard-panel-card__header space-y-2.5">
                <div className="flex w-full min-w-0 items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setEmployeeGoalsExpanded((v) => !v)}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={employeeGoalsExpanded}
                  >
                    <div className={cn(businessUi.iconTileMuted, "business-dash-icon-tile--blue")}>
                      <CareIcon name="goals" size="md" />
                    </div>
                    <CardTitle className="text-base font-semibold leading-snug">{t("business.dashboard.employeeGoalsTitle")}</CardTitle>
                  </button>
                  {employeeGoalsList.length > 0 ? (
                    <DashboardViewAllLink to="/dashboard/team/employees">
                      {t("business.dashboard.viewAllGoals")}
                    </DashboardViewAllLink>
                  ) : null}
                </div>
                {employeeGoalsSummary ? (
                  <div className="business-dashboard-goals-summary" aria-label={t("business.dashboard.goalsSummaryAria")}>
                    <span className="business-dashboard-goals-pill business-dashboard-goals-pill--accent">
                      {t("business.dashboard.goalsOnTrack", { count: employeeGoalsSummary.onTrack })}
                    </span>
                    <span className="business-dashboard-goals-pill">
                      {t("business.dashboard.goalsTracked", { count: employeeGoalsSummary.total })}
                    </span>
                  </div>
                ) : null}
              </CardHeader>
              {employeeGoalsExpanded ? (
                <CardContent
                  className={cn(
                    "min-w-0 transition-opacity duration-300",
                  )}
                >
                  <DashboardStableChartSlot
                    loading={showGoalsLoading}
                    minHeightClass="min-h-[280px]"
                    contentMinHeightClass={
                      !showGoalsLoading && employeeGoalsList.length === 0 ? "min-h-0" : "min-h-[280px]"
                    }
                    skeleton={
                      <GoalsTableLoadingShell
                        label={t("dashboard.loading.goals")}
                        columnLabels={goalsTableColumns}
                      />
                    }
                  >
                    {showGoalsLoading ? null : employeeGoalsList.length === 0 ? (
                      <BusinessDashboardAnalyticsEmpty
                        variant="panel"
                        icon={<CareIcon name="goals" size="lg" className="text-muted-foreground" />}
                        title={t("business.dashboard.noStaffGoals")}
                        description={t("business.dashboard.noStaffGoalsHint")}
                      />
                    ) : (
                      <>
                        {hasMoreGoals ? (
                          <p className="mb-3 text-xs text-muted-foreground">
                            {t("business.dashboard.goalsTeaserHint", {
                              shown: employeeGoalsTeaser.length,
                              total: employeeGoalsList.length,
                            })}
                          </p>
                        ) : null}
                        <BusinessResponsiveData
                          panelClassName="border-0 bg-transparent shadow-none lg:border lg:border-neutral-200/80 lg:bg-white lg:shadow-[0_10px_36px_-14px_rgba(15,23,42,0.1)]"
                          mobile={
                            <>
                              {employeeGoalsTeaser.map((g) => (
                                <EmployeeGoalMobileCard
                                  key={g.employeeId}
                                  goal={g}
                                  periodLabel={goalPeriodLabels[g.goalPeriod]}
                                  statusLabel={t(`business.goalStatus.${g.status}`)}
                                  statusClassName={goalStatusClass(g.status)}
                                />
                              ))}
                            </>
                          }
                          desktop={
                            <table className="w-full border-collapse text-sm">
                              <thead>
                                <tr className="border-b border-border text-left text-muted-foreground">
                                  {goalsTableColumns.map((col) => (
                                    <th key={col} className="px-4 py-3 font-medium last:pr-0">
                                      {col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {employeeGoalsTeaser.map((g) => (
                                  <tr key={g.employeeId} className="border-b border-border/60 last:border-0">
                                    <td className="px-4 py-3 font-medium text-foreground">{g.name}</td>
                                    <td className="px-4 py-3 text-muted-foreground">
                                      {goalPeriodLabels[g.goalPeriod]}
                                    </td>
                                    <td className="px-4 py-3 tabular-nums">{formatEur(g.goalAmount)}</td>
                                    <td className="px-4 py-3 tabular-nums">{formatEur(g.currentAmount)}</td>
                                    <td className="px-4 py-3 tabular-nums font-medium">{g.percent}%</td>
                                    <td className={`px-4 py-3 font-medium ${goalStatusClass(g.status)}`}>
                                      {t(`business.goalStatus.${g.status}`)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          }
                        />
                      </>
                    )}
                  </DashboardStableChartSlot>
                </CardContent>
              ) : null}
            </Card>
            </FeatureGate>
          </motion.div>

          {/* Recent customer feedback */}
          <motion.div {...blockMotion} transition={{ delay: 0.55 }} className="business-dashboard-block business-dashboard-block--secondary">
            <FeatureGate featureKey="customerFeedback" role="business" enabled={isBusiness}>
              <RecentCustomerFeedbackPanel enabled={isBusiness && sessionValidated} />
            </FeatureGate>
          </motion.div>
        </div>
      </TracingBeam>
    </div>
  );
});
