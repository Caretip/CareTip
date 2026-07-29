import { colors, darkColors, lightColors, brand } from "./colors";
import { typography, fontFamilies, fontSizes, fontWeights } from "./typography";
import { spacing, radius, hitSlop, touchTarget, screenPadding } from "./spacing";
import { shadows } from "./shadows";
import { motion } from "./motion";

export const theme = {
  mode: "light" as const,
  brand,
  colors,
  lightColors,
  darkColors,
  typography,
  fontFamilies,
  fontSizes,
  fontWeights,
  spacing,
  radius,
  hitSlop,
  touchTarget,
  shadows,
  motion,
} as const;

export type CareTipTheme = typeof theme;

export { colors, darkColors, lightColors, brand };
export { typography, fontFamilies, fontSizes, fontWeights };
export { spacing, radius, hitSlop, touchTarget, screenPadding };
export { shadows };
export { motion };
export { heroGradient, heroText, surface } from "./surfaces";
