import { Platform, StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import type { ColorPalette } from "./colors";
import { colors as defaultColors, spacing, typography } from "@/theme";

/** Height of the floating tab surface (excluding safe-area inset). */
export const TAB_BAR_HEIGHT = 64;

/** Scroll content clearance so lists clear the floating tab bar. */
export const TAB_BAR_SCROLL_CLEARANCE = TAB_BAR_HEIGHT + spacing["3xl"] + spacing.xl;

/** Shared tab options — pair with `<MimeTabBar />` via `tabBar` prop. */
export function buildPremiumTabScreenOptions(
  _bottomInset = 0,
  palette: ColorPalette = defaultColors,
): {
  headerShown: boolean;
  tabBarActiveTintColor: string;
  tabBarInactiveTintColor: string;
  tabBarHideOnKeyboard: boolean;
  tabBarShowLabel: boolean;
  tabBarStyle: ViewStyle;
  tabBarLabelStyle: TextStyle;
} {
  return {
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarShowLabel: true,
    tabBarActiveTintColor: palette.primary,
    tabBarInactiveTintColor: palette.mutedForeground,
    tabBarLabelStyle: {
      fontSize: 11,
      fontWeight: "600",
      fontFamily: typography.caption.fontFamily,
      letterSpacing: 0.1,
    },
    tabBarStyle: {
      position: "absolute",
      height: 0,
      borderTopWidth: 0,
      elevation: 0,
      backgroundColor: "transparent",
    },
  };
}

/** @deprecated Use buildPremiumTabScreenOptions with MimeTabBar */
export const premiumTabScreenOptions = buildPremiumTabScreenOptions(0);
