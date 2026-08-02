import { useMemo, useState } from "react";
import {
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Rect } from "react-native-svg";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/hooks/useTheme";
import type { EmployeePerformanceChartRow } from "@/utils/dashboardChartData";
import { formatEur } from "@/utils/format";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, surface, typography } from "@/theme";

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
  /** When true, omit the built-in title (parent Section provides it). */
  hideHeader?: boolean;
  /** White card surface around chart content. */
  card?: boolean;
};

const ROW_HEIGHT = 28;
const ROW_GAP = 12;
const COMPACT_BREAKPOINT = 380;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type PerformanceBarProps = {
  width: number;
  tips: number;
  maxTips: number;
  color: string;
};

function PerformanceBar({ width, tips, maxTips, color }: PerformanceBarProps) {
  const barW = maxTips <= 0 ? 0 : (tips / maxTips) * width;
  return (
    <Svg width={width} height={ROW_HEIGHT}>
      <Rect
        x={0}
        y={4}
        width={Math.max(barW, tips > 0 ? 6 : 0)}
        height={ROW_HEIGHT - 8}
        rx={6}
        ry={6}
        fill={color}
      />
    </Svg>
  );
}

/**
 * Horizontal ranking bar chart — responsive layout for narrow phone screens.
 */
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
  const { width: windowWidth } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const isCompact = windowWidth < COMPACT_BREAKPOINT;
  const chartWidth = containerWidth > 0 ? containerWidth : Math.max(windowWidth - spacing.xl * 2, 280);
  const labelWidth = isCompact ? chartWidth : clamp(chartWidth * 0.28, 64, 96);
  const amountWidth = isCompact ? 0 : clamp(chartWidth * 0.24, 52, 80);
  const plotWidth = isCompact
    ? chartWidth
    : Math.max(chartWidth - labelWidth - amountWidth - spacing.sm * 2, 48);

  const maxTips = useMemo(() => Math.max(...rows.map((r) => r.tips), 0), [rows]);
  const chartHeight = rows.length * (ROW_HEIGHT + ROW_GAP) + (leaderMessage ? spacing.xl : 0);

  const employeeChartEmpty =
    employeeCount === 0 || !hasTipActivityInPeriod || rows.length === 0;

  const handleLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - containerWidth) > 1) {
      setContainerWidth(next);
    }
  };

  const body = loading ? (
    <Skeleton height={Math.max(chartHeight, 180)} rounded="xl" />
  ) : employeeCount === 0 ? (
    <EmptyState
      variant="generic"
      title={emptyNoEmployeesTitle}
      message={emptyNoEmployeesMessage}
    />
  ) : employeeChartEmpty ? (
    <EmptyState variant="generic" title={emptyChartTitle} message={emptyChartMessage} />
  ) : (
    <View style={styles.chartWrap} onLayout={handleLayout}>
      {rows.map((row, index) => {
        const active = activeIndex === index;
        const amountLabel = formatEur(row.tips);

        if (isCompact) {
          return (
            <Pressable
              key={`${row.name}-${index}`}
              style={[styles.rowCompact, index < rows.length - 1 ? styles.rowSpacing : null]}
              onPressIn={() => setActiveIndex(index)}
              onPressOut={() => setActiveIndex(null)}
              accessibilityRole="button"
              accessibilityLabel={`${row.name} ${amountLabel}`}
            >
              <View style={styles.rowHeader}>
                <Text style={styles.nameCompact} numberOfLines={1}>
                  {row.name}
                </Text>
                {active ? (
                  <View style={styles.tooltip}>
                    <Text style={styles.tooltipText}>{amountLabel}</Text>
                  </View>
                ) : (
                  <Text style={styles.amountCompact}>{amountLabel}</Text>
                )}
              </View>
              <PerformanceBar
                width={plotWidth}
                tips={row.tips}
                maxTips={maxTips}
                color={row.color}
              />
            </Pressable>
          );
        }

        return (
          <Pressable
            key={`${row.name}-${index}`}
            style={[styles.row, index < rows.length - 1 ? styles.rowSpacing : null]}
            onPressIn={() => setActiveIndex(index)}
            onPressOut={() => setActiveIndex(null)}
            accessibilityRole="button"
            accessibilityLabel={`${row.name} ${amountLabel}`}
          >
            <Text style={[styles.name, { width: labelWidth }]} numberOfLines={1}>
              {row.name}
            </Text>
            <View style={[styles.barTrack, { width: plotWidth }]}>
              <PerformanceBar
                width={plotWidth}
                tips={row.tips}
                maxTips={maxTips}
                color={row.color}
              />
            </View>
            {active ? (
              <View style={styles.tooltip}>
                <Text style={styles.tooltipText}>{amountLabel}</Text>
              </View>
            ) : (
              <Text style={[styles.amount, { width: amountWidth }]} numberOfLines={1}>
                {amountLabel}
              </Text>
            )}
          </Pressable>
        );
      })}
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
      backgroundColor: colors.card,
      borderRadius: surface.cardRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.xl,
      gap: spacing.lg,
      ...Platform.select({
        ios: {
          shadowColor: "#0B1220",
          shadowOpacity: 0.04,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        android: { elevation: 2 },
        default: {},
      }),
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
    },
    chartWrap: {
      width: "100%",
      paddingVertical: spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    rowCompact: {
      width: "100%",
      gap: spacing.xs,
    },
    rowSpacing: {
      marginBottom: ROW_GAP,
    },
    rowHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    name: {
      ...typography.caption,
      color: colors.foreground,
      fontWeight: "600",
      flexShrink: 0,
    },
    nameCompact: {
      ...typography.caption,
      color: colors.foreground,
      fontWeight: "600",
      flex: 1,
    },
    barTrack: {
      flexShrink: 1,
      overflow: "hidden",
    },
    amount: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontWeight: "600",
      textAlign: "right",
      flexShrink: 0,
    },
    amountCompact: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontWeight: "600",
      flexShrink: 0,
    },
    tooltip: {
      backgroundColor: colors.foreground,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      flexShrink: 0,
    },
    tooltipText: {
      ...typography.caption,
      color: colors.card,
      fontWeight: "700",
    },
    leader: {
      ...typography.caption,
      color: colors.mutedForeground,
      marginTop: spacing.sm,
    },
  });
}
