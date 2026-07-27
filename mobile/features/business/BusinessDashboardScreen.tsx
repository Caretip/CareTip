import { StyleSheet, Text, View } from "react-native";
import { KpiCard } from "@/components/ui/KpiCard";
import { AreaTrendChart } from "@/components/ui/AreaTrendChart";
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
import { resolveTipPerformanceChartRows } from "@/utils/dashboardChartData";
import { formatCount, formatEur, formatGrowthPercent } from "@/utils/format";
import { friendlyErrorMessage, isPermissionError } from "@/utils/friendlyError";
import { colors, spacing, typography } from "@/theme";
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

  const chartRows = resolveTipPerformanceChartRows({
    rows: stats?.dailyTipDistribution,
    timeframe,
    periodTotalTips: stats?.totalTips,
  });
  const chartPoints =
    chartRows?.map((row) => ({ label: row.dayLabel, amount: row.amount })) ?? undefined;

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
            message={friendlyErrorMessage(error, t("errors.permissionBody"))}
          />
        ) : (
          <ErrorState
            message={friendlyErrorMessage(error, t("businessDashboard.loadError"))}
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
              variant="plain"
            />
            <View style={styles.metrics}>
              <KpiCard
                label={t("businessDashboard.growth")}
                value={formatGrowthPercent(growth)}
                hint={t("businessDashboard.vsPrior")}
                tone={growthTone(growth)}
                variant="plain"
              />
              <KpiCard
                label={t("businessDashboard.tipsToday")}
                value={formatEur(tipsToday?.amount)}
                hint={t("businessDashboard.tipsCount", {
                  count: formatCount(tipsToday?.count),
                })}
                tone="accent"
                variant="plain"
              />
              <KpiCard
                label={t("businessDashboard.activeStaff")}
                value={formatCount(stats?.employeeCount ?? profile?.employeeCount)}
                hint={t("businessDashboard.onRoster")}
                variant="plain"
              />
            </View>
          </Section>

          <AreaTrendChart
            title={t("businessDashboard.chartTitle")}
            points={chartPoints}
            loading={chartRows === null && (stats?.totalTips ?? 0) > 0}
            emptyMessage={t("businessDashboard.chartEmpty")}
          />

          <Section title={t("businessDashboard.pulseTitle")} highlighted>
            <Text style={styles.pulseValue}>
              {formatCount(stats?.operationalPulse?.tippingReadyEmployees)}
              <Text style={styles.pulseMuted}>
                {" "}
                / {formatCount(stats?.operationalPulse?.rosterTotal)}
              </Text>
            </Text>
            <Text style={styles.pulseLabel}>{t("businessDashboard.tippingReady")}</Text>
          </Section>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.sm,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    rowGap: spacing.sm,
  },
  pulseValue: {
    ...typography.display,
    fontSize: 28,
    color: colors.foreground,
  },
  pulseMuted: {
    fontSize: 18,
    fontWeight: "500",
    color: colors.mutedForeground,
  },
  pulseLabel: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
});
