/**
 * Premium minimalist dashboard tokens — Apple Wallet / Stripe / Revolut inspired.
 */

import { Platform, type ViewStyle } from "react-native";

export const premiumPalette = {
  white: "#FFFFFF",
  surface: "#FCFCFD",
  border: "#ECECEC",
  textPrimary: "#111827",
  textSecondary: "#4B5563",
  textMuted: "#9CA3AF",
  primary: "#F59E0B",
  primaryDeep: "#D97706",
  inactive: "#9CA3AF",
  starGold: "#F59E0B",
} as const;

/** Sheet text hierarchy — light theme uses premiumPalette; dark uses high-contrast grays. */
export type DashboardTextColors = {
  primary: string;
  secondary: string;
  muted: string;
  disabled: string;
};

export function dashboardTextColors(isDark: boolean): DashboardTextColors {
  if (isDark) {
    return {
      primary: "#FFFFFF",
      secondary: "#D1D5DB",
      muted: "#9CA3AF",
      disabled: "#6B7280",
    };
  }
  return {
    primary: premiumPalette.textPrimary,
    secondary: premiumPalette.textSecondary,
    muted: premiumPalette.textMuted,
    disabled: "#6B7280",
  };
}

export const premiumHeroGradient = {
  colors: ["#FFC247", "#F59E0B", "#E67E22"] as const,
  locations: [0, 0.5, 1] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

export const premiumWalletGradient = {
  colors: ["#FFC247", "#F59E0B", "#E67E22"] as const,
  locations: [0, 0.45, 1] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0.85 },
};

export const premiumProgressGradient = {
  colors: ["#FCD34D", "#F59E0B"] as const,
  start: { x: 0, y: 0.5 },
  end: { x: 1, y: 0.5 },
};

/** Very soft elevation — prefer borders over shadows. */
export const premiumCardShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#111827",
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  android: { elevation: 1 },
  default: {},
})!;

export const premiumSoftShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#111827",
    shadowOpacity: 0.02,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  android: { elevation: 0 },
  default: {},
})!;

export const premiumWalletShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#111827",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 2 },
  default: {},
})!;

export const premiumTabShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#111827",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
  },
  android: { elevation: 3 },
  default: {},
})!;
