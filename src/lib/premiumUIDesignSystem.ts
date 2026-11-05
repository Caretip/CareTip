/**
 * CareTip Premium UI Design System v2.0
 * =======================================
 * Enhanced design system with premium gradients and 3D visuals
 * while maintaining core brand identity (Orange, White, Black)
 */

import { caretipBtnPrimary } from "@/lib/caretipButtonSystem";

// ============================================
// BRAND COLORS (PRIMARY)
// ============================================
export const BRAND_COLORS = {
  PRIMARY_ORANGE: "#eb992c",
  WHITE: "#FFFFFF",
  BLACK: "#000000",
} as const;

// ============================================
// PREMIUM GRADIENTS
// ============================================
export const PREMIUM_GRADIENTS = {
  /**
   * CareTip Premium Gradient — warm vertical band from landing Final CTA.
   * Prefer CSS var(--caretip-premium-gradient) in stylesheets.
   */
  PREMIUM_WARM_DARK: "var(--caretip-premium-gradient)",
  PREMIUM_WARM_DARK_DARK: "var(--caretip-premium-gradient-dark)",
  PREMIUM_CTA: "var(--caretip-premium-cta-gradient)",
  /** Light tint for upgrade / locked feature cards (Tier 3 subtle) */
  ORANGE_SUBTLE: "linear-gradient(135deg, rgba(235, 153, 44, 0.10) 0%, rgba(235, 153, 44, 0.00) 100%)",
  SOFT_LIGHT: "linear-gradient(135deg, #F9FAFB 0%, #FFFFFF 100%)",
  DARK_WARM: "linear-gradient(135deg, #111827 0%, #111827 100%)",
} as const;

// ============================================
// SUPPORT COLORS
// ============================================
export const SUPPORT_COLORS = {
  SOFT_GRAY: "#F9FAFB",
  CHARCOAL: "#111827",
  WARM_GOLD: "#eb992c",
  SUCCESS_GREEN: "#eb992c",
  ERROR_RED: "#111827",
  WARNING_AMBER: "#eb992c",
} as const;

// ============================================
// SHADOW ELEVATIONS (for 3D effect)
// ============================================
export const SHADOWS = {
  SUBTLE: "0 1px 2px rgba(0, 0, 0, 0.05)",
  SOFT: "0 4px 6px rgba(0, 0, 0, 0.07)",
  MEDIUM: "0 10px 15px rgba(0, 0, 0, 0.1)",
  ELEVATED: "0 20px 25px rgba(0, 0, 0, 0.15)",
  HOVER: "0 25px 35px rgba(235, 153, 44, 0.15)",
  GLOW_ORANGE: "0 0 20px rgba(235, 153, 44, 0.25)",
} as const;

// ============================================
// TAILWIND CLASS UTILITIES
// ============================================

/** Premium card base - elevated white/light background */
export const PREMIUM_CARD_BASE =
  "rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900";

/** Premium card with gradient background */
export const PREMIUM_CARD_GRADIENT =
  "rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900";

/** Icon container - dimensional with elevation */
export const ICON_CONTAINER_PREMIUM =
  "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-primary/10 p-3 shadow-sm transition-all duration-300 group-hover:shadow-md dark:border-neutral-800";

/** Icon container - secondary (darker) */
export const ICON_CONTAINER_DARK =
  "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50 p-3 shadow-sm transition-all duration-300 group-hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900";

/** CTA Button base — landing orange + global sizing */
export const CTA_BUTTON_PREMIUM = caretipBtnPrimary;

/** Badge - premium styled with subtle gradient */
export const BADGE_PREMIUM =
  "inline-flex items-center gap-1 rounded-full border border-gray-200 bg-primary/10 px-3 py-1 text-sm font-medium text-primary dark:border-neutral-800 dark:bg-primary/10";

/** Banner/Hero section base */
export const BANNER_PREMIUM = "rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 border border-white/50";

/** Dashboard panel - premium with subtle gradient */
export const DASHBOARD_PANEL =
  "rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900";

/** Elevated card stack effect */
export const CARD_STACK =
  "relative rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900";

// ============================================
// COMPOSITE STYLES (Multi-element)
// ============================================

export const PREMIUM_SECTION_CONTAINER = {
  base: "relative w-full bg-white dark:bg-neutral-950",
  withGradient: "relative w-full bg-white dark:bg-neutral-950",
} as const;

export const PREMIUM_HERO_SECTION = {
  container: "relative w-full py-20 sm:py-24 lg:py-32",
  gradient: "absolute inset-0 bg-gradient-to-br from-white via-white to-gray-50 pointer-events-none dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900",
  content: "relative z-10",
} as const;

// ============================================
// 3D VISUAL STYLES
// ============================================

export const _3D_STYLES = {
  /** Floating effect (hover) */
  floating: "transition-[box-shadow,colors] duration-300 hover:shadow-md",
  
  /** Perspective effect */
  perspective: "perspective-1000",
  
  /** Dimensional card effect */
  dimensional: "rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.06)] border-t border-white/50 hover:shadow-[0_14px_36px_rgba(0,0,0,0.08)] transition-all",
  
  /** Icon rotation on hover */
  iconHoverRotate: "transition-transform duration-300 group-hover:rotate-3",
} as const;

// ============================================
// RESPONSIVE SIZING
// ============================================

export const RESPONSIVE_SIZES = {
  MOBILE_PADDING: "px-4 sm:px-6",
  DESKTOP_PADDING: "px-6 lg:px-8",
  SECTION_GAP: "gap-6 sm:gap-8 lg:gap-12",
  GRID_COLS: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
} as const;

// ============================================
// ANIMATION UTILITIES
// ============================================

export const ANIMATIONS = {
  /** Smooth fade in */
  fadeIn: "animate-in fade-in duration-500",
  
  /** Slide up entrance */
  slideUp: "animate-in slide-in-from-bottom duration-500",
  
  /** Bounce entrance */
  bounce: "animate-bounce",
  
  /** Pulse effect */
  pulse: "animate-pulse",
} as const;

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get gradient style object from gradient name
 * Usage: style={{ background: getGradientStyle('ORANGE_WARM') }}
 */
export function getGradientStyle(gradientName: keyof typeof PREMIUM_GRADIENTS) {
  return {
    background: PREMIUM_GRADIENTS[gradientName],
  };
}

/**
 * Merge multiple Tailwind class strings intelligently
 */
export function mergeUIClasses(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export default {
  BRAND_COLORS,
  PREMIUM_GRADIENTS,
  SUPPORT_COLORS,
  SHADOWS,
  PREMIUM_CARD_BASE,
  PREMIUM_CARD_GRADIENT,
  ICON_CONTAINER_PREMIUM,
  ICON_CONTAINER_DARK,
  CTA_BUTTON_PREMIUM,
  BADGE_PREMIUM,
  BANNER_PREMIUM,
  DASHBOARD_PANEL,
  CARD_STACK,
  PREMIUM_SECTION_CONTAINER,
  PREMIUM_HERO_SECTION,
  _3D_STYLES,
  RESPONSIVE_SIZES,
  ANIMATIONS,
  getGradientStyle,
  mergeUIClasses,
};
