/** Mirrors backend `PublicGuestBrandingDto` / manager branding settings. */

import type { QrLayoutVariantId } from "./qrDesignSystem";
import type { QrTemplateFieldId } from "./qrTemplateEngine/types";
import {
  DEFAULT_QR_BACKGROUND_COLOR,
  DEFAULT_QR_BORDER_STYLE,
  DEFAULT_QR_SHAPE,
  DEFAULT_QR_TEMPLATE,
  normalizeQrBorderStyleId,
  normalizeQrShapeId,
  normalizeQrTemplateId,
  type QrBorderStyleId,
  type QrShapeId,
  type QrTemplateId,
} from "./qrTemplateStyles";

export const DEFAULT_BRAND_PRIMARY_COLOR = "#EB992C";
export const DEFAULT_BRAND_SECONDARY_COLOR = "#000000";
export const CARETIP_QR_BRAND_HEX = "#EB992C";

/** Plan-aware QR / guest fallback when custom branding is unavailable or unset. */
export const DEFAULT_QR_THANK_YOU_MESSAGE = "Thank you for your support.";

/** Guest tip completion fallback (Basic or Premium without custom copy). */
export const DEFAULT_GUEST_THANK_YOU_MESSAGE = "Thanks for your tip!";

/** Resolve thank-you copy for QR rendering — never read hardcoded text from template assets. */
export function resolveQrThankYouMessage(
  tierAllowsCustomBranding: boolean,
  customMessage: string | null | undefined,
  fallbackMessage: string = DEFAULT_QR_THANK_YOU_MESSAGE,
): string {
  if (tierAllowsCustomBranding) {
    const trimmed = customMessage?.trim();
    if (trimmed) return trimmed;
  }
  return fallbackMessage.trim() || DEFAULT_QR_THANK_YOU_MESSAGE;
}

/** Thank-you copy for guest tip completion — uses Branding page message when Premium/Enterprise. */
export function resolveGuestThankYouMessage(
  branding: Pick<PublicGuestBranding, "premium" | "thankYouMessage"> | null | undefined,
  fallbackMessage: string = DEFAULT_GUEST_THANK_YOU_MESSAGE,
): string {
  if (branding?.premium) {
    const trimmed = branding.thankYouMessage?.trim();
    if (trimmed) return trimmed;
  }
  return fallbackMessage.trim() || DEFAULT_GUEST_THANK_YOU_MESSAGE;
}

/** Completion-screen line under the venue name — never the QR landing welcome message. */
export function resolveGuestCompletionSupportingText(
  branding: Pick<PublicGuestBranding, "premium" | "brandTagline"> | null | undefined,
  fallbackMessage: string,
): string {
  if (branding?.premium) {
    const tagline = branding.brandTagline?.trim();
    if (tagline) return tagline;
  }
  return fallbackMessage.trim();
}

/** Primary accent for guest journey UI (completion CTA, icon ring). */
export function guestBrandAccentColor(
  branding: Pick<PublicGuestBranding, "premium" | "brandPrimaryColor" | "qrAccentColor"> | null | undefined,
): string {
  if (!branding?.premium) return DEFAULT_BRAND_PRIMARY_COLOR;
  const primary = branding.brandPrimaryColor?.trim();
  if (primary && isValidBrandHex(primary)) return primary;
  const accent = branding.qrAccentColor?.trim();
  if (accent && isValidBrandHex(accent)) return accent;
  return DEFAULT_BRAND_PRIMARY_COLOR;
}

export type PublicGuestBranding = {
  premium: boolean;
  businessName: string;
  brandDisplayName: string | null;
  brandTagline: string | null;
  logoPath: string | null;
  bannerImagePath: string | null;
  brandPrimaryColor: string;
  brandSecondaryColor: string;
  welcomeMessage: string | null;
  thankYouMessage: string | null;
  qrTemplate: QrTemplateId;
  qrBorderStyle: QrBorderStyleId;
  qrShape: QrShapeId;
  qrAccentColor: string;
  qrBackgroundColor: string;
};

export type BusinessBrandingSettings = {
  logoPath: string | null;
  bannerImagePath: string | null;
  brandPrimaryColor: string;
  brandSecondaryColor: string;
  welcomeMessage: string | null;
  thankYouMessage: string | null;
  brandDisplayName: string | null;
  brandTagline: string | null;
  qrTemplate: QrTemplateId;
  qrBorderStyle: QrBorderStyleId;
  qrShape: QrShapeId;
  qrAccentColor: string;
  qrBackgroundColor: string;
  canEdit: boolean;
};

export type QrBrandingOptions = {
  premium: boolean;
  primaryColor: string;
  secondaryColor: string;
  centerLogoUrl: string | null;
  businessName: string;
  brandTagline?: string | null;
  welcomeMessage?: string | null;
  thankYouMessage?: string | null;
  ctaText?: string | null;
  qrTemplate?: QrTemplateId;
  qrBorderStyle?: QrBorderStyleId;
  qrShape?: QrShapeId;
  qrAccentColor?: string;
  qrBackgroundColor?: string;
  layoutVariant?: QrLayoutVariantId;
  decorationsEnabled?: boolean;
  showVenueLogoHeader?: boolean;
  /** Engine templates — profile contact slice (from business profile API). */
  templateProfile?: {
    registeredAddress?: string | null;
    location?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    website?: string | null;
  } | null;
  websiteUrl?: string | null;
  socialInstagram?: string | null;
  socialFacebook?: string | null;
  templateFieldVisibility?: Partial<Record<QrTemplateFieldId, boolean>>;
  logoSize?: import("./qrDesignSystem").QrLogoSize;
  logoOrientation?: import("./qrDesignSystem").QrLogoOrientation;
  logoAlignment?: import("./qrDesignSystem").QrLogoAlignment;
  logoPadding?: import("./qrDesignSystem").QrLogoPadding;
};

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function isValidBrandHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

export function resolveGuestDisplayName(branding: Pick<PublicGuestBranding, "businessName" | "brandDisplayName">): string {
  const custom = branding.brandDisplayName?.trim();
  return custom || branding.businessName;
}

export function brandingFromSettings(
  settings: BusinessBrandingSettings,
  businessName: string,
  tierPremium: boolean,
): PublicGuestBranding {
  if (!tierPremium) {
    return {
      premium: false,
      businessName,
      brandDisplayName: null,
      brandTagline: null,
      logoPath: settings.logoPath,
      bannerImagePath: null,
      brandPrimaryColor: DEFAULT_BRAND_PRIMARY_COLOR,
      brandSecondaryColor: DEFAULT_BRAND_SECONDARY_COLOR,
      welcomeMessage: null,
      thankYouMessage: null,
      qrTemplate: DEFAULT_QR_TEMPLATE,
      qrBorderStyle: DEFAULT_QR_BORDER_STYLE,
      qrShape: DEFAULT_QR_SHAPE,
      qrAccentColor: DEFAULT_BRAND_PRIMARY_COLOR,
      qrBackgroundColor: DEFAULT_QR_BACKGROUND_COLOR,
    };
  }
  return {
    premium: true,
    businessName,
    brandDisplayName: settings.brandDisplayName,
    brandTagline: settings.brandTagline,
    logoPath: settings.logoPath,
    bannerImagePath: settings.bannerImagePath,
    brandPrimaryColor: settings.brandPrimaryColor || DEFAULT_BRAND_PRIMARY_COLOR,
    brandSecondaryColor: settings.brandSecondaryColor || DEFAULT_BRAND_SECONDARY_COLOR,
    welcomeMessage: settings.welcomeMessage,
    thankYouMessage: settings.thankYouMessage,
    qrTemplate: settings.qrTemplate,
    qrBorderStyle: settings.qrBorderStyle,
    qrShape: settings.qrShape,
    qrAccentColor: settings.qrAccentColor,
    qrBackgroundColor: settings.qrBackgroundColor,
  };
}

export function qrOptionsFromBrandingFields(
  premium: boolean,
  fields: {
    logoPath: string | null;
    brandPrimaryColor: string;
    brandSecondaryColor: string;
    brandDisplayName?: string | null;
    brandTagline?: string | null;
    welcomeMessage?: string | null;
    thankYouMessage?: string | null;
    qrTemplate?: string | null;
    qrBorderStyle?: string | null;
    qrShape?: string | null;
    qrAccentColor?: string | null;
    qrBackgroundColor?: string | null;
  },
  businessName: string,
): QrBrandingOptions {
  const displayName =
    premium && fields.brandDisplayName?.trim() ? fields.brandDisplayName.trim() : businessName;
  return {
    premium,
    primaryColor: premium
      ? fields.brandPrimaryColor || DEFAULT_BRAND_PRIMARY_COLOR
      : CARETIP_QR_BRAND_HEX,
    secondaryColor: premium
      ? fields.brandSecondaryColor || DEFAULT_BRAND_SECONDARY_COLOR
      : DEFAULT_BRAND_SECONDARY_COLOR,
    centerLogoUrl: premium && fields.logoPath ? fields.logoPath : null,
    businessName: displayName,
    brandTagline: premium ? fields.brandTagline?.trim() || null : null,
    welcomeMessage: premium ? fields.welcomeMessage?.trim() || null : null,
    thankYouMessage: premium ? fields.thankYouMessage?.trim() || null : null,
    qrTemplate: premium ? normalizeQrTemplateId(fields.qrTemplate) : DEFAULT_QR_TEMPLATE,
    qrBorderStyle: premium ? normalizeQrBorderStyleId(fields.qrBorderStyle) : DEFAULT_QR_BORDER_STYLE,
    qrShape: premium ? normalizeQrShapeId(fields.qrShape) : DEFAULT_QR_SHAPE,
    qrAccentColor: premium ? fields.qrAccentColor?.trim() || undefined : undefined,
    qrBackgroundColor: premium
      ? fields.qrBackgroundColor?.trim() || DEFAULT_QR_BACKGROUND_COLOR
      : undefined,
  };
}

export function qrBrandingFromGuestBranding(branding: PublicGuestBranding): QrBrandingOptions {
  return qrOptionsFromBrandingFields(branding.premium, branding, resolveGuestDisplayName(branding));
}

export function qrBrandingForManager(
  tier: "basic" | "premium" | "enterprise",
  settings: Pick<
    BusinessBrandingSettings,
    | "logoPath"
    | "brandPrimaryColor"
    | "brandSecondaryColor"
    | "brandDisplayName"
    | "brandTagline"
    | "welcomeMessage"
    | "thankYouMessage"
    | "qrTemplate"
    | "qrBorderStyle"
    | "qrShape"
    | "qrAccentColor"
    | "qrBackgroundColor"
  >,
  businessName: string,
): QrBrandingOptions {
  const premium = tier === "premium" || tier === "enterprise";
  return qrOptionsFromBrandingFields(premium, settings, businessName);
}

/** Stable key for QR preview caches — bust when branding fields change. */
export function qrBrandingFingerprint(opts: QrBrandingOptions | null | undefined): string {
  if (!opts) return "";
  return JSON.stringify({
    premium: opts.premium,
    primaryColor: opts.primaryColor,
    secondaryColor: opts.secondaryColor,
    centerLogoUrl: opts.centerLogoUrl,
    businessName: opts.businessName,
    brandTagline: opts.brandTagline ?? null,
    welcomeMessage: opts.welcomeMessage ?? null,
    thankYouMessage: opts.thankYouMessage ?? null,
    ctaText: opts.ctaText ?? null,
    qrTemplate: opts.qrTemplate ?? DEFAULT_QR_TEMPLATE,
    qrBorderStyle: opts.qrBorderStyle ?? DEFAULT_QR_BORDER_STYLE,
    qrShape: opts.qrShape ?? DEFAULT_QR_SHAPE,
    qrAccentColor: opts.qrAccentColor ?? null,
    qrBackgroundColor: opts.qrBackgroundColor ?? null,
    layoutVariant: opts.layoutVariant ?? null,
    decorationsEnabled: opts.decorationsEnabled ?? null,
    showVenueLogoHeader: opts.showVenueLogoHeader ?? null,
    registeredAddress: opts.templateProfile?.registeredAddress ?? null,
    templateFieldVisibility: opts.templateFieldVisibility ?? null,
    logoSize: opts.logoSize ?? null,
    logoOrientation: opts.logoOrientation ?? null,
    logoAlignment: opts.logoAlignment ?? null,
    logoPadding: opts.logoPadding ?? null,
  });
}

export const BUSINESS_BRANDING_CHANGED_EVENT = "caretip-business-branding-changed";

export function notifyBusinessBrandingChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BUSINESS_BRANDING_CHANGED_EVENT));
  }
}

export function trackBrandingClientEvent(
  event:
    | "branding_logo_uploaded"
    | "branding_banner_uploaded"
    | "branding_colors_changed"
    | "branding_welcome_updated"
    | "branding_thankyou_updated"
    | "branding_qr_v2_updated",
  props?: Record<string, unknown>,
): void {
  if (import.meta.env.DEV) {
    console.info("[product_event]", event, props ?? {});
  }
}
