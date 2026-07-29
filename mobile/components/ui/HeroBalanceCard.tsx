import { memo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { heroGradient, heroText, surface } from "@/theme/surfaces";
import { metricTextA11y, textA11y } from "@/theme/a11y";
import { spacing, typography } from "@/theme";

type HeroBalanceCardProps = {
  label: string;
  value: string;
  hint?: string;
  trend?: string;
  trendPositive?: boolean | null;
  icon?: keyof typeof Ionicons.glyphMap;
};

/**
 * Nexobank-style wallet hero — CareTip orange gradient, white typography.
 */
export const HeroBalanceCard = memo(function HeroBalanceCard({
  label,
  value,
  hint,
  trend,
  trendPositive,
  icon = "wallet",
}: HeroBalanceCardProps) {
  return (
    <LinearGradient
      colors={[...heroGradient.colors]}
      start={heroGradient.start}
      end={heroGradient.end}
      style={styles.gradient}
    >
      <View style={styles.patternA} pointerEvents="none" />
      <View style={styles.patternB} pointerEvents="none" />
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.iconWell}>
            <Ionicons name={icon} size={20} color={heroText.value} />
          </View>
          <Text style={styles.label} {...textA11y}>
            {label}
          </Text>
        </View>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit {...metricTextA11y}>
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
          <Text style={styles.hint} numberOfLines={2} {...textA11y}>
            {hint}
          </Text>
        ) : null}
      </View>
    </LinearGradient>
  );
});

const styles = StyleSheet.create({
  gradient: {
    borderRadius: surface.heroRadius,
    overflow: "hidden",
    minHeight: 152,
    ...Platform.select({
      ios: {
        shadowColor: "#C47A12",
        shadowOpacity: 0.28,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  patternA: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    top: -60,
    right: -40,
  },
  patternB: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    bottom: -30,
    left: -20,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWell: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...typography.overline,
    color: heroText.label,
    fontSize: 11,
    letterSpacing: 1,
    flex: 1,
  },
  value: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: "800",
    color: heroText.value,
    letterSpacing: -1,
  },
  trend: {
    ...typography.caption,
    color: heroText.hint,
    fontWeight: "600",
    fontSize: 13,
  },
  trendUp: {
    color: heroText.trendUp,
  },
  trendDown: {
    color: heroText.trendDown,
  },
  hint: {
    ...typography.caption,
    color: heroText.hint,
    fontSize: 13,
    lineHeight: 18,
  },
});
