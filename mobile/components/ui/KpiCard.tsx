/**
 * Premium fintech metric widgets — white surfaces, orange accent on values/icons only.
 */

import { Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadows, spacing, typography } from "@/theme";

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

function toneIconColor(tone: MetricTone): string {
  if (tone === "accent") return colors.primary;
  if (tone === "positive") return colors.success;
  if (tone === "negative") return colors.destructive;
  return colors.mutedForeground;
}

function toneIconBg(tone: MetricTone): string {
  if (tone === "accent") return colors.primarySoft;
  return colors.secondary;
}

export function KpiCard({
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
  const resolved: MetricTone = tone ?? (accent ? "accent" : "default");
  const isCard = variant === "card";
  const isHero = large && isCard;

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
          <View style={[styles.iconWrap, { backgroundColor: toneIconBg(resolved) }]}>
            <Ionicons
              name={icon}
              size={isHero ? 20 : 17}
              color={toneIconColor(resolved)}
            />
          </View>
        ) : null}
        <Text style={[styles.label, isHero ? styles.labelHero : null]} numberOfLines={2}>
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
}

export function StatCard(props: KpiCardProps) {
  return <KpiCard {...props} large={false} />;
}

export function MetricCard(props: KpiCardProps) {
  return <KpiCard {...props} />;
}

const tileBase = {
  backgroundColor: colors.card,
  borderRadius: 22,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: colors.border,
  ...shadows.sm,
} as const;

const styles = StyleSheet.create({
  plain: {
    flexGrow: 1,
    flexBasis: "47%",
    maxWidth: "48%",
    paddingVertical: spacing.sm,
    gap: spacing.xxs,
    minHeight: 72,
  },
  heroPlain: {
    flexBasis: "100%",
    maxWidth: "100%",
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  tile: {
    ...tileBase,
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
    ...Platform.select({
      ios: shadows.md,
      android: { elevation: 4 },
      default: {},
    }),
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
    fontSize: 10,
    letterSpacing: 0.8,
    flex: 1,
  },
  labelHero: {
    fontSize: 11,
    letterSpacing: 1,
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
