import { StyleSheet, Text, View } from "react-native";
import { KpiCard } from "@/components/ui/KpiCard";
import { EmployeePerformanceChart } from "@/components/ui/EmployeePerformanceChart";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader, HeroCard } from "@/components/ui/ScreenHeader";
import { Section } from "@/components/ui/Section";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonMetricGrid } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useBusinessDashboard } from "@/features/business/useBusinessDashboard";
import { buildEmployeePerformanceChartRows } from "@/utils/dashboardChartData";
import { formatCount, formatEur, formatGrowthPercent } from "@/utils/format";
import { friendlyErrorMessage, isPermissionError } from "@/utils/friendlyError";
import { spacing } from "@/theme";
import type { BusinessTimeframe } from "@/types/business";

function growthTone(value: number | null | undefined): "positive" | "negative" | "neutral" {
  if (value == null || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

export function BusinessDashboardScreen() {
  const { t } = useI18n();
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
  const tipsToday = stats?.operationalPulse?.tipsToday;
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const growth = stats?.growthPercent;
  const employeeCount = stats?.employeeCount ?? profile?.employeeCount ?? 0;
  const periodTotalTips = stats?.totalTips ?? 0;
  const hasTipActivity = periodTotalTips > 0;

  const employeePerformance = buildEmployeePerformanceChartRows(stats?.employees, 3);
  const leader = employeePerformance[0];
  const leaderMessage =
    leader != null
      ? t("businessDashboard.chartPerformanceLeader", {
          name: leader.name,
          amount: formatEur(leader.tips),
        })
      : null;

  return (
    <Screen refreshing={isRefreshing} onRefresh={() => void refresh()}>
      <HeroCard>
        <ScreenHeader
          title={t("businessDashboard.welcome", { name: firstName })}
          subtitle={businessName}
        />
        <PeriodToggle value={timeframe} options={timeframeOptions} onChange={setTimeframe} />
      </HeroCard>

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
          <Section title={t("businessDashboard.overview")}>
            <KpiCard
              label={t("businessDashboard.totalTips")}
              value={formatEur(stats?.totalTips)}
              hint={t("businessDashboard.tipsThisPeriod", {
                count: formatCount(stats?.tipCount),
              })}
              trend={formatGrowthPercent(growth)}
              trendPositive={
                growth == null || !Number.isFinite(growth) || growth === 0 ? null : growth > 0
              }
              tone="accent"
              large
              icon="wallet"
            />
            <View style={styles.metrics}>
              <KpiCard
                label={t("businessDashboard.growth")}
                value={formatGrowthPercent(growth)}
                hint={t("businessDashboard.vsPrior")}
                tone={growthTone(growth)}
                icon="trending-up"
              />
              <KpiCard
                label={t("businessDashboard.tipsToday")}
                value={formatEur(tipsToday?.amount)}
                hint={t("businessDashboard.tipsCount", {
                  count: formatCount(tipsToday?.count),
                })}
                icon="today-outline"
              />
              <KpiCard
                label={t("businessDashboard.activeStaff")}
                value={formatCount(employeeCount)}
                hint={t("businessDashboard.onRoster")}
                icon="people-outline"
              />
            </View>
          </Section>

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
          />

          <Section title={t("businessDashboard.pulseTitle")}>
            <KpiCard
              label={t("businessDashboard.tippingReady")}
              value={`${formatCount(stats?.operationalPulse?.tippingReadyEmployees)} / ${formatCount(stats?.operationalPulse?.rosterTotal)}`}
              icon="checkmark-circle-outline"
            />
          </Section>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.xl,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    rowGap: spacing.md,
  },
});
