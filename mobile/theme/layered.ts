/**
 * Two-layer screen design — orange hero background + white foreground sheet.
 * Inspired by fintech templates; mapped to CareTip branding.
 */

import { Platform, type ViewStyle } from "react-native";
import { brand } from "./colors";
import { radius, spacing } from "./spacing";

export const layered = {
  /** Where the white sheet begins (~28–32% of viewport). */
  heroHeightRatio: 0.3,
  /** Minimum hero band height on small phones. */
  heroMinHeight: 200,
  /** White sheet top corner radius. */
  sheetRadius: radius["3xl"],
  /** Overlap of sheet onto hero (negative margin). */
  sheetOverlap: spacing["3xl"],
  /** Standard page horizontal inset. */
  pagePadding: spacing["2xl"],
  /** Gap between related elements. */
  elementGap: spacing.lg,
  /** Gap between major sections. */
  sectionGap: spacing["3xl"],
  sheetBackground: "#FFFFFF",
  heroGradient: {
    colors: ["#F0A845", brand.orange, "#C47A12"] as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
} as const;

export const layeredSheetShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
  },
  android: { elevation: 12 },
  default: {},
})!;
