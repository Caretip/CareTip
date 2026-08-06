/**
 * Typography hierarchy — Display → H1–H4 → Large Body → Body → Small Body →
 * Caption → Button → Label → Input → Helper → Badge → Overline.
 *
 * Prefer `typography.*` composites over local `fontSize` overrides.
 */

export const fontFamilies = {
  sans: "System",
  display: "System",
} as const;

export const fontSizes = {
  /** Badge / overline chrome — not for readable paragraphs. */
  badge: 11,
  metadata: 11,
  caption: 12,
  /** Form labels. */
  label: 13,
  meta: 13,
  /** Dense secondary body. */
  smallBody: 14,
  button: 15,
  body: 16,
  /** Large body / feature lead. */
  largeBody: 17,
  feature: 17,
  h4: 16,
  h3: 18,
  h2: 18,
  section: 20,
  h1: 28,
  hero: 34,
  display: 40,
  metric: 30,
  metricLg: 36,
} as const;

export const fontWeights = {
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
  extrabold: "800" as const,
};

export const lineHeights = {
  tight: 1.1,
  snug: 1.28,
  body: 1.5,
  relaxed: 1.65,
} as const;

export const typography = {
  display: {
    fontFamily: fontFamilies.display,
    fontSize: fontSizes.display,
    fontWeight: fontWeights.extrabold,
    lineHeight: Math.round(fontSizes.display * lineHeights.tight),
    letterSpacing: -1,
  },
  hero: {
    fontFamily: fontFamilies.display,
    fontSize: fontSizes.hero,
    fontWeight: fontWeights.extrabold,
    lineHeight: Math.round(fontSizes.hero * lineHeights.tight),
    letterSpacing: -0.7,
  },
  h1: {
    fontFamily: fontFamilies.display,
    fontSize: fontSizes.h1,
    fontWeight: fontWeights.bold,
    lineHeight: Math.round(fontSizes.h1 * lineHeights.snug),
    letterSpacing: -0.5,
  },
  /** @deprecated Prefer h1 — kept for Phase 4.5 screen compatibility */
  title: {
    fontFamily: fontFamilies.display,
    fontSize: fontSizes.h1,
    fontWeight: fontWeights.bold,
    lineHeight: Math.round(fontSizes.h1 * lineHeights.snug),
    letterSpacing: -0.5,
  },
  /** @deprecated Prefer h2/section — kept for compatibility */
  section: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.section,
    fontWeight: fontWeights.bold,
    lineHeight: Math.round(fontSizes.section * lineHeights.snug),
    letterSpacing: -0.3,
  },
  h2: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.h2,
    fontWeight: fontWeights.semibold,
    lineHeight: Math.round(fontSizes.h2 * lineHeights.snug),
    letterSpacing: -0.2,
  },
  h3: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.h3,
    fontWeight: fontWeights.semibold,
    lineHeight: Math.round(fontSizes.h3 * lineHeights.snug),
    letterSpacing: -0.2,
  },
  h4: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.h4,
    fontWeight: fontWeights.semibold,
    lineHeight: Math.round(fontSizes.h4 * lineHeights.snug),
  },
  /** Card / list title alias → H3 */
  cardTitle: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.h3,
    fontWeight: fontWeights.semibold,
    lineHeight: Math.round(fontSizes.h3 * lineHeights.snug),
  },
  metric: {
    fontFamily: fontFamilies.display,
    fontSize: fontSizes.metric,
    fontWeight: fontWeights.bold,
    lineHeight: Math.round(fontSizes.metric * lineHeights.tight),
    letterSpacing: -0.6,
  },
  largeBody: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.largeBody,
    fontWeight: fontWeights.regular,
    lineHeight: Math.round(fontSizes.largeBody * lineHeights.body),
  },
  body: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.regular,
    lineHeight: Math.round(fontSizes.body * lineHeights.body),
  },
  smallBody: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.smallBody,
    fontWeight: fontWeights.regular,
    lineHeight: Math.round(fontSizes.smallBody * lineHeights.body),
  },
  button: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.button,
    fontWeight: fontWeights.semibold,
    lineHeight: Math.round(fontSizes.button * lineHeights.snug),
  },
  label: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.label,
    fontWeight: fontWeights.semibold,
    lineHeight: Math.round(fontSizes.label * lineHeights.body),
    letterSpacing: 0.2,
  },
  input: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.medium,
    lineHeight: Math.round(fontSizes.body * lineHeights.body),
  },
  helper: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.medium,
    lineHeight: Math.round(fontSizes.caption * lineHeights.body),
  },
  caption: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.medium,
    lineHeight: Math.round(fontSizes.caption * lineHeights.body),
  },
  badge: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.badge,
    fontWeight: fontWeights.semibold,
    lineHeight: Math.round(fontSizes.badge * lineHeights.body),
    letterSpacing: 0.2,
  },
  metadata: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.metadata,
    fontWeight: fontWeights.medium,
    lineHeight: Math.round(fontSizes.metadata * lineHeights.body),
    letterSpacing: 0.1,
  },
  overline: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.metadata,
    fontWeight: fontWeights.bold,
    lineHeight: Math.round(fontSizes.metadata * lineHeights.body),
    letterSpacing: 1.1,
    textTransform: "uppercase" as const,
  },
} as const;
