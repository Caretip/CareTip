import { Platform, StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { colors, radius, shadows, spacing, typography } from "@/theme";

/** Floating glass tab bar — routes unchanged. Pass safe-area bottom inset from layouts. */
export function buildPremiumTabScreenOptions(bottomInset = 0): {
  headerShown: boolean;
  tabBarActiveTintColor: string;
  tabBarInactiveTintColor: string;
  tabBarHideOnKeyboard: boolean;
  tabBarLabelStyle: TextStyle;
  tabBarItemStyle: ViewStyle;
  tabBarStyle: ViewStyle;
} {
  const bottom = Math.max(bottomInset, Platform.OS === "ios" ? spacing.md : spacing.lg);

  return {
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.mutedForeground,
    tabBarLabelStyle: {
      fontSize: 10,
      fontWeight: "600",
      fontFamily: typography.caption.fontFamily,
      marginTop: 2,
      letterSpacing: 0.1,
    },
    tabBarItemStyle: {
      justifyContent: "center",
      alignItems: "center",
      paddingTop: 4,
      paddingBottom: 2,
    },
    tabBarStyle: {
      position: "absolute",
      left: spacing.xl,
      right: spacing.xl,
      bottom,
      height: 64,
      borderRadius: radius["3xl"],
      backgroundColor: colors.tabBar,
      borderTopWidth: 0,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.tabBarBorder,
      paddingBottom: 6,
      paddingTop: 6,
      ...shadows.tabBar,
    },
  };
}

/** @deprecated Prefer buildPremiumTabScreenOptions(insets.bottom) */
export const premiumTabScreenOptions = buildPremiumTabScreenOptions(0);
