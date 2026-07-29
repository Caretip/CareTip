/**
 * Premium surface tokens — inspired by fintech UI kits (Nexobank / wallet templates),
 * mapped to CareTip orange identity.
 */

import { brand } from "./colors";

/** Hero wallet-style gradient (CareTip orange, not template purple). */
export const heroGradient = {
  colors: ["#F0A845", brand.orange, "#C47A12"] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

export const surface = {
  /** Standard elevated card */
  cardRadius: 24,
  /** Hero / wallet card */
  heroRadius: 28,
  /** Pill controls */
  pillRadius: 9999,
  /** Inset grouped list */
  groupRadius: 24,
  /** Icon well for list rows */
  iconWellSize: 44,
  iconWellRadius: 14,
} as const;

export const heroText = {
  label: "rgba(255, 255, 255, 0.82)",
  value: "#FFFFFF",
  hint: "rgba(255, 255, 255, 0.75)",
  trendUp: "#D1FAE5",
  trendDown: "#FEE2E2",
} as const;
