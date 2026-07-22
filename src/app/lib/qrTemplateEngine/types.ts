/** Registry-driven QR template engine — types only. */

export const QR_TEMPLATE_FIELD_IDS = [
  "logo",
  "businessName",
  "tagline",
  "welcomeMessage",
  "qr",
  "cta",
  "thankYouMessage",
  "address",
  "phone",
  "email",
  "website",
  "socialInstagram",
  "socialFacebook",
  "attribution",
] as const;

export type QrTemplateFieldId = (typeof QR_TEMPLATE_FIELD_IDS)[number];

/** Normalized 0–1 rect on the template canvas. */
export type QrTemplateZone = {
  /** Anchor X (0–1); combined with `align` to resolve left edge. */
  x: number;
  /** Anchor Y (0–1); combined with `valign` to resolve top edge. */
  y: number;
  w: number;
  h: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
};

/** Explicit layout regions — content is composed inside zones, never anchored to decorations. */
export type QrTemplateZones = {
  brandingZone: QrTemplateZone;
  qrZone: QrTemplateZone;
  ctaZone: QrTemplateZone;
  footerZone: QrTemplateZone;
};

/** Which zone a field renders into when `zones` is defined. */
export const QR_TEMPLATE_FIELD_ZONE: Partial<Record<QrTemplateFieldId, keyof QrTemplateZones>> = {
  logo: "brandingZone",
  businessName: "brandingZone",
  address: "brandingZone",
  tagline: "brandingZone",
  welcomeMessage: "brandingZone",
  qr: "qrZone",
  cta: "ctaZone",
  thankYouMessage: "footerZone",
  phone: "footerZone",
  email: "footerZone",
  website: "footerZone",
  socialInstagram: "footerZone",
  socialFacebook: "footerZone",
  attribution: "footerZone",
};

/** Normalized 0–1 coordinates relative to template canvas. */
export type QrTemplateFieldPosition = {
  x: number;
  y: number;
  /** Width as fraction of canvas (optional — text fields auto-size). */
  w?: number;
  /** Height as fraction of canvas (optional). */
  h?: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  maxFontSize?: number;
  fontWeight?: string;
  uppercase?: boolean;
  color?: "primary" | "secondary" | "accent" | "onDark" | "onLight";
};

export type QrProceduralShellVariant =
  | "poc-luxury-shell"
  | "velvet-lounge"
  | "grand-atelier"
  | "royal-suite"
  | "champagne-salon"
  | "emerald-sanctuary"
  | "sapphire-pavilion"
  | "copper-hearth"
  | "rose-gold-salon";

export type QrTemplateBackground =
  | { kind: "image"; src: string }
  | { kind: "procedural"; variant: QrProceduralShellVariant };

/** Padding inside `qrZone` around the QR matrix — fraction of zone min edge. */
export type QrTemplateSafeZone = {
  padding: number;
};

export type QrTemplateDefinition = {
  id: string;
  labelKey: string;
  descriptionKey: string;
  /** When false, hidden from QR Studio gallery (internal / POC shells). */
  gallery?: boolean;
  canvasWidth: number;
  canvasHeight: number;
  background: QrTemplateBackground;
  /** Explicit regions derived from the shell artwork. */
  zones?: QrTemplateZones;
  /** Inset inside `qrZone` — keeps modules off frame edges. */
  qrSafeZone: QrTemplateSafeZone;
  /** How the QR is composited onto image shells. */
  qrPresentation?: "framed" | "inset" | "panel";
  /** Fields this layout can show (template capability). */
  supportedFields: readonly QrTemplateFieldId[];
  /** Must always render when supported. */
  requiredFields: readonly QrTemplateFieldId[];
  positions: Partial<Record<QrTemplateFieldId, QrTemplateFieldPosition>>;
  /** Default visibility when business has not overridden. */
  defaultFieldVisibility: Partial<Record<QrTemplateFieldId, boolean>>;
};

/** Resolved business data for dynamic injection — never hardcoded in templates. */
export type QrTemplateBrandingPayload = {
  premium: boolean;
  logoUrl: string | null;
  businessName: string;
  tagline: string | null;
  welcomeMessage: string | null;
  thankYouMessage: string | null;
  ctaText: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  socialInstagram: string | null;
  socialFacebook: string | null;
  primaryColor: string;
  secondaryColor: string;
  qrAccentColor: string;
  qrModuleLight: string;
  /** Per-field visibility — business + template defaults merged. */
  fieldVisibility: Record<QrTemplateFieldId, boolean>;
  /** Studio logo layout (local extras) — instant preview only. */
  logoLayout?: {
    size: "small" | "medium" | "large";
    orientation: "landscape" | "portrait" | "square";
    alignment: "center" | "top";
    padding: "tight" | "balanced" | "generous";
  };
};

export type QrTemplateRenderInput = {
  qrUrl: string;
  templateId: string;
  payload: QrTemplateBrandingPayload;
  scale?: 1 | 2 | 3 | 4;
  /** When false, nearest-neighbor upscale keeps QR modules sharp (scan validation). */
  smoothScale?: boolean;
};
