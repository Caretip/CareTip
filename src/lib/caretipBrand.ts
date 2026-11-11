/**
 * CareTip landing primary orange — single source of truth.
 * Do not add shades outside this trio (+ white/black neutrals for UI chrome).
 */
export const CARETIP_BRAND_ORANGE = {
  light: "#ff9e2d",
  base: "#eb992c",
  hover: "#ffb04a",
} as const;

/** HSL components for Tailwind `hsl(var(--primary))` — derived from `base`. */
export const CARETIP_PRIMARY_HSL = "34.24 82.68% 54.71%";
export const CARETIP_PRIMARY_HOVER_HSL = "38 94% 59%";
