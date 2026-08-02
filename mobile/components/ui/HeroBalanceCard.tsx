import { memo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { heroText, surface } from "@/theme/surfaces";
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

/** Premium wallet hero card — rich gradient, frosted icon, large amount. */
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
          <View style={styles.iconWell}>
            {Platform.OS === "ios" ? (
              <BlurView intensity={24} tint="light" style={StyleSheet.absoluteFill} />
            ) : null}
            <Ionicons name={icon} size={22} color={heroText.value} />
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
    minHeight: 176,
  },
  glowLarge: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    top: -48,
    right: -32,
  },
  glowSmall: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    bottom: -20,
    left: 24,
  },
  content: {
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing["2xl"],
    gap: spacing.md,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  iconWell: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  label: {
    ...typography.overline,
    color: heroText.label,
    fontSize: 11,
    letterSpacing: 1.4,
    flex: 1,
    fontWeight: "700",
  },
  value: {
    fontSize: 46,
    lineHeight: 50,
    fontWeight: "800",
    color: heroText.value,
    letterSpacing: -1.4,
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
