/**
 * Premium fintech dashboard design tokens — Revolut / Stripe / Apple Wallet inspired.
 */

import { Platform, type ViewStyle } from "react-native";

export const premiumPalette = {
  primary: "#F5A623",
  secondary: "#E88E15",
  highlight: "#FFD36A",
  background: "#F8F9FB",
  surface: "#FFFFFF",
  inactive: "#9CA3AF",
  starGold: "#F5A623",
} as const;

export const premiumHeroGradient = {
  colors: ["#FFD36A", "#F5A623", "#E88E15", "#D9861F"] as const,
  locations: [0, 0.32, 0.68, 1] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

export const premiumWalletGradient = {
  colors: ["#FFD36A", "#F5A623", "#E88E15"] as const,
  locations: [0, 0.45, 1] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0.9 },
};

export const premiumProgressGradient = {
  colors: ["#FFD36A", "#F5A623", "#E88E15"] as const,
  start: { x: 0, y: 0.5 },
  end: { x: 1, y: 0.5 },
};

export const premiumCardShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  android: { elevation: 3 },
  default: {},
})!;

export const premiumSoftShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  android: { elevation: 2 },
  default: {},
})!;

export const premiumWalletShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#E88E15",
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  android: { elevation: 5 },
  default: {},
})!;

export const premiumTabShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 6 },
  default: {},
})!;
