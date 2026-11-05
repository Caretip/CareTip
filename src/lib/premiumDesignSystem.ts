/**
 * CareTip Premium Design System Utilities
 * ========================================
 * Standard off-white background colors and utilities
 * for premium, modern UI components.
 */

/**
 * Off-white background colors for premium feel
 * Suggested uses:
 * - LIGHT: card backgrounds, dashboard panels
 * - MEDIUM: hero sections, onboarding cards
 * - WARM: accent backgrounds, hero sections with warmth
 */
export const OFFWHITE_COLORS = {
  LIGHT: '#FAFAF8',
  MEDIUM: '#F7F5F2',
  WARM: '#FFF8F0',
} as const;

/**
 * Brand colors (canonical)
 */
export const BRAND_COLORS = {
  PRIMARY_ORANGE: '#eb992c',
  WHITE: '#FFFFFF',
  BLACK: '#000000',
} as const;

/**
 * Support colors for premium visual hierarchy
 */
export const SUPPORT_COLORS = {
  SOFT_GRAY: '#F3F4F6',
  CHARCOAL: '#1F2937',
  WARM_GOLD: '#FFA500',
} as const;

/**
 * Icon container utility class
 * Wraps icons in soft elevated containers
 */
export const ICON_CONTAINER_BASE = 'inline-flex items-center justify-center rounded-xl bg-opacity-10 group-hover:bg-opacity-20 transition-colors';

/**
 * Card elevation utility class
 * Provides subtle elevated effect
 */
export const CARD_ELEVATION_BASE = 'rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300';

/**
 * CTA button utility class
 * Premium-styled call-to-action buttons
 */
export const CTA_BUTTON_BASE =
  'inline-flex items-center gap-2 rounded-xl font-semibold shadow-[0_8px_22px_rgba(235,153,44,0.28)] transition-[box-shadow,colors,opacity] hover:shadow-[0_10px_28px_rgba(235,153,44,0.32)] active:opacity-90';

export default {
  OFFWHITE_COLORS,
  BRAND_COLORS,
  SUPPORT_COLORS,
  ICON_CONTAINER_BASE,
  CARD_ELEVATION_BASE,
  CTA_BUTTON_BASE,
};
