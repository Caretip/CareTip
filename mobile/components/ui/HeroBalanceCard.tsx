import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { heroText } from "@/theme/surfaces";
import { premiumWalletGradient, premiumWalletShadow } from "@/theme/dashboardPremium";
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

/** Single hero KPI — elegant gradient card with restrained decoration. */
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
      colors={[...premiumWalletGradient.colors]}
      locations={[...premiumWalletGradient.locations]}
      start={premiumWalletGradient.start}
      end={premiumWalletGradient.end}
      style={[styles.gradient, premiumWalletShadow]}
    >
      <View style={styles.glowLarge} pointerEvents="none" />
      <View style={styles.glowSmall} pointerEvents="none" />
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Ionicons name={icon} size={18} color="rgba(255,255,255,0.85)" />
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
    borderRadius: 20,
    overflow: "hidden",
    minHeight: 152,
  },
  glowLarge: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    top: -40,
    right: -28,
  },
  glowSmall: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    bottom: -16,
    left: 20,
  },
  content: {
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing["2xl"],
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  label: {
    ...typography.caption,
    color: heroText.label,
    fontSize: 13,
    letterSpacing: 0.2,
    fontWeight: "600",
  },
  value: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: "700",
    color: heroText.value,
    letterSpacing: -1.2,
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
