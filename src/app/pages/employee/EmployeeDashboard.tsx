import { motion } from "motion/react";
import { dashboardBlockMotion } from "@/lib/motionPerf";
import { lazy, useState, useEffect, useMemo, useCallback, memo } from "react";
import type { ImgHTMLAttributes } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { translateChartWeekdayLabel } from "@/lib/chartAxisLabels";
import { useRegisterPagePaintReady } from "../../lib/globalAppLoading";
import { useExtendGlobalLoaderUntilReady } from "../../lib/useExtendGlobalLoaderUntilReady";
import {
  useDashboardPageFullyLoaded,
  useDashboardRenderProbe,
} from "../../hooks/useDashboardRuntimeProfile";
import { resolveAppLoadingContextMessage } from "../../lib/appLoadingContexts";
import { runWithViewportScrollPreserved } from "../../lib/dashboardScrollStability";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import {
  Star,
  QrCode,
  Loader2,
  Sparkles,
  Settings,
  Target,
  Lock,
} from "lucide-react";
import { DashboardChartsIdleMount } from "../../components/dashboard/DashboardChartsIdleMount";
import { EmployeeDashboardEarningsChartFallback } from "./EmployeeDashboardEarningsChartFallback";

const EmployeeDashboardEarningsChart = lazy(() =>
  import("./EmployeeDashboardEarningsChart").then((mod) => ({
    default: mod.EmployeeDashboardEarningsChart,
  })),
);
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { DashboardRealtimeStatusStrip } from "../../components/dashboard/DashboardRealtimeStatusStrip";
import { DashboardRefreshIndicator } from "../../components/dashboard/DashboardRefreshIndicator";
import { EmployeeDashboardRealtimeSync } from "../../components/employee/EmployeeDashboardRealtimeSync";
import { getEmployeeProfile, ensureEmployeeSlug } from "../../lib/api";
import { useEmployeeDashboardAnalytics } from "../../hooks/useEmployeeDashboardAnalytics";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import { FeatureGate } from "../../components/subscription/FeatureGate";
import { EmployeeDashboardMetricsGrid } from "../../components/employee/EmployeeDashboardMetricsGrid";
import { DashboardAnalyticsPeriodToggle } from "../../components/dashboard/DashboardAnalyticsPeriodToggle";
import { formatEur } from "../../lib/formatEur";
import { FixPrompt } from "../../components/FixPrompt";
import { EmployeeQRCodeModal } from "../../components/employee/EmployeeQRCodeModal";
import employeeHeroWebp from "../../../../images/foremployee.webp";
import employeeHeroAvif from "../../../../images/foremployee.avif";
import { MarketingPicture } from "@/lib/marketingPicture";
import { cn } from "@/lib/utils";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { PremiumPageHero } from "../../components/premium/PremiumPageHero";
import { TracingBeam } from "@/components/ui/tracing-beam";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DashboardHeroMetricSkeleton,
} from "../../components/dashboard/DashboardAnalyticsLoader";
import { CountUpMetric } from "../../components/dashboard/CountUpMetric";
import { computeEmployeeTipStreakDays } from "../../lib/employeeFormat";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import {
  devMockEmployeeAccountSummary,
  devMockEmployeeChartSeries,
  devMockEmployeeGoalBundle,
  devMockEmployeeRating,
  devMockEmployeeSummary,
  shouldUseEmployeeDashboardDevDemo,
} from "../../lib/devAnalyticsMocks";
import { isWalkthroughDemoEmployee } from "../../lib/walkthroughDemo";

type AnalyticsTimeframe = "today" | "week" | "month";

export const EmployeeDashboard = memo(function EmployeeDashboard() {
  const { t, i18n } = useTranslation();
  const { user, authHydrated, sessionValidated, authReady, updateUser } = useRequireAuth();
  useRegisterPagePaintReady("employee-dashboard-paint");
  const location = useLocation();
  const navigate = useNavigate();

  const dashboardEnabled = user?.role === "employee" && authReady;

  const { advancedAnalyticsEnabled, hasFeature, ready: entitlementsReady } = useSubscriptionEntitlements({
    enabled: dashboardEnabled,
    role: user?.role === "employee" ? "employee" : null,
  });

  const dashboardDataReady = dashboardEnabled && entitlementsReady && sessionValidated;

  const {
    analyticsTimeframe,
    setAnalyticsTimeframe,
    displayPayload,
    displayPayloadOrLatest,
    displayMetrics,
    valuesMatchAnalyticsPeriod,
    isMetricsInitialLoad,
    isAnalyticsInitialLoad,
    isPeriodRefreshing: analyticsPeriodRefreshing,
    isPeriodSyncing,
    isMetricsSettled,
    hasVisibleMetrics,
    isAnalyticsSettled,
    hasPeriodActivity,
    metricsRefreshLastUpdatedAt,
    analyticsTimeframeLoading,
    showMetricsSkeleton,
    hasMetricsData,
    error: analyticsError,
    refreshQuiet: refreshDashboardQuiet,
    applyLiveTip,
    dataRevision,
  } = useEmployeeDashboardAnalytics(
    dashboardDataReady,
    user?.employeeId,
    sessionValidated,
    advancedAnalyticsEnabled,
  );

  const showMetricsLoading = showMetricsSkeleton;

  const [error, setError] = useState<string | null>(null);
  /** `undefined` = not loaded yet; `null` = no slug in DB */
  const [staffSlug, setStaffSlug] = useState<string | null | undefined>(undefined);
  /** Public venue slug from `/api/employees/me` for canonical tip URLs */
  const [employeeBusinessSlug, setEmployeeBusinessSlug] = useState<string | null | undefined>(undefined);
  /** Employee row id from `/api/employees/me` - must match QR `Employee.id`, not auth `User.id` */
  const [employeeRecordId, setEmployeeRecordId] = useState<string | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [generatingSlug, setGeneratingSlug] = useState(false);

  useEffect(() => {
    if (!authHydrated || !sessionValidated || !user || user.role !== "employee") return;
    let cancelled = false;
    const loadProfile = async () => {
      try {
        const p = await getEmployeeProfile();
        if (cancelled) return;
        setStaffSlug(p.slug ?? null);
        setEmployeeBusinessSlug(p.businessSlug ?? null);
        setEmployeeRecordId(p.id);
        updateUser({ avatar: p.avatar ?? undefined, name: p.name });
      } catch {
        if (cancelled) return;
        setStaffSlug(null);
        setEmployeeBusinessSlug(null);
        setEmployeeRecordId(null);
      }
    };
    void loadProfile();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profile load is independent of analytics period
  }, [authHydrated, sessionValidated, user?.id, user?.role, updateUser]);

  useEffect(() => {
    if (analyticsError) setError(analyticsError);
  }, [analyticsError]);

  const heroPayload = displayPayloadOrLatest ?? displayPayload;

  const heroAccountReady =
    heroPayload != null &&
    (typeof heroPayload.totalEarningsEur === "number" ||
      typeof heroPayload.periodAmountEur === "number");

  const useDevDemo = shouldUseEmployeeDashboardDevDemo({
    isDev: import.meta.env.DEV,
    isWalkthroughDemoAccount: isWalkthroughDemoEmployee(user),
    hasError: Boolean(error),
    accountSummaryLoaded: heroAccountReady,
    accountSummaryLoading: isMetricsInitialLoad,
    analyticsLoading: showMetricsLoading,
    totalEarningsEur: heroPayload?.totalEarningsEur ?? 0,
    totalSupporters: heroPayload?.totalSupporters ?? 0,
  });

  const devGoalBundle = useDevDemo ? devMockEmployeeGoalBundle() : null;
  const devPeriodSummary = useDevDemo ? devMockEmployeeSummary(analyticsTimeframe) : null;

  const displayCurrentMonthTotal =
    devGoalBundle?.currentMonthTotal ??
    displayPayload?.currentMonthTotal ??
    displayMetrics?.currentMonthTotal ??
    0;

  const displayAccountSummary = useDevDemo
    ? { ...devMockEmployeeAccountSummary(), loaded: true }
    : heroAccountReady && heroPayload
      ? {
          totalEarningsEur: heroPayload.totalEarningsEur ?? heroPayload.periodAmountEur ?? 0,
          totalSupporters: heroPayload.totalSupporters ?? 0,
          loaded: true,
        }
      : { totalEarningsEur: 0, totalSupporters: 0, loaded: false };

  const showHeroMetricsLoading =
    !useDevDemo && !displayAccountSummary.loaded && isMetricsInitialLoad;

  const globalLoaderCoversBoot = useExtendGlobalLoaderUntilReady(
    "employee-dashboard-metrics-boot",
    showHeroMetricsLoading,
    resolveAppLoadingContextMessage("dashboard", t),
  );
  const showHeroMetricsSkeleton = showHeroMetricsLoading && !globalLoaderCoversBoot;

  useDashboardRenderProbe("employee:EmployeeDashboard");
  useDashboardPageFullyLoaded(
    "employee",
    useDevDemo || (displayAccountSummary.loaded && !isMetricsInitialLoad),
  );

  const kpiUsable = useDevDemo || displayAccountSummary.loaded || !showHeroMetricsLoading;
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

  const chartPayload = displayPayload ?? displayPayloadOrLatest;
  const displayChartSeries = useDevDemo
    ? devMockEmployeeChartSeries(analyticsTimeframe)
    : (chartPayload?.chartSeries ?? []);
  const displayMonthlyGoal =
    devGoalBundle?.monthlyGoal ?? displayPayload?.monthlyGoal ?? displayMetrics?.monthlyGoal ?? null;
  const displayGoalProgress =
    devGoalBundle?.goal ?? displayPayload?.goalProgress ?? displayMetrics?.goalProgress ?? null;
  const businessTimezone = chartPayload?.businessTimezone ?? null;

  const periodMetrics = useMemo(() => {
    const periodTipCount =
      devPeriodSummary?.tips ?? displayMetrics?.periodTipCount ?? 0;
    const periodAmountEur =
      devPeriodSummary?.amount ?? displayMetrics?.periodAmountEur ?? 0;
    const rating = useDevDemo
      ? devMockEmployeeRating()
      : (displayPayload?.averageRating ?? displayMetrics?.averageRating ?? null);
    const ratingCount = useDevDemo
      ? 12
      : (displayPayload?.ratingCount ?? displayMetrics?.ratingCount ?? 0);
    const goalPct =
      displayGoalProgress != null
        ? displayGoalProgress.goalAmount > 0
          ? displayGoalProgress.percent ?? 0
          : 0
        : displayMonthlyGoal != null && displayMonthlyGoal > 0
          ? Math.min(100, Math.round((displayCurrentMonthTotal / displayMonthlyGoal) * 100))
          : null;
    const tipStreakDays = useDevDemo
      ? 3
      : computeEmployeeTipStreakDays(displayPayload?.tips ?? []);
    return { periodTipCount, periodAmountEur, goalPct, rating, ratingCount, tipStreakDays };
  }, [
    devPeriodSummary,
    displayMetrics,
    useDevDemo,
    displayGoalProgress,
    displayMonthlyGoal,
    displayCurrentMonthTotal,
    displayPayload?.averageRating,
    displayPayload?.ratingCount,
    displayPayload?.tips,
    displayMetrics?.averageRating,
    displayMetrics?.ratingCount,
  ]);

  const chartData = useMemo(() => {
    return displayChartSeries.map((p) => ({
      time: analyticsTimeframe === "week" ? translateChartWeekdayLabel(p.label, t) : p.label,
      amount: p.amount,
    }));
  }, [displayChartSeries, analyticsTimeframe, t, i18n.resolvedLanguage]);

  const analyticsPeriodLabel = (tf: AnalyticsTimeframe) => {
    if (tf === "today") return t("employee.period.today");
    if (tf === "week") return t("employee.period.week");
    return t("employee.period.month");
  };

  const valuesMatchPeriod = useDevDemo || valuesMatchAnalyticsPeriod;

  const periodMetricsLoading = showMetricsSkeleton || (!useDevDemo && !displayMetrics);
  const showChartLoading = isAnalyticsInitialLoad;
  const metricsSettledForPeriod = isMetricsSettled;
  const periodRefreshingLabel = t("dashboard.refresh.updating");

  const slugLoading = staffSlug === undefined;
  const hasSlug = Boolean(staffSlug);
  const qrEmployeeId = user?.employeeId ?? employeeRecordId ?? null;

  const handleQrQuickAction = useCallback(async () => {
    if (!authHydrated || !sessionValidated) return;
    if (slugLoading || generatingSlug) return;
    if (!hasSlug) {
      setGeneratingSlug(true);
      try {
        const p = await ensureEmployeeSlug();
        const s = p.slug;
        setStaffSlug(s ?? null);
        setEmployeeBusinessSlug(p.businessSlug ?? null);
        if (s) {
          setQrModalOpen(true);
        } else {
          toast.error(t("employee.dashboard.toastLinkFail"));
        }
      } catch (e) {
        logClientError("EmployeeDashboard", e);
        toast.error(toUserFriendlyMessage(e, { audience: "employee" }));
      } finally {
        setGeneratingSlug(false);
      }
      return;
    }
    setQrModalOpen(true);
  }, [
    authHydrated,
    sessionValidated,
    slugLoading,
    generatingSlug,
    hasSlug,
    t,
  ]);

  useEffect(() => {
    if (!sessionValidated || user?.role !== "employee") return;
    const params = new URLSearchParams(location.search);
    if (params.get("qr") !== "1") return;
    void handleQrQuickAction();
    params.delete("qr");
    const next = params.toString();
    navigate(next ? `${location.pathname}?${next}` : location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid URL-trigger loop
  }, [location.pathname, location.search, navigate, sessionValidated, user?.role, handleQrQuickAction]);

  if (!user) {
    return null;
  }

  if (error && !heroPayload && showMetricsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <p className="mb-2 text-sm font-medium text-destructive">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-primary hover:underline text-sm"
          >
            {t("dashboard.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(employeeUi.page, "overflow-x-hidden")}>
      <EmployeeDashboardRealtimeSync
        enabled={user?.role === "employee"}
        employeeId={user?.employeeId}
        dashboardDataReady={dashboardDataReady}
        refreshDashboardQuiet={refreshDashboardQuiet}
        applyLiveTip={applyLiveTip}
      />
      <div className={employeeUi.pageInner}>
        <PremiumPageHero className="employee-dashboard-hero mb-7 sm:mb-8 lg:mb-7">
        <DashboardHero
          stackHeroOnMobile
          hideTabs
          actionsPlacement="belowText"
          mobileAlign="left"
          className="!mb-0"
          cardClassName="border-0 bg-card shadow-none max-lg:border-0 max-lg:bg-transparent max-lg:shadow-none lg:rounded-[calc(1.75rem-3px)] lg:border-0 lg:bg-card lg:shadow-none"
          badgeClassName="normal-case border-transparent bg-transparent px-0 py-0 text-[11px] max-lg:text-[12px] font-medium tracking-normal text-muted-foreground shadow-none"
          titleClassName="max-lg:!leading-[1.05] lg:!leading-[1.08] tracking-tight max-lg:mx-0 max-lg:max-w-[20ch] max-lg:text-left lg:max-w-[13ch] lg:text-left xl:text-[2.35rem]"
          descriptionClassName="!line-clamp-2 max-w-[34ch] leading-relaxed text-muted-foreground/90 max-lg:mx-0 max-lg:text-left lg:max-w-sm"
          textColumnClassName="lg:py-2 xl:pr-6"
          badge={
            <>
              <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground/80" aria-hidden />
              <span>
                {user.name
                  ? t("employee.hero.welcomeBackNamed", { name: user.name.split(" ")[0] })
                  : t("employee.hero.welcomeBack")}
              </span>
            </>
          }
          title={
            <>
              {t("employee.hero.headlineLine1")}
              <br />
              <span className="text-foreground/85">{t("employee.hero.headlineLine2")}</span>
            </>
          }
          description={t("employee.hero.sub")}
          image={
            <motion.div
              initial={motionReady ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={motionReady ? { duration: 0.45, ease: "easeOut" } : { duration: 0 }}
              className="employee-hero-visual relative mx-auto flex w-full max-w-full flex-col items-center justify-center touch-manipulation lg:justify-self-center"
            >
              <div
                className={cn(
                  "employee-hero-chart-frame employee-hero-chart-frame--photo",
                  "dashboard-hero-media-frame relative mx-auto w-full max-w-full min-h-0 overflow-hidden",
                  "rounded-[1.75rem]",
                )}
              >
                <MarketingPicture
                  src={employeeHeroWebp}
                  webpSrc={employeeHeroWebp}
                  avifSrc={employeeHeroAvif}
                  alt=""
                  width={480}
                  height={360}
                  className="employee-hero-chart-frame__img block h-auto max-h-[min(48svh,360px)] w-full max-w-full object-contain object-center"
                  priority
                  fadeIn={false}
                  decoding="async"
                />
              </div>
            </motion.div>
          }
          imageOverlay={false}
          actions={
            <motion.div
              className="employee-hero-cta-block"
              initial={motionReady ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={
                motionReady ? { duration: 0.4, delay: 0.08, ease: "easeOut" } : { duration: 0 }
              }
            >
              <div className="employee-hero-cta-row">
                <Button
                  type="button"
                  onClick={() => void handleQrQuickAction()}
                  disabled={slugLoading || generatingSlug}
                  className={cn(employeeUi.btnPrimary, employeeUi.heroCtaBtn)}
                >
                  {generatingSlug ? (
                    <>
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      {t("employee.hero.generating")}
                    </>
                  ) : (
                    <>
                      <QrCode className="h-4 w-4 shrink-0" />
                      {t("employee.hero.myQr")}
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(employeeUi.btnSecondary, employeeUi.heroCtaBtn)}
                  asChild
                >
                  <Link to="/employee/tip-goals" className={employeeUi.heroCtaLink}>
                    <Target className="h-4 w-4 shrink-0" />
                    {t("employee.hero.setTipGoal")}
                    {entitlementsReady && !hasFeature("employeeGoals") ? (
                      <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                    ) : null}
                  </Link>
                </Button>
              </div>
              <dl
                className={cn(
                  "employee-hero-account-stats dashboard-swr-swap",
                  showHeroMetricsSkeleton && "dashboard-hero-account-stats--loading",
                  analyticsPeriodRefreshing && "dashboard-swr-swap--revalidating",
                )}
                aria-label={t("employee.hero.accountOverviewLabel")}
                aria-busy={showHeroMetricsSkeleton}
              >
                <div>
                  <dt>{t("employee.hero.statTotalEarnings")}</dt>
                  <dd>
                    {showHeroMetricsSkeleton ? (
                      <DashboardHeroMetricSkeleton variant="currency" />
                    ) : (
                      <span className="dashboard-hero-metric-value--live">
                        <CountUpMetric
                          value={displayAccountSummary.totalEarningsEur}
                          kind="eur"
                          format={(n) =>
                            n < 0.005 ? t("format.metricZeroTips") : formatEur(n)
                          }
                        />
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("employee.hero.statMonthEarnings")}</dt>
                  <dd>
                    {showHeroMetricsSkeleton ? (
                      <DashboardHeroMetricSkeleton variant="currency" />
                    ) : (
                      <span className="dashboard-hero-metric-value--live">
                        <CountUpMetric value={displayCurrentMonthTotal} kind="eur" format={formatEur} />
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("employee.hero.statTotalSupporters")}</dt>
                  <dd>
                    {showHeroMetricsSkeleton ? (
                      <DashboardHeroMetricSkeleton variant="count" />
                    ) : (
                      <span className="dashboard-hero-metric-value--live">
                        <CountUpMetric
                          value={displayAccountSummary.totalSupporters}
                          kind="integer"
                        />
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </motion.div>
          }
        />
        </PremiumPageHero>
      </div>

      <TracingBeam className={cn(employeeUi.pageInner, "employee-dashboard-body !pt-2 sm:!pt-3")}>
        <section
          className={cn(
            "employee-dashboard-analytics-intro mb-1",
            (periodMetricsLoading || analyticsPeriodRefreshing) &&
              "employee-dashboard-analytics-intro--loading",
          )}
          aria-labelledby="employee-analytics-period-heading"
          aria-busy={periodMetricsLoading || analyticsPeriodRefreshing || undefined}
        >
          <div className="employee-dashboard-analytics-intro__head">
            <div className="min-w-0 space-y-1">
              <h2
                id="employee-analytics-period-heading"
                className="text-base font-semibold tracking-tight text-foreground"
              >
                {t("employee.dashboard.analyticsSectionTitle")}
              </h2>
              <DashboardRefreshIndicator
                isRefreshing={isPeriodSyncing}
                lastUpdatedAt={metricsRefreshLastUpdatedAt}
                refreshFailed={Boolean(analyticsError && hasVisibleMetrics)}
              />
            </div>
            <DashboardRealtimeStatusStrip
              role="employee"
              isPeriodSyncing={isPeriodSyncing}
              isMetricsSettled={isMetricsSettled}
              hasPeriodActivity={hasPeriodActivity}
              hasVisibleMetrics={hasVisibleMetrics}
              statsLoadFailed={analyticsError}
            />
          </div>
          <DashboardAnalyticsPeriodToggle
            ariaLabel={t("employee.dashboard.analyticsPeriodAria")}
            value={analyticsTimeframe}
            onChange={(period) => {
              runWithViewportScrollPreserved(() => setAnalyticsTimeframe(period));
            }}
            options={(["today", "week", "month"] as const).map((period) => ({
              id: period,
              label:
                period === "today"
                  ? t("employee.earnings_today")
                  : period === "week"
                    ? t("employee.earnings_week")
                    : t("employee.earnings_month"),
              loading: analyticsTimeframeLoading === period,
            }))}
          />
        </section>

        <div className={cn(employeeUi.section, "employee-dashboard-section pb-6 pt-1")}>
          <FixPrompt
            id="profilePhoto"
            issueActive={!user.avatar}
            conditionVersion={user.avatar ? "has_photo" : "missing_photo"}
            title={t("employee.dashboard.fixPhotoTitle")}
            description={t("employee.dashboard.fixPhotoDesc")}
            actionLabel={t("employee.dashboard.fixPhotoAction")}
            actionTo="/employee/settings"
          />

          <motion.div
            {...blockMotion}
            className={cn(
              "dashboard-swr-swap",
              analyticsPeriodRefreshing && "dashboard-swr-swap--revalidating",
            )}
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <EmployeeDashboardMetricsGrid
              loading={periodMetricsLoading}
              isPeriodRefreshing={analyticsPeriodRefreshing}
              refreshingLabel={periodRefreshingLabel}
              metricsSettledForPeriod={metricsSettledForPeriod}
              metrics={periodMetrics}
              kpiReady={kpiUsable}
            />
          </motion.div>

          <FeatureGate featureKey="advancedAnalytics" role="employee" enabled={dashboardEnabled}>
          <div className="employee-dashboard-charts-band">
          <DashboardChartsIdleMount
            whenVisible
            mountSignal={`${analyticsTimeframe}-${dataRevision}`}
            fallback={<EmployeeDashboardEarningsChartFallback />}
          >
            <EmployeeDashboardEarningsChart
              showChartLoading={showChartLoading}
              chartData={chartData}
              analyticsPeriodRefreshing={analyticsPeriodRefreshing}
              chartRenderKey={`${analyticsTimeframe}-${dataRevision}-${chartData.length}`}
            />
          </DashboardChartsIdleMount>
          </div>
          </FeatureGate>
        </div>
      </TracingBeam>

      {qrEmployeeId && user.role === "employee" && (
        <EmployeeQRCodeModal
          open={qrModalOpen}
          onOpenChange={setQrModalOpen}
          employeeId={qrEmployeeId}
          employeeName={user.name ?? t("employee.dashboard.modalStaffFallback")}
          businessSlug={employeeBusinessSlug ?? undefined}
          employeeSlug={typeof staffSlug === "string" ? staffSlug : undefined}
        />
      )}
    </div>
  );
});
