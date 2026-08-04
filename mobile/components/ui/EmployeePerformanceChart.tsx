import { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/hooks/useTheme";
import type { EmployeePerformanceChartRow } from "@/utils/dashboardChartData";
import { formatEur, formatPercent } from "@/utils/format";
import type { ColorPalette } from "@/theme/colors";
import { premiumPalette, dashboardTextColors } from "@/theme/dashboardPremium";
import { motion, spacing, typography } from "@/theme";

type EmployeePerformanceChartProps = {
  title: string;
  subtitle?: string;
  rows: EmployeePerformanceChartRow[];
  employeeCount: number;
  hasTipActivityInPeriod: boolean;
  loading?: boolean;
  leaderMessage?: string | null;
  emptyNoEmployeesTitle: string;
  emptyNoEmployeesMessage: string;
  emptyChartTitle: string;
  emptyChartMessage: string;
  hideHeader?: boolean;
  card?: boolean;
};

const BAR_HEIGHT = 8;

type PerformanceRowProps = {
  row: EmployeePerformanceChartRow;
  index: number;
  maxTips: number;
  isLast: boolean;
  colors: ColorPalette;
  text: ReturnType<typeof dashboardTextColors>;
};

function PerformanceRow({ row, index, maxTips, isLast, colors, text }: PerformanceRowProps) {
  const styles = useMemo(() => createRowStyles(colors, text), [colors, text]);
  const progress = maxTips <= 0 ? 0 : Math.min(1, row.tips / maxTips);
  const pct = progress * 100;
  const initial = row.name.charAt(0).toUpperCase();
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withDelay(
      index * 55,
      withTiming(Math.max(pct, row.tips > 0 ? 4 : 0), {
        duration: motion.duration.slow,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [index, pct, row.tips, width]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${width.value}%`,
  }));

  return (
    <View style={[styles.row, !isLast ? styles.rowBorder : null]}>
      <View style={styles.rowTop}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.rowMeta}>
          <Text style={styles.name} numberOfLines={1}>
            {row.name}
          </Text>
          <Text style={styles.amount}>{formatEur(row.tips)}</Text>
        </View>
        <View style={styles.rankBlock}>
          <Text style={styles.rank}>#{index + 1}</Text>
          <Text style={styles.pct}>{formatPercent(pct)}</Text>
        </View>
      </View>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ now: Math.round(pct), min: 0, max: 100 }}>
        <Animated.View style={[styles.fill, fillStyle]} />
      </View>
    </View>
  );
}

function createRowStyles(colors: ColorPalette, text: ReturnType<typeof dashboardTextColors>) {
  return StyleSheet.create({
    row: {
      paddingVertical: spacing.lg,
      gap: spacing.md,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: premiumPalette.border,
    },
    rowTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typography.body,
      fontWeight: "700",
      color: text.primary,
      fontSize: 14,
    },
    rowMeta: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    name: {
      ...typography.body,
      fontWeight: "600",
      color: text.primary,
      fontSize: 15,
      letterSpacing: -0.15,
    },
    amount: {
      ...typography.caption,
      fontWeight: "600",
      color: text.secondary,
      fontSize: 13,
      letterSpacing: -0.1,
    },
    rankBlock: {
      alignItems: "flex-end",
      gap: 2,
      minWidth: 44,
    },
    rank: {
      ...typography.caption,
      color: text.muted,
      fontWeight: "600",
      fontSize: 12,
    },
    pct: {
      ...typography.metadata,
      color: premiumPalette.primary,
      fontWeight: "700",
      fontSize: 11,
    },
    track: {
      height: BAR_HEIGHT,
      borderRadius: BAR_HEIGHT / 2,
      backgroundColor: colors.secondary,
      overflow: "hidden",
    },
    fill: {
      height: BAR_HEIGHT,
      borderRadius: BAR_HEIGHT / 2,
      minWidth: 3,
      backgroundColor: premiumPalette.primary,
    },
  });
}

export function EmployeePerformanceChart({
  title,
  subtitle,
  rows,
  employeeCount,
  hasTipActivityInPeriod,
  loading = false,
  leaderMessage,
  emptyNoEmployeesTitle,
  emptyNoEmployeesMessage,
  emptyChartTitle,
  emptyChartMessage,
  hideHeader = false,
  card = false,
}: EmployeePerformanceChartProps) {
  const { colors, isDark } = useTheme();
  const text = dashboardTextColors(isDark);
  const styles = useMemo(() => createStyles(text), [text]);
  const maxTips = useMemo(() => Math.max(...rows.map((r) => r.tips), 0), [rows]);

  const employeeChartEmpty =
    employeeCount === 0 || !hasTipActivityInPeriod || rows.length === 0;

  const body = loading ? (
    <Skeleton height={180} rounded="lg" />
  ) : employeeCount === 0 ? (
    <EmptyState
      variant="generic"
      title={emptyNoEmployeesTitle}
      message={emptyNoEmployeesMessage}
    />
  ) : employeeChartEmpty ? (
    <EmptyState variant="generic" title={emptyChartTitle} message={emptyChartMessage} />
  ) : (
    <View style={styles.chartWrap}>
      {rows.map((row, index) => (
        <PerformanceRow
          key={`${row.name}-${index}`}
          row={row}
          index={index}
          maxTips={maxTips}
          isLast={index === rows.length - 1}
          colors={colors}
          text={text}
        />
      ))}
      {leaderMessage ? <Text style={styles.leader}>{leaderMessage}</Text> : null}
    </View>
  );

  const chartBlock = (
    <>
      {!hideHeader && subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      {body}
    </>
  );

  return (
    <View style={styles.wrap}>
      {!hideHeader && title ? <Text style={styles.title}>{title}</Text> : null}
      {card ? <View style={styles.cardSurface}>{chartBlock}</View> : chartBlock}
    </View>
  );
}

function createStyles(text: ReturnType<typeof dashboardTextColors>) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.sm,
    },
    cardSurface: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: premiumPalette.border,
    },
    title: {
      ...typography.overline,
      color: text.muted,
      fontSize: 11,
      letterSpacing: 0.8,
    },
    sectionSub: {
      ...typography.caption,
      color: text.secondary,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: spacing.sm,
    },
    chartWrap: {
      width: "100%",
    },
    leader: {
      ...typography.caption,
      color: text.muted,
      marginTop: spacing.md,
      fontSize: 12,
      lineHeight: 17,
    },
  });
}
