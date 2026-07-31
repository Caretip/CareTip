import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { BarChart3, LineChart, Trophy } from "@/icons/lucide";
import { useRouter } from "expo-router";
import { HeroBalanceCard } from "@/components/ui/HeroBalanceCard";
import { DashboardShortcutGrid } from "@/components/ui/DashboardShortcutGrid";
import { EmployeePerformanceChart } from "@/components/ui/EmployeePerformanceChart";
import { KpiCard } from "@/components/ui/KpiCard";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import { LayeredScreen } from "@/components/ui/LayeredScreen";
import { Section } from "@/components/ui/Section";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonMetricGrid } from "@/components/ui/Skeleton";
import { FadeIn } from "@/components/ui/motion";
import { CustomerFeedbackPanel } from "@/components/business/CustomerFeedbackPanel";
import { EmployeeGoalsPanel } from "@/components/business/EmployeeGoalsPanel";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useBusinessDashboard } from "@/features/business/useBusinessDashboard";
import { buildEmployeePerformanceChartRows } from "@/utils/dashboardChartData";
import { formatCount, formatEur, formatGrowthPercent } from "@/utils/format";
import { friendlyErrorMessage, isPermissionError } from "@/utils/friendlyError";
import { layered } from "@/theme/layered";
import type { BusinessTimeframe } from "@/types/business";

export function BusinessDashboardScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  const { timeframe, setTimeframe, profile, stats, isLoading, isRefreshing, error, refresh } =
    useBusinessDashboard();

  const timeframeOptions: Array<{ value: BusinessTimeframe; label: string }> = [
    { value: "week", label: t("period.week") },
    { value: "month", label: t("period.month") },
    { value: "year", label: t("period.year") },
  ];

  const businessName =
    profile?.businessName ?? profile?.name ?? user?.name ?? t("businessDashboard.venueFallback");
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const growth = stats?.growthPercent;
  const employeeCount = stats?.employeeCount ?? profile?.employeeCount ?? 0;
  const periodTotalTips = stats?.totalTips ?? 0;
  const hasTipActivity = periodTotalTips > 0;
  const tipsToday = stats?.operationalPulse?.tipsToday;

  const employeePerformance = buildEmployeePerformanceChartRows(stats?.employees, 3);
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
      eyebrow={t("businessDashboard.eyebrow")}
      title={t("businessDashboard.welcome", { name: firstName })}
      subtitle={businessName}
      notificationsHref="/(app)/business/notifications"
      refreshing={isRefreshing}
      onRefresh={() => void refresh()}
      headerExtra={
        <PeriodToggle value={timeframe} options={timeframeOptions} onChange={setTimeframe} />
      }
    >
      {isLoading ? (
        <SkeletonMetricGrid />
      ) : error ? (
        isPermissionError(error) ? (
          <EmptyState
            title={t("errors.permissionTitle")}
            message={friendlyErrorMessage(error, t("errors.permissionBody"), t)}
          />
        ) : (
          <ErrorState
            message={friendlyErrorMessage(error, t("businessDashboard.loadError"), t)}
            onRetry={() => void refresh()}
          />
        )
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
              <DashboardShortcutGrid shortcuts={shortcuts} />
              <View style={styles.metricsRow}>
                <View style={styles.metricCol}>
                  <KpiCard
                    variant="plain"
                    label={t("businessDashboard.tipsToday")}
                    value={formatEur(tipsToday?.amount)}
                    hint={t("businessDashboard.tipsVenueTime", {
                      count: formatCount(tipsToday?.count),
                    })}
                    icon="today-outline"
                  />
                </View>
                <View style={styles.metricCol}>
                  <KpiCard
                    variant="plain"
                    label={t("businessDashboard.activeStaff")}
                    value={formatCount(employeeCount)}
                    hint={t("businessDashboard.onRoster")}
                    icon="people-outline"
                  />
                </View>
              </View>
            </View>
          </FadeIn>

          <FadeIn index={1}>
            <Section title={t("businessDashboard.employeePerformanceTitle")}>
              <EmployeePerformanceChart
                card
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
            </Section>
          </FadeIn>

          <FadeIn index={2}>
            <Section title={t("businessDashboard.employeeGoalsTitle")}>
              <EmployeeGoalsPanel stats={stats} employeeNameById={employeeNameById} />
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
    gap: layered.elementGap,
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: layered.elementGap,
  },
  metricCol: {
    flex: 1,
    minWidth: 0,
  },
});
