import i18n from "@/i18n/i18n";
import {
  DEFAULT_QR_THANK_YOU_MESSAGE,
  resolveQrThankYouMessage,
  type QrBrandingOptions,
} from "../businessBranding";
import type { QrStudioDesignExtras } from "../qrDesignSystem";
import {
  QR_TEMPLATE_FIELD_IDS,
  type QrTemplateBrandingPayload,
  type QrTemplateDefinition,
  type QrTemplateFieldId,
} from "./types";

export type QrTemplateProfileSlice = {
  registeredAddress?: string | null;
  location?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
};

function defaultVisibility(def: QrTemplateDefinition): Record<QrTemplateFieldId, boolean> {
  const vis = {} as Record<QrTemplateFieldId, boolean>;
  for (const field of QR_TEMPLATE_FIELD_IDS) {
    const supported = def.supportedFields.includes(field);
    vis[field] = supported && (def.defaultFieldVisibility[field] ?? false);
  }
  for (const req of def.requiredFields) {
    vis[req] = true;
  }
  return vis;
}

export function mergeFieldVisibility(
  def: QrTemplateDefinition,
  overrides?: Partial<Record<QrTemplateFieldId, boolean>>,
): Record<QrTemplateFieldId, boolean> {
  const base = defaultVisibility(def);
  if (!overrides) return base;
  const merged = { ...base };
  for (const field of QR_TEMPLATE_FIELD_IDS) {
    if (overrides[field] !== undefined && def.supportedFields.includes(field)) {
      merged[field] = overrides[field]!;
    }
  }
  for (const req of def.requiredFields) {
    merged[req] = true;
  }
  return merged;
}

/**
 * Prefer showing filled brand content on the card, even when template defaults hide it.
 * Explicit false overrides (e.g. address toggle) still win.
 */
function applyContentAwareVisibility(
  def: QrTemplateDefinition,
  visibility: Record<QrTemplateFieldId, boolean>,
  content: {
    tagline: string | null;
    website: string | null;
    socialInstagram: string | null;
    socialFacebook: string | null;
    welcomeMessage: string | null;
    showLogo: boolean;
    addressVisibleOverride?: boolean;
  },
): Record<QrTemplateFieldId, boolean> {
  const next = { ...visibility };

  if (def.supportedFields.includes("tagline") && content.tagline) next.tagline = true;
  if (def.supportedFields.includes("website") && content.website) next.website = true;
  if (def.supportedFields.includes("socialInstagram") && content.socialInstagram) {
    next.socialInstagram = true;
  }
  if (def.supportedFields.includes("socialFacebook") && content.socialFacebook) {
    next.socialFacebook = true;
  }
  if (def.supportedFields.includes("welcomeMessage") && content.welcomeMessage) {
    next.welcomeMessage = true;
  }

  if (content.addressVisibleOverride === false) next.address = false;

  // Logo toggle always wins over required-field defaults for studio preview.
  if (def.supportedFields.includes("logo")) {
    next.logo = content.showLogo;
  }

  return next;
}

export function buildQrTemplateBrandingPayload(input: {
  branding: QrBrandingOptions;
  profile?: QrTemplateProfileSlice | null;
  extras?: Pick<
    QrStudioDesignExtras,
    | "ctaText"
    | "websiteUrl"
    | "socialInstagram"
    | "socialFacebook"
    | "templateFieldVisibility"
    | "showVenueLogoHeader"
    | "logoSize"
    | "logoOrientation"
    | "logoAlignment"
    | "logoPadding"
  > | null;
  template: QrTemplateDefinition;
}): QrTemplateBrandingPayload {
  const { branding, profile, extras, template } = input;
  const premium = branding.premium === true;

  const address =
    profile?.registeredAddress?.trim() || profile?.location?.trim() || null;
  const website = extras?.websiteUrl?.trim() || profile?.website?.trim() || null;
  const tagline = premium ? branding.brandTagline?.trim() || null : null;
  const welcomeMessage = premium ? branding.welcomeMessage?.trim() || null : null;
  const socialInstagram = premium ? extras?.socialInstagram?.trim() || null : null;
  const socialFacebook = premium ? extras?.socialFacebook?.trim() || null : null;
  const logoUrl = premium ? branding.centerLogoUrl : null;

  const baseVisibility = mergeFieldVisibility(template, extras?.templateFieldVisibility);
  const fieldVisibility = applyContentAwareVisibility(template, baseVisibility, {
    tagline,
    website,
    socialInstagram,
    socialFacebook,
    welcomeMessage,
    showLogo: extras?.showVenueLogoHeader !== false,
    addressVisibleOverride: extras?.templateFieldVisibility?.address,
  });

  return {
    premium,
    logoUrl,
    businessName: branding.businessName.trim(),
    tagline,
    welcomeMessage,
    thankYouMessage: resolveQrThankYouMessage(
      premium,
      branding.thankYouMessage,
      i18n.t("business.branding.defaultThankYouMessage", {
        defaultValue: DEFAULT_QR_THANK_YOU_MESSAGE,
      }),
    ),
    ctaText: premium ? extras?.ctaText?.trim() || branding.ctaText?.trim() || "Scan to tip" : null,
    address: premium ? address : null,
    phone: premium ? profile?.contactPhone?.trim() || null : null,
    email: premium ? profile?.contactEmail?.trim() || null : null,
    website: premium ? website : null,
    socialInstagram,
    socialFacebook,
    primaryColor: branding.primaryColor,
    secondaryColor: branding.secondaryColor,
    qrAccentColor: branding.qrAccentColor?.trim() || branding.primaryColor,
    qrModuleLight: "#FFFFFF",
    fieldVisibility,
    logoLayout: {
      size: extras?.logoSize ?? "medium",
      orientation: extras?.logoOrientation ?? "square",
      alignment: extras?.logoAlignment ?? "center",
      padding: extras?.logoPadding ?? "balanced",
    },
  };
}
