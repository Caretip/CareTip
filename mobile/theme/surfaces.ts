import { premiumWalletGradient } from "./dashboardPremium";

/** Hero wallet card gradient — rich premium orange. */
export const heroGradient = premiumWalletGradient;

export const surface = {
  cardRadius: 22,
  heroRadius: 26,
  pillRadius: 9999,
  groupRadius: 22,
  iconWellSize: 42,
  iconWellRadius: 14,
  shortcutRadius: 22,
} as const;

export const heroText = {
  label: "rgba(255, 255, 255, 0.88)",
  value: "#FFFFFF",
  hint: "rgba(255, 255, 255, 0.78)",
  trendUp: "#D1FAE5",
  trendDown: "#FEE2E2",
} as const;
