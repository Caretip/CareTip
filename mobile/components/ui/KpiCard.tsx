/**
 * Compact KPI metrics — plain by default (Stripe / Revolut density).
 * Use variant="card" only when a bordered tile is intentional.
 */

import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

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
  /** plain = section metric (default); card = bordered tile */
  variant?: "plain" | "card";
};

export function KpiCard({
  label,
  value,
  hint,
  trend,
  trendPositive,
  tone,
  large = false,
  accent = false,
  variant = "plain",
}: KpiCardProps) {
  const resolved: MetricTone = tone ?? (accent ? "accent" : "default");
  const isCard = variant === "card";

  return (
    <View
      style={[
        isCard ? styles.tile : styles.plain,
        large ? (isCard ? styles.largeTile : styles.largePlain) : null,
        isCard && resolved === "accent" ? styles.accent : null,
        isCard && resolved === "positive" ? styles.positive : null,
        isCard && resolved === "negative" ? styles.negative : null,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
      <Text
        style={[
          styles.value,
          large ? styles.valueLarge : null,
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
        <Text style={styles.hint} numberOfLines={1}>
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

const styles = StyleSheet.create({
  plain: {
    flexGrow: 1,
    flexBasis: "47%",
    maxWidth: "48%",
    paddingVertical: spacing.sm,
    gap: 2,
    minHeight: 64,
  },
  largePlain: {
    flexBasis: "100%",
    maxWidth: "100%",
    paddingVertical: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  tile: {
    flexGrow: 1,
    flexBasis: "47%",
    maxWidth: "48%",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    gap: 2,
    minHeight: 72,
  },
  largeTile: {
    flexBasis: "100%",
    maxWidth: "100%",
    minHeight: 88,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  accent: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  positive: {
    borderColor: "#99F6E4",
    backgroundColor: colors.successSoft,
  },
  negative: {
    borderColor: "#FECDD3",
    backgroundColor: colors.destructiveSoft,
  },
  label: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontWeight: "600",
    fontSize: 11,
  },
  value: {
    ...typography.metric,
    color: colors.foreground,
    fontSize: 22,
    lineHeight: 26,
  },
  valueLarge: {
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.6,
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
    ...typography.metadata,
    color: colors.mutedForeground,
    fontWeight: "700",
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
    fontSize: 11,
  },
});
