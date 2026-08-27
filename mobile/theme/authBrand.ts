import { brand } from "./colors";

/**
 * Auth-screen tokens. Primary orange is the web CareTip CTA token (`brand.orange`),
 * not a second splash orange. Canvas stays dark — orange is accents only.
 *
 * Sign In / primary auth CTA fill is `caretipPrimaryCtaGradient` (web 180deg
 * #ff9e2d → #e9781c), not a three-stop or diagonal mobile interpretation.
 */
export const authBrand = {
  orange: brand.orange,
  orangeDeep: brand.orangeDeep,
  orangeSoft: brand.orangeHover,
  orangeMuted: "rgba(233, 120, 28, 0.92)",
  white: "#FFFFFF",
  dark: "#0B1220",
  darkSoft: "#1A2332",
  muted: "#5B6577",
  glassFill: "rgba(255, 255, 255, 0.78)",
  glassBorder: "rgba(255, 255, 255, 0.55)",
  glassPillFill: "rgba(255, 255, 255, 0.14)",
  glassPillBorder: "rgba(255, 255, 255, 0.24)",
  inputFill: "rgba(255, 255, 255, 0.92)",
  /** Floating glass inputs on hero image — not for bottom sheets / cards. */
  fieldFill: "rgba(8, 12, 20, 0.42)",
  fieldFillFocused: "rgba(8, 12, 20, 0.55)",
  fieldBorder: "rgba(255, 255, 255, 0.22)",
  fieldBorderFocused: "rgba(233, 120, 28, 0.95)",
  fieldLabel: "rgba(255, 255, 255, 0.94)",
  fieldText: "#FFFFFF",
  fieldPlaceholder: "rgba(255, 255, 255, 0.82)",
  fieldIcon: "rgba(255, 255, 255, 0.72)",
  fieldError: "#FCA5A5",
  heroTitle: "#FFFFFF",
  heroSubtitle: "rgba(255, 255, 255, 0.78)",
  heroEyebrow: brand.orange,
  heroControlFill: "rgba(255, 255, 255, 0.14)",
  heroControlBorder: "rgba(255, 255, 255, 0.22)",
  heroControlIcon: "#FFFFFF",
  /**
   * Hero image overlays — image stays visible, form stays readable.
   * ~55–70% black with soft vignette layers in LayeredScreenShell.
   */
  overlayTop: "rgba(0, 0, 0, 0.58)",
  overlayMid: "rgba(0, 0, 0, 0.64)",
  overlayBottom: "rgba(0, 0, 0, 0.72)",
  vignetteEdge: "rgba(0, 0, 0, 0.55)",
  softWash: "rgba(11, 18, 32, 0.28)",
} as const;
