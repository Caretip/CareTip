/**
 * Official CareTip brand assets (July 2026 logo package).
 * Source package: /images/CareTip_*.svg + App-Icon_*.
 * Application canonical copies live under @/assets/brand.
 *
 * Placement rules — docs/BRANDING_LOGO_MIGRATION_REPORT.md
 */
import primaryUrl from "@/assets/brand/CareTip_Primary.svg";
import primaryTaglineUrl from "@/assets/brand/CareTip_Primary-TagLine.svg";
import blackUrl from "@/assets/brand/CareTip_Black.svg";
import blackTaglineUrl from "@/assets/brand/CareTip_Black-TagLine.svg";
import whiteUrl from "@/assets/brand/CareTip_White.svg";
import whiteTaglineUrl from "@/assets/brand/CareTip_White-TagLine.svg";
import orangeUrl from "@/assets/brand/CareTip_Orange.svg";
import orangeTaglineUrl from "@/assets/brand/CareTip_Orange-TagLine.svg";
import appIconSvgUrl from "@/assets/brand/App-Icon_S.svg";
import appIconPngUrl from "@/assets/brand/App-Icon_L.png";

/** Wordmark without tagline | wordmark + tagline | mark-only app icon */
export type CareTipLogoVariant = "wordmark" | "tagline" | "icon";

/**
 * Color treatment:
 * - primary: orange mark + black wordmark (default on light surfaces)
 * - black / white: monochrome wordmarks
 * - orange: orange plate + white wordmark (special marketing / plate use only)
 * - auto: primary on light, white on `.dark` (wordmark/tagline only)
 */
export type CareTipLogoTone = "auto" | "primary" | "black" | "white" | "orange";

export const CARETIP_BRAND_ASSETS = {
  wordmark: {
    primary: primaryUrl,
    black: blackUrl,
    white: whiteUrl,
    orange: orangeUrl,
  },
  tagline: {
    primary: primaryTaglineUrl,
    black: blackTaglineUrl,
    white: whiteTaglineUrl,
    orange: orangeTaglineUrl,
  },
  icon: {
    svg: appIconSvgUrl,
    png: appIconPngUrl,
  },
} as const;

/** Intrinsic canvas ratios from delivered SVG/viewBox (width ÷ height). */
export const CARETIP_BRAND_ASPECT = {
  wordmark: 958 / 298,
  tagline: 958 / 298,
  icon: 1,
} as const;

export function resolveCareTipBrandSrc(
  variant: CareTipLogoVariant,
  tone: Exclude<CareTipLogoTone, "auto">,
): string {
  if (variant === "icon") {
    return CARETIP_BRAND_ASSETS.icon.svg;
  }
  return CARETIP_BRAND_ASSETS[variant][tone];
}

/** Raster fallback for canvas/PDF/email when SVG is unsuitable. */
export const CARETIP_BRAND_RASTER = {
  /** Prefer app icon for square contexts */
  appIconPng: appIconPngUrl,
  /** Public path for emails / absolute URLs — keep in sync with scripts/sync-brand-public-assets.mjs */
  publicWordmarkPng: "/brand/caretip-logo-primary.png",
  publicIconPng: "/brand/caretip-app-icon.png",
  publicTaglinePng: "/brand/caretip-logo-tagline.png",
} as const;
