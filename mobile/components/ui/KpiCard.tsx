/**
 * Premium fintech metric widgets — themed surfaces, orange accent on values/icons only.
 */

import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, surface, typography } from "@/theme";
import { metricTextA11y, textA11y } from "@/theme/a11y";

type MetricTone = "default" | "accent" | "positive" | "negative" | "neutral";

type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  trend?: string;
  trendPositive?: boolean | null;
  tone?: MetricTone;
  large?: boolean;
  accent?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "plain" | "card";
};

function toneIconColor(tone: MetricTone, colors: ColorPalette): string {
  if (tone === "accent") return colors.primary;
  if (tone === "positive") return colors.success;
  if (tone === "negative") return colors.destructive;
  return colors.mutedForeground;
}

function toneIconBg(tone: MetricTone, colors: ColorPalette): string {
  if (tone === "accent") return colors.primarySoft;
  return colors.secondary;
}

export const KpiCard = memo(function KpiCard({
  label,
  value,
  hint,
  trend,
  trendPositive,
  tone,
  large = false,
  accent = false,
  icon,
  variant = "card",
}: KpiCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const resolved: MetricTone = tone ?? (accent ? "accent" : "default");
  const isCard = variant === "card";
  const isPlain = variant === "plain";
  const isHero = large && isCard;
  const iconColor = toneIconColor(resolved, colors);
  const iconBg = toneIconBg(resolved, colors);

  if (isPlain) {
    return (
      <View style={styles.plain}>
        <View style={styles.plainHeader}>
          {icon ? (
            <Ionicons name={icon} size={15} color={iconColor} style={styles.plainIcon} />
          ) : null}
          <Text style={styles.plainLabel} numberOfLines={2} {...textA11y}>
            {label}
          </Text>
        </View>
        <Text style={styles.plainValue} numberOfLines={1} adjustsFontSizeToFit {...metricTextA11y}>
          {value}
        </Text>
        {hint ? (
          <Text style={styles.plainHint} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        isCard ? styles.tile : styles.plain,
        isHero ? styles.heroTile : isCard ? styles.gridTile : null,
        large && !isCard ? styles.heroPlain : null,
      ]}
    >
      <View style={styles.topRow}>
        {icon ? (
          <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
            <Ionicons name={icon} size={isHero ? 20 : 17} color={iconColor} />
          </View>
        ) : null}
        <Text style={[styles.label, isHero ? styles.labelHero : null]} numberOfLines={2} {...textA11y}>
          {label}
        </Text>
      </View>

      <Text
        style={[
          styles.value,
          isHero ? styles.valueHero : styles.valueGrid,
          resolved === "accent" ? styles.valueAccent : null,
          resolved === "positive" ? styles.valuePositive : null,
          resolved === "negative" ? styles.valueNegative : null,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        {...metricTextA11y}
      >
        {value}
      </Text>

      {trend ? (
        <Text
          style={[
            styles.trend,
            trendPositive === true
              ? styles.trendUp
              : trendPositive === false
                ? styles.trendDown
                : null,
          ]}
        >
          {trend}
        </Text>
      ) : null}

      {hint ? (
        <Text style={styles.hint} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

export const StatCard = memo(function StatCard(props: KpiCardProps) {
  return <KpiCard {...props} large={false} />;
});

export const MetricCard = memo(function MetricCard(props: KpiCardProps) {
  return <KpiCard {...props} />;
});

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    plain: {
      gap: spacing.xs,
      paddingVertical: spacing.sm,
      minWidth: 0,
    },
    plainHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      minHeight: 18,
    },
    plainIcon: {
      flexShrink: 0,
    },
    plainLabel: {
      ...typography.overline,
      color: colors.mutedForeground,
      flex: 1,
    },
    plainValue: {
      fontSize: 22,
      lineHeight: 26,
      fontWeight: "700",
      letterSpacing: -0.5,
      color: colors.foreground,
    },
    plainHint: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontSize: 12,
      lineHeight: 16,
      minHeight: 16,
    },
    heroPlain: {
      flexBasis: "100%",
      maxWidth: "100%",
      paddingVertical: spacing.md,
      marginBottom: spacing.sm,
    },
    tile: {
      backgroundColor: colors.secondary,
      borderRadius: surface.cardRadius,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      gap: spacing.sm,
    },
    gridTile: {
      flexGrow: 1,
      flexBasis: "47%",
      maxWidth: "48%",
      minHeight: 116,
    },
    heroTile: {
      flexBasis: "100%",
      maxWidth: "100%",
      minHeight: 132,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xl,
      gap: spacing.md,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      ...typography.overline,
      color: colors.mutedForeground,
      flex: 1,
    },
    labelHero: {
      letterSpacing: 1.1,
    },
    value: {
      color: colors.foreground,
      fontWeight: "800",
      letterSpacing: -0.8,
    },
    valueHero: {
      fontSize: 40,
      lineHeight: 44,
    },
    valueGrid: {
      fontSize: 24,
      lineHeight: 28,
      fontWeight: "700",
      letterSpacing: -0.5,
    },
    valueAccent: {
      color: colors.primary,
    },
    valuePositive: {
      color: colors.success,
    },
    valueNegative: {
      color: colors.destructive,
    },
    trend: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontWeight: "600",
      fontSize: 12,
    },
    trendUp: {
      color: colors.success,
    },
    trendDown: {
      color: colors.destructive,
    },
    hint: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontSize: 12,
      lineHeight: 17,
    },
  });
}
