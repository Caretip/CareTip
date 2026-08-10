import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { BarChart3, LineChart, Trophy } from "@/icons/lucide";
import { useRouter } from "expo-router";
import { HeroBalanceCard } from "@/components/ui/HeroBalanceCard";
import { CompactKpiRow } from "@/components/ui/CompactKpiRow";
import { DashboardShortcutGrid } from "@/components/ui/DashboardShortcutGrid";
import { DashboardCookieConsent } from "@/components/ui/DashboardCookieConsent";
import { EmployeePerformanceChart } from "@/components/ui/EmployeePerformanceChart";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import { LayeredScreen } from "@/components/ui/LayeredScreen";
import { RemoteAvatar } from "@/components/ui/RemoteAvatar";
import { Section } from "@/components/ui/Section";
import { AccessErrorState } from "@/components/ui/AccessErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonMetricGrid } from "@/components/ui/Skeleton";
import { FadeIn } from "@/components/ui/motion";
import { CustomerFeedbackPanel } from "@/components/business/CustomerFeedbackPanel";
import { EmployeeGoalsPanel } from "@/components/business/EmployeeGoalsPanel";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useEmployeeAvatarLookup } from "@/hooks/useEmployeeAvatarLookup";
import { useBusinessDashboard } from "@/features/business/useBusinessDashboard";
import { buildEmployeePerformanceChartRows } from "@/utils/dashboardChartData";
import { formatCount, formatEur, formatGrowthPercent } from "@/utils/format";
import { openAuthenticatedBillingWeb } from "@/utils/openBillingWeb";
import { layered } from "@/theme/layered";
import { spacing } from "@/theme";
import type { BusinessTimeframe } from "@/types/business";

export function BusinessDashboardScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const {
    timeframe,
    setTimeframe,
    profile,
    premiumTier,
    stats,
    isLoading,
    isRefreshing,
    error,
    refresh,
  } = useBusinessDashboard();
  const avatarLookup = useEmployeeAvatarLookup();

  const timeframeOptions: Array<{ value: BusinessTimeframe; label: string }> = [
    { value: "week", label: t("period.week") },
    { value: "month", label: t("period.month") },
    { value: "year", label: t("period.year") },
  ];

  const businessName =
    profile?.businessName ?? profile?.name ?? user?.name ?? t("businessDashboard.venueFallback");
  const managerName = user?.name?.trim() || businessName;
  const avatarUri = user?.avatar;
  const growth = stats?.growthPercent;
  const employeeCount = stats?.employeeCount ?? profile?.employeeCount ?? 0;
  const periodTotalTips = stats?.totalTips ?? 0;
  const hasTipActivity = periodTotalTips > 0;
  const tipsToday = stats?.operationalPulse?.tipsToday;

  const employeePerformance = buildEmployeePerformanceChartRows(
    stats?.employees,
    3,
    colors,
    avatarLookup.byId,
  );
  const leader = employeePerformance[0];
  const leaderMessage =
    leader != null
      ? t("businessDashboard.chartPerformanceLeader", {
          name: leader.name,
          amount: formatEur(leader.tips),
        })
      : null;

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of stats?.employees ?? []) {
      if (employee.id) map.set(employee.id, employee.name);
    }
    return map;
  }, [stats?.employees]);

  const shortcuts = useMemo(
    () => [
      {
        id: "analytics",
        label: t("businessDashboard.shortcuts.analytics"),
        icon: BarChart3,
        onPress: () => router.push("/(app)/business/analytics"),
      },
      {
        id: "performance",
        label: t("businessDashboard.shortcuts.performance"),
        icon: LineChart,
        onPress: () => router.push("/(app)/business/performance"),
      },
      {
        id: "leaderboard",
        label: t("businessDashboard.shortcuts.leaderboard"),
        icon: Trophy,
        onPress: () => router.push("/(app)/business/leaderboard"),
      },
    ],
    [router, t],
  );

  return (
    <LayeredScreen
      eyebrow={t("businessDashboard.welcomeGreeting")}
      title={managerName}
      role={t("roles.manager")}
      subtitle={businessName}
      leading={
        <RemoteAvatar displayName={managerName} uri={avatarUri} size={44} tone="brand" />
      }
      refreshing={isRefreshing}
      onRefresh={() => void refresh()}
      headerExtra={
        <PeriodToggle
          value={timeframe}
          options={timeframeOptions}
          onChange={setTimeframe}
          variant="hero"
        />
      }
    >
      {isLoading ? (
        <SkeletonMetricGrid />
      ) : error ? (
        <AccessErrorState
          error={error}
          fallbackMessage={t("businessDashboard.loadError")}
          onRetry={() => void refresh()}
        />
      ) : (
        <View style={styles.stack}>
          <FadeIn index={0}>
            <View style={styles.heroBlock}>
              <HeroBalanceCard
                label={t("businessDashboard.totalTips")}
                value={formatEur(stats?.totalTips)}
                hint={t("businessDashboard.tipsThisPeriod", {
                  count: formatCount(stats?.tipCount),
                })}
                trend={formatGrowthPercent(growth)}
                trendPositive={
                  growth == null || !Number.isFinite(growth) || growth === 0 ? null : growth > 0
                }
                icon="wallet"
              />
              <CompactKpiRow
                items={[
                  {
                    label: t("businessDashboard.tipsToday"),
                    value: formatEur(tipsToday?.amount),
                    hint: t("businessDashboard.tipsVenueTime", {
                      count: formatCount(tipsToday?.count),
                    }),
                  },
                  {
                    label: t("businessDashboard.activeStaff"),
                    value: formatCount(employeeCount),
                    hint: t("businessDashboard.onRoster"),
                  },
                ]}
              />
              <DashboardShortcutGrid shortcuts={shortcuts} />
              <DashboardCookieConsent />
            </View>
          </FadeIn>

          <FadeIn index={1}>
            <Section
              title={t("businessDashboard.employeePerformanceTitle")}
              subtitle={t("businessDashboard.employeePerformanceDesc")}
            >
              {premiumTier ? (
                <EmployeePerformanceChart
                  title={t("businessDashboard.employeePerformanceTitle")}
                  subtitle={t("businessDashboard.employeePerformanceDesc")}
                  rows={employeePerformance}
                  employeeCount={employeeCount}
                  hasTipActivityInPeriod={hasTipActivity}
                  loading={isLoading}
                  leaderMessage={leaderMessage}
                  emptyNoEmployeesTitle={t("businessDashboard.noEmployees")}
                  emptyNoEmployeesMessage={t("businessDashboard.noEmployeesChartHint")}
                  emptyChartTitle={t("emptyState.chartTitle")}
                  emptyChartMessage={t("emptyState.chartDescription")}
                  hideHeader
                />
              ) : (
                <EmptyState
                  title={t("errors.subscriptionRequiredTitle")}
                  message={t("errors.subscriptionRequiredBody")}
                  actionLabel={t("errors.managePlan")}
                  onAction={() => void openAuthenticatedBillingWeb()}
                />
              )}
            </Section>
          </FadeIn>

          <FadeIn index={2}>
            <Section title={t("businessDashboard.employeeGoalsTitle")}>
              {premiumTier ? (
                <EmployeeGoalsPanel stats={stats} employeeNameById={employeeNameById} />
              ) : (
                <EmptyState
                  title={t("errors.subscriptionRequiredTitle")}
                  message={t("errors.subscriptionRequiredBody")}
                  actionLabel={t("errors.managePlan")}
                  onAction={() => void openAuthenticatedBillingWeb()}
                />
              )}
            </Section>
          </FadeIn>

          <FadeIn index={3}>
            <Section title={t("businessDashboard.customerFeedbackTitle")}>
              <CustomerFeedbackPanel />
            </Section>
          </FadeIn>
        </View>
      )}
    </LayeredScreen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: layered.sectionGap,
  },
  heroBlock: {
    gap: spacing.xl,
  },
});
