/**
 * Typography hierarchy — Hero → H1 → H2 → Section → Body → Caption → Metadata.
 */

export const fontFamilies = {
  sans: "System",
  display: "System",
} as const;

export const fontSizes = {
  metadata: 11,
  caption: 12,
  meta: 13,
  button: 15,
  body: 16,
  feature: 17,
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
  /** @deprecated Prefer section — kept for compatibility */
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
  /** Card / list title alias */
  cardTitle: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.h2,
    fontWeight: fontWeights.semibold,
    lineHeight: Math.round(fontSizes.h2 * lineHeights.snug),
  },
  metric: {
    fontFamily: fontFamilies.display,
    fontSize: fontSizes.metric,
    fontWeight: fontWeights.bold,
    lineHeight: Math.round(fontSizes.metric * lineHeights.tight),
    letterSpacing: -0.6,
  },
  body: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.body,
    fontWeight: fontWeights.regular,
    lineHeight: Math.round(fontSizes.body * lineHeights.body),
  },
  button: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.button,
    fontWeight: fontWeights.semibold,
    lineHeight: Math.round(fontSizes.button * lineHeights.snug),
  },
  caption: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.caption,
    fontWeight: fontWeights.medium,
    lineHeight: Math.round(fontSizes.caption * lineHeights.body),
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
