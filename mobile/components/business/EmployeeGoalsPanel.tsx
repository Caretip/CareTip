import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { GroupedList, GroupedRow } from "@/components/ui/Section";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { formatEur, formatPercent } from "@/utils/format";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";
import type { BusinessDashboardStats } from "@/types/business";

type EmployeeGoalsPanelProps = {
  stats?: BusinessDashboardStats | null;
  employeeNameById: Map<string, string>;
};

const TEASER_LIMIT = 4;

export function EmployeeGoalsPanel({ stats, employeeNameById }: EmployeeGoalsPanelProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const goals = stats?.employeeGoals ?? [];
  const teaser = goals.slice(0, TEASER_LIMIT);
  const onTrack = goals.filter((g) => (g.percent ?? 0) >= 75).length;

  if (goals.length === 0) {
    return (
      <EmptyState
        title={t("businessDashboard.noStaffGoals")}
        message={t("businessDashboard.noStaffGoalsHint")}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.pills}>
        <Text style={[styles.pill, styles.pillAccent]}>
          {t("businessDashboard.goalsOnTrack", { count: onTrack })}
        </Text>
        <Text style={styles.pill}>
          {t("businessDashboard.goalsTracked", { count: goals.length })}
        </Text>
      </View>

      {goals.length > TEASER_LIMIT ? (
        <Text style={styles.hint}>
          {t("businessDashboard.goalsTeaserHint", {
            shown: teaser.length,
            total: goals.length,
          })}
        </Text>
      ) : null}

      <GroupedList>
        {teaser.map((goal, index) => {
          const name =
            goal.name ??
            employeeNameById.get(goal.employeeId) ??
            t("businessDashboard.staffFallback");
          const percent = Math.min(100, Math.max(0, goal.percent ?? 0));

          return (
            <GroupedRow key={goal.employeeId} showDivider={index < teaser.length - 1}>
              <View style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.name}>{name}</Text>
                  <Text style={styles.amount}>
                    {formatEur(goal.currentAmount)} / {formatEur(goal.goalAmount)}
                  </Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${percent}%` }]} />
                </View>
                <Text style={styles.meta}>{formatPercent(percent)}</Text>
              </View>
            </GroupedRow>
          );
        })}
      </GroupedList>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: { gap: spacing.md },
    pills: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    pill: {
      ...typography.caption,
      color: colors.mutedForeground,
      backgroundColor: colors.secondary,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: 999,
    },
    pillAccent: {
      color: colors.primary,
      backgroundColor: colors.primarySoft,
      fontWeight: "700",
    },
    hint: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
    row: { gap: spacing.sm },
    rowTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
    },
    name: {
      ...typography.body,
      fontWeight: "700",
      color: colors.foreground,
      flex: 1,
    },
    amount: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontWeight: "600",
    },
    track: {
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.secondary,
      overflow: "hidden",
    },
    fill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    meta: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontWeight: "600",
    },
  });
}
