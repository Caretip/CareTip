/**
 * Two-layer screen design — orange hero background + foreground sheet.
 * Inspired by fintech templates; mapped to CareTip branding.
 */

import { Platform, type ViewStyle } from "react-native";
import { brand } from "./colors";
import { radius, spacing } from "./spacing";

export const layered = {
  /** Hero band height (~36–38% of viewport — +20–25% vs prior 0.30). */
  heroHeightRatio: 0.375,
  /** Minimum hero band height on small phones. */
  heroMinHeight: 248,
  /** Sheet top corner radius (32–36px). */
  sheetRadius: 34,
  /** Overlap of sheet onto hero (negative margin). */
  sheetOverlap: spacing["4xl"] + spacing.sm,
  /** Standard page horizontal inset. */
  pagePadding: spacing["2xl"],
  /** Gap between related elements. */
  elementGap: spacing.xl,
  /** Gap between major sections. */
  sectionGap: spacing["4xl"],
  sheetBackground: "#FFFFFF",
  heroGradient: {
    colors: ["#F5B85A", brand.orange, "#D9861F"] as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
} as const;

export const layeredSheetShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
  },
  android: { elevation: 6 },
  default: {},
})!;

/** Floating tab bar shadow — soft lift above content. */
export const floatingTabShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  android: { elevation: 12 },
  default: {},
})!;
