import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import { Screen } from "@/components/ui/Screen";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { Section, GroupedList, GroupedRow } from "@/components/ui/Section";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { Avatar } from "@/components/ui/Avatar";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useBusinessStats } from "@/features/business/useBusinessStats";
import { formatCount, formatEur, formatRating } from "@/utils/format";
import { friendlyErrorMessage, isPermissionError } from "@/utils/friendlyError";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";
import type { BusinessTimeframe } from "@/types/business";

export function BusinessLeaderboardScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { timeframe, setTimeframe, stats, isLoading, isRefreshing, error, refresh } =
    useBusinessStats();

  const timeframeOptions: Array<{ value: BusinessTimeframe; label: string }> = [
    { value: "week", label: t("period.week") },
    { value: "month", label: t("period.month") },
    { value: "year", label: t("period.year") },
  ];

  const rankedEmployees = useMemo(() => {
    const active = (stats?.employees ?? []).filter((e) => e.isActive !== false);
    return [...active].sort((a, b) => b.tipsTotal - a.tipsTotal).slice(0, 10);
  }, [stats?.employees]);

  const locationRankings = stats?.locationRankings?.slice(0, 5) ?? [];

  return (
    <Screen refreshing={isRefreshing} onRefresh={() => void refresh()}>
      <DetailScreenHeader
        title={t("businessInsights.leaderboardTitle")}
        subtitle={t("businessInsights.leaderboardSubtitle")}
        fallbackHref="/(app)/business/menu"
      />
      <PeriodToggle value={timeframe} options={timeframeOptions} onChange={setTimeframe} />

      {isLoading ? (
        <SkeletonListRows count={5} />
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
          <Section title={t("businessInsights.teamLeaderboard")}>
            {rankedEmployees.length === 0 ? (
              <EmptyState
                variant="generic"
                title={t("businessDashboard.noEmployees")}
                message={t("businessDashboard.noEmployeesChartHint")}
              />
            ) : (
              <GroupedList>
                {rankedEmployees.map((employee, index) => (
                  <GroupedRow
                    key={`${employee.name}-${index}`}
                    showDivider={index < rankedEmployees.length - 1}
                  >
                    <View style={styles.rowInner}>
                      <Text style={styles.rank}>{index + 1}</Text>
                      <Avatar label={employee.name} tone="brand" size={40} />
                      <View style={styles.body}>
                        <Text style={styles.name}>{employee.name}</Text>
                        <Text style={styles.meta}>
                          {t("businessDashboard.tipsCount", {
                            count: formatCount(employee.tipCount),
                          })}
                          {employee.rating != null ? ` · ★ ${formatRating(employee.rating)}` : ""}
                        </Text>
                      </View>
                      <Text style={styles.amount}>{formatEur(employee.tipsTotal)}</Text>
                    </View>
                  </GroupedRow>
                ))}
              </GroupedList>
            )}
          </Section>

          {locationRankings.length > 0 ? (
            <Section title={t("businessInsights.locationLeaderboard")}>
              <GroupedList>
                {locationRankings.map((location, index) => (
                  <GroupedRow
                    key={location.id ?? location.name}
                    showDivider={index < locationRankings.length - 1}
                  >
                    <View style={styles.rowInner}>
                      <View style={styles.body}>
                        <Text style={styles.name}>{location.name}</Text>
                        <Text style={styles.meta}>
                          {t("businessDashboard.tipsCount", {
                            count: formatCount(location.tipCount),
                          })}
                        </Text>
                      </View>
                      <Text style={styles.amount}>{formatEur(location.tipsEur)}</Text>
                    </View>
                  </GroupedRow>
                ))}
              </GroupedList>
            </Section>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
  stack: { gap: spacing["2xl"], marginTop: spacing.lg },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rank: {
    ...typography.caption,
    width: 20,
    fontWeight: "800",
    color: colors.primary,
    textAlign: "center",
  },
  body: { flex: 1, gap: 2 },
  name: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  meta: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  amount: {
    ...typography.h2,
    fontSize: 16,
    fontWeight: "800",
    color: colors.foreground,
  },
});
