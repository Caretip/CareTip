/** Hero wallet-style gradient — softer CareTip orange for premium dashboard cards. */
export const heroGradient = {
  colors: ["#F7C56E", "#EB992C", "#E08A22"] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0.85 },
};

export const surface = {
  /** Standard elevated card */
  cardRadius: 20,
  /** Hero / wallet card */
  heroRadius: 24,
  /** Pill controls */
  pillRadius: 9999,
  /** Inset grouped list */
  groupRadius: 20,
  /** Icon well for list rows */
  iconWellSize: 44,
  iconWellRadius: 14,
  /** Dashboard shortcut tiles */
  shortcutRadius: 20,
} as const;

export const heroText = {
  label: "rgba(255, 255, 255, 0.82)",
  value: "#FFFFFF",
  hint: "rgba(255, 255, 255, 0.72)",
  trendUp: "#D1FAE5",
  trendDown: "#FEE2E2",
} as const;
