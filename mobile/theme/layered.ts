/**
 * Two-layer screen design — premium hero + foreground sheet.
 */

import { Platform, type ViewStyle } from "react-native";
import { premiumPalette } from "./dashboardPremium";
import { spacing } from "./spacing";

export const layered = {
  heroHeightRatio: 0.34,
  heroMinHeight: 220,
  sheetRadius: 28,
  sheetOverlap: spacing["2xl"] + spacing.lg,
  pagePadding: spacing["2xl"],
  elementGap: spacing.xl,
  sectionGap: spacing["3xl"],
  sheetBackground: premiumPalette.white,
  pageBackground: premiumPalette.surface,
} as const;

export const layeredSheetShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#111827",
    shadowOpacity: 0.04,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -3 },
  },
  android: { elevation: 2 },
  default: {},
})!;

export const floatingTabShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#111827",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
  },
  android: { elevation: 3 },
  default: {},
})!;
