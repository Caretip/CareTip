import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/hooks/useTheme";
import type { EmployeePerformanceChartRow } from "@/utils/dashboardChartData";
import { formatEur } from "@/utils/format";
import type { ColorPalette } from "@/theme/colors";
import { premiumPalette } from "@/theme/dashboardPremium";
import { spacing, typography } from "@/theme";

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

const BAR_HEIGHT = 6;

type PerformanceRowProps = {
  row: EmployeePerformanceChartRow;
  index: number;
  maxTips: number;
  isLast: boolean;
  colors: ColorPalette;
};

function PerformanceRow({ row, index, maxTips, isLast, colors }: PerformanceRowProps) {
  const styles = useMemo(() => createRowStyles(colors), [colors]);
  const progress = maxTips <= 0 ? 0 : row.tips / maxTips;
  const initial = row.name.charAt(0).toUpperCase();

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
        <Text style={styles.rank}>#{index + 1}</Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.max(progress * 100, row.tips > 0 ? 3 : 0)}%` },
          ]}
        />
      </View>
    </View>
  );
}

function createRowStyles(colors: ColorPalette) {
  return StyleSheet.create({
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
      color: premiumPalette.textPrimary,
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
      color: premiumPalette.textPrimary,
      fontSize: 15,
      letterSpacing: -0.1,
    },
    amount: {
      ...typography.caption,
      fontWeight: "600",
      color: premiumPalette.textSecondary,
      fontSize: 13,
    },
    rank: {
      ...typography.caption,
      color: premiumPalette.textMuted,
      fontWeight: "500",
      fontSize: 12,
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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

function createStyles(colors: ColorPalette) {
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
      color: premiumPalette.textMuted,
      fontSize: 11,
      letterSpacing: 0.8,
    },
    sectionSub: {
      ...typography.caption,
      color: premiumPalette.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: spacing.sm,
    },
    chartWrap: {
      width: "100%",
    },
    leader: {
      ...typography.caption,
      color: premiumPalette.textMuted,
      marginTop: spacing.md,
      fontSize: 12,
      lineHeight: 17,
    },
  });
}
