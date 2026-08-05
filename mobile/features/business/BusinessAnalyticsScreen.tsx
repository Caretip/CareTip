import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { KpiCard } from "@/components/ui/KpiCard";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import { Screen } from "@/components/ui/Screen";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { Section, GroupedList } from "@/components/ui/Section";
import { AccessErrorState } from "@/components/ui/AccessErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonMetricGrid } from "@/components/ui/Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useBusinessAnalytics } from "@/features/business/useBusinessAnalytics";
import { formatCount, formatEur, formatGrowthPercent, formatPercent } from "@/utils/format";
import { openAuthenticatedBillingWeb } from "@/utils/openBillingWeb";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";
import type { BusinessTimeframe } from "@/types/business";

export function BusinessAnalyticsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    timeframe,
    setTimeframe,
    premiumTier,
    stats,
    qrAnalytics,
    isLoading,
    isRefreshing,
    error,
    refresh,
  } = useBusinessAnalytics({ includeQr: true });

  const timeframeOptions: Array<{ value: BusinessTimeframe; label: string }> = [
    { value: "week", label: t("period.week") },
    { value: "month", label: t("period.month") },
    { value: "year", label: t("period.year") },
  ];

  const topSources = qrAnalytics?.topSources?.slice(0, 5) ?? [];

  return (
    <Screen refreshing={isRefreshing} onRefresh={() => void refresh()}>
      <DetailScreenHeader
        title={t("businessInsights.analyticsTitle")}
        subtitle={t("businessInsights.analyticsSubtitle")}
        fallbackHref="/(app)/business/menu"
      />
      <PeriodToggle value={timeframe} options={timeframeOptions} onChange={setTimeframe} />

      {isLoading ? (
        <SkeletonMetricGrid />
      ) : error ? (
        <AccessErrorState
          error={error}
          fallbackMessage={t("businessInsights.loadError")}
          onRetry={() => void refresh()}
        />
      ) : (
        <View style={styles.stack}>
          <Section title={t("businessInsights.revenueSummary")}>
            <View style={styles.metricsRow}>
              <View style={styles.metricCol}>
                <KpiCard
                  variant="plain"
                  label={t("businessDashboard.totalTips")}
                  value={formatEur(stats?.totalTips)}
                  hint={t("businessDashboard.tipsThisPeriod", {
                    count: formatCount(stats?.tipCount),
                  })}
                  tone="accent"
                  icon="wallet"
                />
              </View>
              <View style={styles.metricCol}>
                <KpiCard
                  variant="plain"
                  label={t("businessDashboard.growth")}
                  value={formatGrowthPercent(stats?.growthPercent)}
                  hint={t("businessDashboard.vsPrior")}
                  icon="trending-up"
                />
              </View>
            </View>
          </Section>

          <Section title={t("businessInsights.qrAnalytics")}>
            {premiumTier ? (
              <>
                <View style={styles.metricsRow}>
                  <View style={styles.metricCol}>
                    <KpiCard
                      variant="plain"
                      label={t("businessInsights.totalScans")}
                      value={formatCount(qrAnalytics?.totalScans)}
                    />
                  </View>
                  <View style={styles.metricCol}>
                    <KpiCard
                      variant="plain"
                      label={t("businessInsights.uniqueScans")}
                      value={formatCount(qrAnalytics?.uniqueScans)}
                    />
                  </View>
                </View>
                <KpiCard
                  variant="plain"
                  label={t("businessInsights.conversionRate")}
                  value={formatPercent(qrAnalytics?.conversionRate)}
                />
                {topSources.length === 0 ? (
                  <Text style={styles.muted}>{t("businessInsights.noQrSources")}</Text>
                ) : (
                  <GroupedList>
                    {topSources.map((source, index) => (
                      <View
                        key={source.label}
                        style={[styles.sourceRow, index === 0 ? styles.sourceRowFirst : null]}
                      >
                        <Text style={styles.sourceLabel}>{source.label}</Text>
                        <Text style={styles.sourceValue}>
                          {formatCount(source.scans)} · {formatEur(source.tipsEur)}
                        </Text>
                      </View>
                    ))}
                  </GroupedList>
                )}
              </>
            ) : (
              <EmptyState
                title={t("errors.subscriptionRequiredTitle")}
                message={t("errors.subscriptionRequiredBody")}
                actionLabel={t("errors.managePlan")}
                onAction={() => void openAuthenticatedBillingWeb()}
              />
            )}
          </Section>
        </View>
      )}
    </Screen>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
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
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sourceRowFirst: {
    borderTopWidth: 0,
  },
  sourceLabel: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
    fontWeight: "500",
    letterSpacing: -0.1,
  },
  sourceValue: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  muted: {
    ...typography.caption,
    color: colors.mutedForeground,
    lineHeight: 20,
  },
});
