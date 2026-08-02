import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/hooks/useTheme";
import type { EmployeePerformanceChartRow } from "@/utils/dashboardChartData";
import { formatEur } from "@/utils/format";
import type { ColorPalette } from "@/theme/colors";
import {
  premiumCardShadow,
  premiumPalette,
  premiumProgressGradient,
} from "@/theme/dashboardPremium";
import { spacing, surface, typography } from "@/theme";

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

type PerformanceRowCardProps = {
  row: EmployeePerformanceChartRow;
  index: number;
  maxTips: number;
  isLeader: boolean;
  colors: ColorPalette;
};

function PerformanceRowCard({ row, index, maxTips, isLeader, colors }: PerformanceRowCardProps) {
  const styles = useMemo(() => createRowStyles(colors), [colors]);
  const progress = maxTips <= 0 ? 0 : row.tips / maxTips;
  const initial = row.name.charAt(0).toUpperCase();

  return (
    <View style={[styles.rowCard, isLeader ? styles.rowCardLeader : null, premiumCardShadow]}>
      {isLeader ? (
        <View style={styles.leaderBadge}>
          <Text style={styles.leaderBadgeText}>Top performer</Text>
        </View>
      ) : null}
      <View style={styles.rowTop}>
        <View style={[styles.avatar, isLeader ? styles.avatarLeader : null]}>
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
        <LinearGradient
          colors={[...premiumProgressGradient.colors]}
          start={premiumProgressGradient.start}
          end={premiumProgressGradient.end}
          style={[styles.fill, { width: `${Math.max(progress * 100, row.tips > 0 ? 4 : 0)}%` }]}
        />
      </View>
    </View>
  );
}

function createRowStyles(colors: ColorPalette) {
  return StyleSheet.create({
    rowCard: {
      backgroundColor: colors.card,
      borderRadius: surface.cardRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.md,
    },
    rowCardLeader: {
      borderColor: premiumPalette.primary,
      backgroundColor: colors.card,
    },
    leaderBadge: {
      alignSelf: "flex-start",
      backgroundColor: colors.primarySoft,
      borderRadius: 999,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xxs,
    },
    leaderBadgeText: {
      ...typography.caption,
      color: colors.primary,
      fontWeight: "700",
      fontSize: 10,
      letterSpacing: 0.3,
    },
    rowTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarLeader: {
      backgroundColor: colors.primarySoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.primary,
    },
    avatarText: {
      ...typography.body,
      fontWeight: "800",
      color: colors.foreground,
      fontSize: 16,
    },
    rowMeta: {
      flex: 1,
      minWidth: 0,
      gap: spacing.xxs,
    },
    name: {
      ...typography.body,
      fontWeight: "700",
      color: colors.foreground,
      fontSize: 15,
      letterSpacing: -0.1,
    },
    amount: {
      ...typography.caption,
      fontWeight: "700",
      color: colors.primary,
      fontSize: 13,
    },
    rank: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontWeight: "600",
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
      minWidth: 4,
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
    <Skeleton height={220} rounded="xl" />
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
        <PerformanceRowCard
          key={`${row.name}-${index}`}
          row={row}
          index={index}
          maxTips={maxTips}
          isLeader={index === 0}
          colors={colors}
        />
      ))}
      {leaderMessage ? <Text style={styles.leader}>{leaderMessage}</Text> : null}
    </View>
  );

  const chartBlock = (
    <>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      {body}
    </>
  );

  return (
    <View style={styles.wrap}>
      {!hideHeader && title ? <Text style={styles.title}>{title}</Text> : null}
      {card ? <View style={[styles.cardSurface, premiumCardShadow]}>{chartBlock}</View> : chartBlock}
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.sm,
    },
    cardSurface: {
      backgroundColor: colors.card,
      borderRadius: surface.cardRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.md,
    },
    title: {
      ...typography.overline,
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 1,
    },
    sectionSub: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: spacing.xs,
    },
    chartWrap: {
      width: "100%",
      gap: spacing.md,
    },
    leader: {
      ...typography.caption,
      color: colors.mutedForeground,
      marginTop: spacing.xs,
      fontSize: 12,
    },
  });
}
