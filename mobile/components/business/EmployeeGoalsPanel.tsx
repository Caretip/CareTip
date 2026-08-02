import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { formatEur, formatPercent } from "@/utils/format";
import type { ColorPalette } from "@/theme/colors";
import { premiumPalette } from "@/theme/dashboardPremium";
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
      <Text style={styles.summary}>
        {t("businessDashboard.goalsOnTrack", { count: onTrack })}
        {" · "}
        {t("businessDashboard.goalsTracked", { count: goals.length })}
      </Text>

      {goals.length > TEASER_LIMIT ? (
        <Text style={styles.hint}>
          {t("businessDashboard.goalsTeaserHint", {
            shown: teaser.length,
            total: goals.length,
          })}
        </Text>
      ) : null}

      <View style={styles.list}>
        {teaser.map((goal, index) => {
          const name =
            goal.name ??
            employeeNameById.get(goal.employeeId) ??
            t("businessDashboard.staffFallback");
          const percent = Math.min(100, Math.max(0, goal.percent ?? 0));

          return (
            <View
              key={goal.employeeId}
              style={[styles.row, index < teaser.length - 1 ? styles.rowBorder : null]}
            >
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
          );
        })}
      </View>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: { gap: spacing.lg },
    summary: {
      ...typography.caption,
      color: premiumPalette.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    hint: {
      ...typography.caption,
      color: premiumPalette.textMuted,
      fontSize: 12,
      marginTop: -spacing.sm,
    },
    list: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: premiumPalette.border,
    },
    row: {
      paddingVertical: spacing.lg,
      gap: spacing.sm,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: premiumPalette.border,
    },
    rowTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
    },
    name: {
      ...typography.body,
      fontWeight: "600",
      color: premiumPalette.textPrimary,
      flex: 1,
      fontSize: 15,
    },
    amount: {
      ...typography.caption,
      color: premiumPalette.textSecondary,
      fontWeight: "500",
      fontSize: 12,
    },
    track: {
      height: 5,
      borderRadius: 999,
      backgroundColor: colors.secondary,
      overflow: "hidden",
    },
    fill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: premiumPalette.primary,
    },
    meta: {
      ...typography.caption,
      color: premiumPalette.textMuted,
      fontWeight: "500",
      fontSize: 11,
    },
  });
}
