import { useMemo } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop, Line, Text as SvgText } from "react-native-svg";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { colors, radius, spacing, typography } from "@/theme";

export type TrendPoint = {
  label: string;
  amount: number;
};

type AreaTrendChartProps = {
  title: string;
  subtitle?: string;
  points: TrendPoint[] | null | undefined;
  loading?: boolean;
  emptyMessage?: string;
  height?: number;
};

/**
 * Tip/earnings series — one highlighted section (not nested cards).
 */
export function AreaTrendChart({
  title,
  subtitle,
  points,
  loading = false,
  emptyMessage = "No tip activity in this period yet.",
  height = 260,
}: AreaTrendChartProps) {
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = Math.min(windowWidth - spacing.xl * 4, 640);

  const series = useMemo(() => {
    if (!points || points.length === 0) return [];
    return points.map((p) => ({
      label: p.label,
      amount: Number.isFinite(p.amount) ? Math.max(0, p.amount) : 0,
    }));
  }, [points]);

  const max = Math.max(...series.map((s) => s.amount), 0);
  const hasActivity = series.some((s) => s.amount > 0);

  const padX = 8;
  const padTop = 12;
  const padBottom = 28;
  const plotH = height - padTop - padBottom;
  const plotW = chartWidth - padX * 2;

  const coords = series.map((s, i) => {
    const x = padX + (series.length <= 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
    const y = padTop + (max <= 0 ? plotH : plotH * (1 - s.amount / max));
    return { x, y, ...s };
  });

  const linePath =
    coords.length === 0
      ? ""
      : coords
          .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
          .join(" ");

  const areaPath =
    coords.length === 0
      ? ""
      : `${linePath} L ${coords[coords.length - 1]!.x.toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${coords[0]!.x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`;

  const labelIndexes =
    series.length <= 7
      ? series.map((_, i) => i)
      : [0, Math.floor((series.length - 1) / 2), series.length - 1];

  return (
    <Section title={title} highlighted>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      {loading ? (
        <Skeleton height={height} rounded="xl" />
      ) : !hasActivity ? (
        <View style={[styles.empty, { minHeight: height }]}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : (
        <View style={styles.chartWrap}>
          <Svg width={chartWidth} height={height}>
            <Defs>
              <LinearGradient id="tipFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.primary} stopOpacity={0.14} />
                <Stop offset="1" stopColor={colors.primary} stopOpacity={0.01} />
              </LinearGradient>
            </Defs>
            {[0.25, 0.5, 0.75, 1].map((t) => {
              const y = padTop + plotH * t;
              return (
                <Line
                  key={t}
                  x1={padX}
                  x2={padX + plotW}
                  y1={y}
                  y2={y}
                  stroke={colors.border}
                  strokeOpacity={0.7}
                  strokeWidth={1}
                />
              );
            })}
            <Path d={areaPath} fill="url(#tipFill)" />
            <Path d={linePath} stroke={colors.primary} strokeWidth={2} fill="none" />
            {coords.map((c, i) => (
              <Circle key={i} cx={c.x} cy={c.y} r={3} fill={colors.primary} />
            ))}
            {labelIndexes.map((i) => {
              const c = coords[i];
              if (!c) return null;
              const label = c.label.length > 6 ? c.label.slice(0, 5) : c.label;
              return (
                <SvgText
                  key={`l-${i}`}
                  x={c.x}
                  y={height - 8}
                  fill={colors.mutedForeground}
                  fontSize={10}
                  fontWeight="600"
                  textAnchor="middle"
                >
                  {label}
                </SvgText>
              );
            })}
          </Svg>
        </View>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  sectionSub: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: -spacing.sm,
  },
  chartWrap: {
    alignItems: "center",
    overflow: "hidden",
    borderRadius: radius.lg,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.caption,
    color: colors.mutedForeground,
    textAlign: "center",
  },
});
