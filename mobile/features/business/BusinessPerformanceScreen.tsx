import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { KpiCard } from "@/components/ui/KpiCard";
import { EmployeePerformanceChart } from "@/components/ui/EmployeePerformanceChart";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import { Screen } from "@/components/ui/Screen";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { Section } from "@/components/ui/Section";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonMetricGrid } from "@/components/ui/Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useBusinessStats } from "@/features/business/useBusinessStats";
import { buildEmployeePerformanceChartRows } from "@/utils/dashboardChartData";
import { formatCount, formatEur, formatGrowthPercent } from "@/utils/format";
import { friendlyErrorMessage, isPermissionError } from "@/utils/friendlyError";
import { spacing } from "@/theme";
import type { BusinessTimeframe } from "@/types/business";

function growthTone(value: number | null | undefined): "positive" | "negative" | "neutral" {
  if (value == null || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

export function BusinessPerformanceScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { timeframe, setTimeframe, stats, isLoading, isRefreshing, error, refresh } =
    useBusinessStats();

  const timeframeOptions: Array<{ value: BusinessTimeframe; label: string }> = [
    { value: "week", label: t("period.week") },
    { value: "month", label: t("period.month") },
    { value: "year", label: t("period.year") },
  ];

  const employeeCount = stats?.employeeCount ?? 0;
  const periodTotalTips = stats?.totalTips ?? 0;
  const employeePerformance = buildEmployeePerformanceChartRows(stats?.employees, 8, colors);
  const leader = employeePerformance[0];
  const leaderMessage =
    leader != null
      ? t("businessDashboard.chartPerformanceLeader", {
          name: leader.name,
          amount: formatEur(leader.tips),
        })
      : null;

  const goalsOnTrack = useMemo(
    () => (stats?.employeeGoals ?? []).filter((g) => (g.percent ?? 0) >= 75).length,
    [stats?.employeeGoals],
  );

  return (
    <Screen refreshing={isRefreshing} onRefresh={() => void refresh()}>
      <DetailScreenHeader
        title={t("businessInsights.performanceTitle")}
        subtitle={t("businessInsights.performanceSubtitle")}
        fallbackHref="/(app)/business/menu"
      />
      <PeriodToggle value={timeframe} options={timeframeOptions} onChange={setTimeframe} />

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
            message={friendlyErrorMessage(error, t("businessInsights.loadError"), t)}
            onRetry={() => void refresh()}
          />
        )
      ) : (
        <View style={styles.stack}>
          <Section title={t("businessInsights.teamPulse")}>
            <View style={styles.metricsRow}>
              <View style={styles.metricCol}>
                <KpiCard
                  variant="plain"
                  label={t("businessDashboard.growth")}
                  value={formatGrowthPercent(stats?.growthPercent)}
                  hint={t("businessDashboard.vsPrior")}
                  tone={growthTone(stats?.growthPercent)}
                  icon="trending-up"
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
            <View style={styles.metricsRow}>
              <View style={styles.metricCol}>
                <KpiCard
                  variant="plain"
                  label={t("businessDashboard.tippingReady")}
                  value={`${formatCount(stats?.operationalPulse?.tippingReadyEmployees)} / ${formatCount(stats?.operationalPulse?.rosterTotal)}`}
                  icon="checkmark-circle-outline"
                />
              </View>
              <View style={styles.metricCol}>
                <KpiCard
                  variant="plain"
                  label={t("businessInsights.goalsOnTrack")}
                  value={formatCount(goalsOnTrack)}
                  hint={t("businessInsights.goalsTracked", {
                    count: formatCount(stats?.employeeGoals?.length),
                  })}
                  icon="flag-outline"
                />
              </View>
            </View>
          </Section>

          <Section title={t("businessDashboard.employeePerformanceTitle")}>
            <EmployeePerformanceChart
              card
              title={t("businessDashboard.employeePerformanceTitle")}
              subtitle={t("businessDashboard.employeePerformanceDesc")}
              rows={employeePerformance}
              employeeCount={employeeCount}
              hasTipActivityInPeriod={periodTotalTips > 0}
              loading={false}
              leaderMessage={leaderMessage}
              emptyNoEmployeesTitle={t("businessDashboard.noEmployees")}
              emptyNoEmployeesMessage={t("businessDashboard.noEmployeesChartHint")}
              emptyChartTitle={t("emptyState.chartTitle")}
              emptyChartMessage={t("emptyState.chartDescription")}
              hideHeader
            />
          </Section>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.xl, marginTop: spacing.md },
  metricsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.md,
  },
  metricCol: {
    flex: 1,
    minWidth: 0,
  },
});
