import type { QrTemplateDefinition, QrTemplateZones } from "./types";

/** Measured from CareTip-design.jpg — gold-frame hospitality shell. */
export const LUXURY_GOLD_IMAGE_ZONES: QrTemplateZones = {
  brandingZone: { x: 0.5, y: 0, w: 0.78, h: 0.284, align: "center", valign: "top" },
  qrZone: { x: 0.5, y: 0.2938, w: 0.656, h: 0.328, align: "center", valign: "top" },
  ctaZone: { x: 0.5, y: 0.628, w: 0.52, h: 0.09, align: "center", valign: "top" },
  footerZone: { x: 0.5, y: 0.725, w: 0.86, h: 0.17, align: "center", valign: "top" },
};

/** Vertical procedural hospitality card — scan-first layout (generation 2). */
export const PROCEDURAL_HOSPITALITY_ZONES: QrTemplateZones = {
  brandingZone: { x: 0.5, y: 0, w: 0.9, h: 0.3, align: "center", valign: "top" },
  qrZone: { x: 0.5, y: 0.31, w: 0.62, h: 0.4, align: "center", valign: "top" },
  ctaZone: { x: 0.5, y: 0.72, w: 0.56, h: 0.07, align: "center", valign: "top" },
  footerZone: { x: 0.5, y: 0.79, w: 0.92, h: 0.19, align: "center", valign: "top" },
};

/** template/vip-lounge.jpg — spotlight nightlife shell. */
export const VIP_LOUNGE_IMAGE_ZONES: QrTemplateZones = {
  brandingZone: { x: 0.5, y: 0, w: 0.78, h: 0.3, align: "center", valign: "top" },
  qrZone: { x: 0.5, y: 0.31, w: 0.6, h: 0.35, align: "center", valign: "top" },
  ctaZone: { x: 0.5, y: 0.67, w: 0.52, h: 0.09, align: "center", valign: "top" },
  footerZone: { x: 0.5, y: 0.76, w: 0.86, h: 0.2, align: "center", valign: "top" },
};

/** template/city-cafe.jpg — urban dining room pillar. */
export const CITY_CAFE_IMAGE_ZONES: QrTemplateZones = {
  brandingZone: { x: 0.5, y: 0.08, w: 0.62, h: 0.22, align: "center", valign: "top" },
  qrZone: { x: 0.5, y: 0.33, w: 0.44, h: 0.3, align: "center", valign: "top" },
  ctaZone: { x: 0.5, y: 0.65, w: 0.5, h: 0.1, align: "center", valign: "top" },
  footerZone: { x: 0.5, y: 0.82, w: 0.72, h: 0.12, align: "center", valign: "top" },
};

/** template/beach-resort.jpg — coastal resort frame. */
export const BEACH_RESORT_IMAGE_ZONES: QrTemplateZones = {
  brandingZone: { x: 0.5, y: 0, w: 0.78, h: 0.28, align: "center", valign: "top" },
  qrZone: { x: 0.5, y: 0.3, w: 0.64, h: 0.38, align: "center", valign: "top" },
  ctaZone: { x: 0.5, y: 0.7, w: 0.52, h: 0.08, align: "center", valign: "top" },
  footerZone: { x: 0.5, y: 0.78, w: 0.86, h: 0.18, align: "center", valign: "top" },
};

/** template/scandinavian.jpg — light marble café card. */
export const SCANDINAVIAN_IMAGE_ZONES: QrTemplateZones = {
  brandingZone: { x: 0.5, y: 0.06, w: 0.72, h: 0.18, align: "center", valign: "top" },
  qrZone: { x: 0.5, y: 0.28, w: 0.52, h: 0.38, align: "center", valign: "top" },
  ctaZone: { x: 0.5, y: 0.68, w: 0.52, h: 0.08, align: "center", valign: "top" },
  footerZone: { x: 0.5, y: 0.76, w: 0.86, h: 0.18, align: "center", valign: "top" },
};

/** template/spa-retreat.jpg — wellness stone shell. */
export const SPA_RETREAT_IMAGE_ZONES: QrTemplateZones = {
  brandingZone: { x: 0.5, y: 0, w: 0.78, h: 0.3, align: "center", valign: "top" },
  qrZone: { x: 0.5, y: 0.31, w: 0.55, h: 0.37, align: "center", valign: "top" },
  ctaZone: { x: 0.5, y: 0.69, w: 0.52, h: 0.08, align: "center", valign: "top" },
  footerZone: { x: 0.5, y: 0.77, w: 0.86, h: 0.18, align: "center", valign: "top" },
};

/** template/premium-noir.jpg — art-deco charcoal gold card. */
export const ART_DECO_NOIR_IMAGE_ZONES: QrTemplateZones = {
  brandingZone: { x: 0.5, y: 0, w: 0.78, h: 0.315, align: "center", valign: "top" },
  qrZone: { x: 0.5, y: 0.325, w: 0.61, h: 0.35, align: "center", valign: "top" },
  ctaZone: { x: 0.5, y: 0.674, w: 0.52, h: 0.09, align: "center", valign: "top" },
  footerZone: { x: 0.5, y: 0.754, w: 0.86, h: 0.2, align: "center", valign: "top" },
};

/** template/gallery-white.jpg — minimalist white pedestal. */
export const GALLERY_PAVILION_IMAGE_ZONES: QrTemplateZones = {
  brandingZone: { x: 0.5, y: 0.12, w: 0.72, h: 0.2, align: "center", valign: "top" },
  qrZone: { x: 0.5, y: 0.36, w: 0.4, h: 0.26, align: "center", valign: "top" },
  ctaZone: { x: 0.5, y: 0.64, w: 0.52, h: 0.08, align: "center", valign: "top" },
  footerZone: { x: 0.5, y: 0.74, w: 0.86, h: 0.18, align: "center", valign: "top" },
};

const LUXURY_SUPPORTED_FIELDS = [
  "logo",
  "businessName",
  "tagline",
  "welcomeMessage",
  "qr",
  "cta",
  "thankYouMessage",
  "address",
  "phone",
  "website",
  "socialInstagram",
  "socialFacebook",
  "attribution",
] as const;

const LUXURY_DEFAULT_VISIBILITY = {
  logo: true,
  businessName: true,
  tagline: false,
  welcomeMessage: false,
  qr: true,
  cta: true,
  thankYouMessage: true,
  address: true,
  phone: false,
  website: true,
  socialInstagram: false,
  socialFacebook: false,
  attribution: true,
} as const;

const LUXURY_FIELD_POSITIONS: QrTemplateDefinition["positions"] = {
  logo: { x: 0, y: 0, w: 0.34, h: 0.58, align: "center", valign: "top" },
  businessName: {
    x: 0,
    y: 0,
    w: 1,
    align: "center",
    valign: "top",
    maxFontSize: 19,
    fontWeight: "700",
    uppercase: true,
    color: "accent",
  },
  tagline: { x: 0, y: 0, w: 0.95, align: "center", maxFontSize: 11, color: "onDark" },
  welcomeMessage: {
    x: 0,
    y: 0,
    w: 0.95,
    align: "center",
    maxFontSize: 10,
    fontWeight: "600",
    uppercase: true,
    color: "accent",
  },
  qr: { x: 0, y: 0, w: 1, h: 1, align: "center", valign: "middle" },
  cta: {
    x: 0,
    y: 0,
    w: 1,
    h: 0.55,
    align: "center",
    valign: "middle",
    maxFontSize: 11,
    fontWeight: "700",
    uppercase: true,
    color: "onLight",
  },
  thankYouMessage: {
    x: 0,
    y: 0,
    w: 1,
    align: "center",
    maxFontSize: 10,
    fontWeight: "600",
    uppercase: true,
    color: "onDark",
  },
  address: {
    x: 0,
    y: 0,
    w: 0.92,
    align: "center",
    valign: "top",
    maxFontSize: 10,
    fontWeight: "500",
    uppercase: false,
    color: "onDark",
  },
  phone: { x: 0, y: 0, w: 0.33, align: "center", maxFontSize: 8, color: "onDark" },
  website: { x: 0, y: 0, w: 0.33, align: "center", maxFontSize: 8, color: "onDark" },
  socialInstagram: { x: 0, y: 0, w: 1, align: "center", maxFontSize: 7.5, color: "onDark" },
  socialFacebook: { x: 0, y: 0, w: 1, align: "center", maxFontSize: 7.5, color: "onDark" },
  attribution: { x: 0, y: 0, w: 1, align: "center", maxFontSize: 6.5, color: "onDark" },
};

const CHAMPAGNE_FIELD_POSITIONS: QrTemplateDefinition["positions"] = {
  ...LUXURY_FIELD_POSITIONS,
  businessName: { ...LUXURY_FIELD_POSITIONS.businessName!, color: "secondary", maxFontSize: 18 },
  tagline: { ...LUXURY_FIELD_POSITIONS.tagline!, color: "onLight" },
  welcomeMessage: { ...LUXURY_FIELD_POSITIONS.welcomeMessage!, color: "secondary" },
  thankYouMessage: { ...LUXURY_FIELD_POSITIONS.thankYouMessage!, color: "onLight" },
  address: { ...LUXURY_FIELD_POSITIONS.address!, color: "onLight" },
  phone: { ...LUXURY_FIELD_POSITIONS.phone!, color: "onLight" },
  website: { ...LUXURY_FIELD_POSITIONS.website!, color: "onLight" },
  socialInstagram: { ...LUXURY_FIELD_POSITIONS.socialInstagram!, color: "onLight" },
  socialFacebook: { ...LUXURY_FIELD_POSITIONS.socialFacebook!, color: "onLight" },
  attribution: { ...LUXURY_FIELD_POSITIONS.attribution!, color: "onLight" },
};

type LuxuryShellBase = Pick<
  QrTemplateDefinition,
  "id" | "labelKey" | "descriptionKey" | "gallery" | "background" | "zones" | "positions"
>;

export function luxuryShellBase(
  partial: LuxuryShellBase,
): QrTemplateDefinition {
  return {
    canvasWidth: 360,
    canvasHeight: partial.background.kind === "image" ? 480 : 640,
    qrSafeZone: { padding: 0.05 },
    qrPresentation: "panel",
    requiredFields: ["logo", "businessName", "qr"],
    supportedFields: [...LUXURY_SUPPORTED_FIELDS],
    defaultFieldVisibility: { ...LUXURY_DEFAULT_VISIBILITY },
    ...partial,
  };
}

export function darkLuxuryPositions(): QrTemplateDefinition["positions"] {
  return LUXURY_FIELD_POSITIONS;
}

export function champagneSalonPositions(): QrTemplateDefinition["positions"] {
  return CHAMPAGNE_FIELD_POSITIONS;
}
