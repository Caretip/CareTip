import { StyleSheet, Text, View } from "react-native";
import { KpiCard } from "@/components/ui/KpiCard";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader, HeroCard } from "@/components/ui/ScreenHeader";
import { Section } from "@/components/ui/Section";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonMetricGrid } from "@/components/ui/Skeleton";
import { AreaTrendChart } from "@/components/ui/AreaTrendChart";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useEmployeeDashboard } from "@/features/employee/useEmployeeDashboard";
import { mapEmployeeChartSeries } from "@/utils/dashboardChartData";
import { formatCount, formatEur, formatRating } from "@/utils/format";
import { friendlyErrorMessage, isPermissionError } from "@/utils/friendlyError";
import { colors, spacing, typography } from "@/theme";
import type { EmployeeTimeframe } from "@/types/employee";
import { uiLocaleTag } from "@/utils/labels";
import { Divider } from "@/components/ui/Section";

export function EmployeeDashboardScreen() {
  const { t } = useI18n();
  const { user } = useAuth();
  const {
    timeframe,
    setTimeframe,
    profile,
    tips,
    isLoading,
    isTipsLoading,
    isRefreshing,
    error,
    tipsError,
    refresh,
  } = useEmployeeDashboard();

  const timeframeOptions: Array<{ value: EmployeeTimeframe; label: string }> = [
    { value: "today", label: t("period.today") },
    { value: "week", label: t("period.week") },
    { value: "month", label: t("period.month") },
  ];

  const recentTips = tips?.tips?.slice(0, 3) ?? [];
  const displayName =
    (profile?.name ?? user?.name)?.split(" ")[0] ?? profile?.name ?? user?.name ?? "there";
  const tipStreak = tips?.periodTipCount ?? 0;
  const chartPoints = mapEmployeeChartSeries(tips?.chartSeries);

  return (
    <Screen refreshing={isRefreshing} onRefresh={() => void refresh()}>
      <HeroCard>
        <ScreenHeader
          title={t("employeeDashboard.welcome", { name: displayName })}
          subtitle={`${profile?.jobTitle ? `${profile.jobTitle} · ` : ""}${profile?.businessName ?? t("businessDashboard.venueFallback")}`}
        />
        <PeriodToggle value={timeframe} options={timeframeOptions} onChange={setTimeframe} />
      </HeroCard>

      {isLoading ? (
        <SkeletonMetricGrid />
      ) : error && !profile ? (
        isPermissionError(error) ? (
          <EmptyState
            title={t("errors.permissionTitle")}
            message={friendlyErrorMessage(error, t("errors.permissionBody"), t)}
          />
        ) : (
          <ErrorState
            message={friendlyErrorMessage(error, t("employeeDashboard.loadError"), t)}
            onRetry={() => void refresh()}
          />
        )
      ) : isTipsLoading && !tips ? (
        <SkeletonMetricGrid />
      ) : tipsError && !tips ? (
        isPermissionError(tipsError) ? (
          <EmptyState
            title={t("errors.permissionTitle")}
            message={friendlyErrorMessage(tipsError, t("errors.permissionBody"), t)}
          />
        ) : (
          <ErrorState
            message={friendlyErrorMessage(tipsError, t("employeeDashboard.tipsLoadError"), t)}
            onRetry={() => void refresh()}
          />
        )
      ) : (
        <View style={styles.stack}>
          <Section title={t("businessDashboard.overview")}>
            <KpiCard
              label={t("employeeDashboard.periodEarnings")}
              value={formatEur(tips?.periodAmountEur)}
              hint={t("businessDashboard.tipsThisPeriod", {
                count: formatCount(tips?.periodTipCount),
              })}
              tone="accent"
              large
              variant="plain"
            />
            <View style={styles.metrics}>
              <KpiCard
                label={t("employeeDashboard.avgRating")}
                value={formatRating(tips?.averageRating)}
                hint={t("employeeDashboard.ratingsHint", {
                  count: formatCount(tips?.ratingCount),
                })}
                variant="plain"
              />
              <KpiCard
                label={t("employeeDashboard.tipStreak")}
                value={formatCount(tipStreak)}
                hint={t("employeeDashboard.tipsInPeriod")}
                tone="positive"
                variant="plain"
              />
              <KpiCard
                label={t("employeeDashboard.totalEarnings")}
                value={formatEur(tips?.totalEarningsEur)}
                hint={t("employeeDashboard.successfulTipsHint", {
                  count: formatCount(tips?.totalSupporters),
                })}
                variant="plain"
              />
              <KpiCard
                label={t("employeeDashboard.paidOut")}
                value={formatEur(tips?.paidOutEur)}
                hint={t("employeeDashboard.successfulPayouts")}
                variant="plain"
              />
            </View>
          </Section>

          <AreaTrendChart
            title={t("employeeDashboard.chartTitle")}
            points={chartPoints}
            loading={isTipsLoading && !tips}
            emptyMessage={t("employeeDashboard.chartEmpty")}
          />

          <Section title={t("employeeDashboard.recentTips")}>
            {recentTips.length === 0 ? (
              <Text style={styles.muted}>{t("employeeDashboard.emptyTips")}</Text>
            ) : (
              recentTips.map((tip, index) => (
                <View key={tip.id}>
                  <View style={styles.tipRow}>
                    <Text style={styles.tipAmount}>{formatEur(tip.amount)}</Text>
                    <Text style={styles.muted}>
                      {new Date(tip.createdAt).toLocaleString(uiLocaleTag())}
                      {tip.rating != null ? ` · ★ ${formatRating(tip.rating)}` : ""}
                    </Text>
                  </View>
                  {index < recentTips.length - 1 ? <Divider /> : null}
                </View>
              ))
            )}
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
  tipRow: {
    gap: spacing.xxs,
    paddingVertical: spacing.md,
  },
  tipAmount: {
    ...typography.h2,
    color: colors.foreground,
  },
  muted: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
});
