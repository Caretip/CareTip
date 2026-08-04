import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { EmptyState } from "@/components/ui/EmptyState";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { formatEur, formatPercent } from "@/utils/format";
import type { ColorPalette } from "@/theme/colors";
import { dashboardTextColors, premiumPalette } from "@/theme/dashboardPremium";
import { spacing, typography } from "@/theme";
import type { BusinessDashboardStats } from "@/types/business";

type EmployeeGoalsPanelProps = {
  stats?: BusinessDashboardStats | null;
  employeeNameById: Map<string, string>;
};

const TEASER_LIMIT = 4;
const RING_SIZE = 44;
const RING_STROKE = 3.5;

type GoalProgressRingProps = {
  percent: number;
  trackColor: string;
  fillColor: string;
  labelColor: string;
};

function GoalProgressRing({ percent, trackColor, fillColor, labelColor }: GoalProgressRingProps) {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = circumference - (clamped / 100) * circumference;
  const center = RING_SIZE / 2;

  return (
    <View
      style={ringStyles.wrap}
      accessibilityLabel={formatPercent(clamped)}
      accessibilityRole="progressbar"
    >
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={fillColor}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${center}, ${center}`}
        />
      </Svg>
      <Text style={[ringStyles.label, { color: labelColor }]}>{Math.round(clamped)}%</Text>
    </View>
  );
}

const ringStyles = StyleSheet.create({
  wrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    position: "absolute",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});

export function EmployeeGoalsPanel({ stats, employeeNameById }: EmployeeGoalsPanelProps) {
  const { t } = useI18n();
  const { colors, isDark } = useTheme();
  const text = dashboardTextColors(isDark);
  const styles = useMemo(() => createStyles(colors, text), [colors, text]);
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
              <GoalProgressRing
                percent={percent}
                trackColor={colors.secondary}
                fillColor={premiumPalette.primary}
                labelColor={text.primary}
              />
              <View style={styles.rowBody}>
                <Text style={styles.name} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.amount}>
                  {formatEur(goal.currentAmount)} / {formatEur(goal.goalAmount)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function createStyles(colors: ColorPalette, text: ReturnType<typeof dashboardTextColors>) {
  return StyleSheet.create({
    wrap: { gap: spacing.lg },
    summary: {
      ...typography.caption,
      color: text.secondary,
      fontSize: 13,
      lineHeight: 18,
    },
    hint: {
      ...typography.caption,
      color: text.secondary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: -spacing.sm,
    },
    list: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: premiumPalette.border,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.lg,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: premiumPalette.border,
    },
    rowBody: {
      flex: 1,
      minWidth: 0,
      gap: spacing.xxs,
    },
    name: {
      ...typography.body,
      fontWeight: "600",
      color: text.primary,
      fontSize: 15,
    },
    amount: {
      ...typography.caption,
      color: text.secondary,
      fontWeight: "500",
      fontSize: 12,
    },
  });
}
