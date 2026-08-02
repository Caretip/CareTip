/**
 * Two-layer screen design — premium hero + foreground sheet.
 */

import { Platform, type ViewStyle } from "react-native";
import { premiumPalette } from "./dashboardPremium";
import { spacing } from "./spacing";

export const layered = {
  heroHeightRatio: 0.36,
  heroMinHeight: 240,
  /** Sheet top corner radius (36–40px). */
  sheetRadius: 38,
  sheetOverlap: spacing["3xl"] + spacing.md,
  pagePadding: spacing["2xl"],
  elementGap: spacing.lg,
  sectionGap: spacing["2xl"],
  sheetBackground: premiumPalette.surface,
  pageBackground: premiumPalette.background,
} as const;

export const layeredSheetShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
  },
  android: { elevation: 8 },
  default: {},
})!;

/** Floating tab bar shadow — soft lift on white sheet. */
export const floatingTabShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 6 },
  default: {},
})!;
