/**
 * CareTip fintech light theme — neutral surfaces, orange accent only for emphasis.
 * Palette: Grey / Raenest / Revolut inspired hospitality fintech.
 *
 * Brand orange matches web app CTA primary (`src/styles/caretip-brand.css` /
 * `src/lib/caretipBrand.ts` — `#e9781c`).
 *
 * Do not invent a mobile-only CareTip orange. Web tokens are the source of truth:
 *   --caretip-brand-orange-light: #ff9e2d
 *   --caretip-brand-orange:       #e9781c
 *   --caretip-brand-orange-hover: #ffb04a
 */

export const brand = {
  orange: "#e9781c",
  orangeLight: "#ff9e2d",
  orangeHover: "#ffb04a",
  orangeSoft: "rgba(233, 120, 28, 0.12)",
  orangeMuted: "rgba(233, 120, 28, 0.22)",
  /** Tonal shade for dashboard hero/illustration gradients — not the Sign In CTA. */
  orangeDeep: "#d96810",
} as const;

/**
 * Web Sign In / primary CTA fill — traced from source, not screenshots.
 *
 * Definition: `src/styles/caretip-buttons.css`
 *   html:not(.dark) .caretip-btn-primary,
 *   html:not(.dark) .caretip-cta-primary,
 *   .dark .caretip-btn-primary,
 *   .dark .caretip-cta-primary
 *     background: linear-gradient(
 *       180deg,
 *       var(--caretip-brand-orange-light) 0%,
 *       var(--caretip-brand-orange) 100%
 *     )
 *
 * Token values: `src/styles/caretip-brand.css` / `src/lib/caretipBrand.ts`
 *   light #ff9e2d → base #e9781c
 * Direction: 180deg = top → bottom. Two stops only. Colors are fully opaque.
 * Hover (not the resting CTA): 180deg #ffb04a → #e9781c.
 *
 * expo-linear-gradient mapping for 180deg: start {x:0.5,y:0} → end {x:0.5,y:1}.
 */
export const caretipPrimaryCtaGradient = {
  colors: [brand.orangeLight, brand.orange] as const,
  locations: [0, 1] as const,
  start: { x: 0.5, y: 0 },
  end: { x: 0.5, y: 1 },
} as const;

export const lightColors = {
  background: "#F8F9FB",
  backgroundElevated: "#FFFFFF",
  foreground: "#111827",
  card: "#FFFFFF",
  cardElevated: "#FFFFFF",
  cardForeground: "#111827",
  cardGlass: "rgba(255, 255, 255, 0.92)",
  primary: brand.orange,
  primaryHover: brand.orangeHover,
  primaryForeground: "#FFFFFF",
  primarySoft: brand.orangeSoft,
  secondary: "#F1F3F6",
  secondaryForeground: "#111827",
  muted: "#F3F4F6",
  mutedForeground: "#6B7280",
  accent: brand.orange,
  accentForeground: "#FFFFFF",
  destructive: "#DC2626",
  destructiveForeground: "#FFFFFF",
  destructiveSoft: "#FEF2F2",
  success: "#059669",
  successForeground: "#FFFFFF",
  successSoft: "#ECFDF5",
  warning: "#D97706",
  warningForeground: "#FFFFFF",
  warningSoft: "#FFFBEB",
  info: "#2563EB",
  infoSoft: "#EFF6FF",
  border: "#ECEEF2",
  borderStrong: "#D1D5DB",
  input: "#ECEEF2",
  inputBackground: "#FFFFFF",
  ring: brand.orange,
  sidebar: "#FFFFFF",
  sidebarForeground: "#111827",
  sidebarBorder: "#ECEEF2",
  overlay: "rgba(17, 24, 39, 0.45)",
  heroGradientStart: "#FFFFFF",
  heroGradientEnd: "#F7F8FA",
  tabBar: "#FFFFFF",
  tabBarBorder: "#ECEEF2",
  separator: "#ECEEF2",
  skeleton: "#ECEEF2",
  skeletonHighlight: "#F7F8FA",
  /** Neutral chart bars — accent bar uses primary. */
  chartNeutral: "#D1D5DB",
  chartNeutralMuted: "#E5E7EB",
  /** Auth bottom sheets / modals — distinct from hero glass controls. */
  authSurfaceGoogleBg: "#FFFFFF",
  authSurfaceGoogleBorder: "#D1D5DB",
  authSurfaceGoogleText: "#111827",
  authSurfaceGoogleRipple: "rgba(17, 24, 39, 0.08)",
} as const;

/** Dark palette — active via ThemeBridge + useTheme(). */
export const darkColors = {
  background: "#0B0D10",
  backgroundElevated: "#14171C",
  foreground: "#F8FAFC",
  card: "#171A1F",
  cardElevated: "#1C2128",
  cardForeground: "#F8FAFC",
  cardGlass: "rgba(23, 26, 31, 0.88)",
  primary: brand.orange,
  primaryHover: brand.orangeLight,
  primaryForeground: "#FFFFFF",
  primarySoft: "#2A1A0E",
  secondary: "#27272A",
  secondaryForeground: "#FAFAFA",
  muted: "#27272A",
  mutedForeground: "#A1A1AA",
  accent: brand.orange,
  accentForeground: "#FFFFFF",
  destructive: "#FB7185",
  destructiveForeground: "#FFFFFF",
  destructiveSoft: "#3F1515",
  success: "#2DD4BF",
  successForeground: "#042F2E",
  successSoft: "#0F2E22",
  warning: "#F59E0B",
  warningForeground: "#18181B",
  warningSoft: "#3B2A0A",
  info: "#60A5FA",
  infoSoft: "#0F1C33",
  border: "#2A2F38",
  borderStrong: "#3F4654",
  input: "#2A2F38",
  inputBackground: "#14171C",
  ring: brand.orange,
  sidebar: "#11141A",
  sidebarForeground: "#FAFAFA",
  sidebarBorder: "#2A2F38",
  overlay: "rgba(0, 0, 0, 0.55)",
  heroGradientStart: "#1A120C",
  heroGradientEnd: "#0B0D10",
  tabBar: "rgba(23, 26, 31, 0.94)",
  tabBarBorder: "rgba(255, 255, 255, 0.08)",
  separator: "rgba(255, 255, 255, 0.08)",
  skeleton: "#27272A",
  skeletonHighlight: "#3F4654",
  chartNeutral: "#4B5563",
  chartNeutralMuted: "#374151",
  /** Auth bottom sheets / modals — glass-style controls on dark surfaces. */
  authSurfaceGoogleBg: "rgba(255, 255, 255, 0.12)",
  authSurfaceGoogleBorder: "rgba(255, 255, 255, 0.22)",
  authSurfaceGoogleText: "#FFFFFF",
  authSurfaceGoogleRipple: "rgba(255, 255, 255, 0.12)",
} as const;

export type ColorPalette = typeof lightColors | typeof darkColors;

export const colors: ColorPalette = lightColors;
