/**
 * Canonical builder for QrBrandingOptions.
 * In QR Studio, call this ONLY inside BusinessBrandingProvider.
 * Outside Studio (public guest, staff modal), loaders may call this after fetching persisted settings.
 */

import {
  pickRegisteredBusinessName,
  qrOptionsFromBrandingFields,
  resolveQrCardBusinessName,
  type BusinessBrandingSettings,
  type QrBrandingOptions,
} from "./businessBranding";
import {
  DEFAULT_QR_STUDIO_EXTRAS,
  loadQrStudioDesignExtras,
  mergeQrStudioBranding,
  type QrStudioDesignExtras,
} from "./qrDesignSystem";

export const QR_STUDIO_CTA_DEFAULT = "Scan to Tip";

export type QrBrandingProfileSlice = {
  name?: string | null;
  businessName?: string | null;
  registeredAddress?: string | null;
  location?: string | null;
  contactPhone?: string | null;
  website?: string | null;
};

export type BuildUnifiedQrBrandingInput = {
  premium: boolean;
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
  >;
  /** Registered / onboarding business name (profile or session). */
  registeredBusinessName: string;
  profile?: QrBrandingProfileSlice | null;
  /** Studio extras — pass live state in Studio; otherwise loaded from localStorage. */
  extras?: QrStudioDesignExtras | null;
  businessId?: string | null;
  sessionFallbackName?: string | null;
};

/**
 * Canonical branded QR options for every surface:
 * Branding Studio preview, gallery thumbs, employee/location/business cards, Live Preview, PNG/PDF.
 */
export function buildUnifiedQrBrandingOptions(input: BuildUnifiedQrBrandingInput): QrBrandingOptions {
  const extras =
    input.extras ??
    (input.businessId ? loadQrStudioDesignExtras(input.businessId) : DEFAULT_QR_STUDIO_EXTRAS);

  const registeredName = pickRegisteredBusinessName(
    input.profile,
    input.registeredBusinessName,
    input.sessionFallbackName,
  );

  const cardName = resolveQrCardBusinessName({
    premium: input.premium,
    registeredName,
    brandDisplayName: input.settings.brandDisplayName,
    sessionFallbackName: input.sessionFallbackName ?? input.registeredBusinessName,
  });

  const base = qrOptionsFromBrandingFields(
    input.premium,
    {
      logoPath: input.settings.logoPath,
      brandPrimaryColor: input.settings.brandPrimaryColor,
      brandSecondaryColor: input.settings.brandSecondaryColor,
      brandDisplayName: input.settings.brandDisplayName,
      brandTagline: input.settings.brandTagline,
      welcomeMessage: input.settings.welcomeMessage,
      thankYouMessage: input.settings.thankYouMessage,
      qrTemplate: input.settings.qrTemplate,
      qrBorderStyle: input.settings.qrBorderStyle,
      qrShape: input.settings.qrShape,
      qrAccentColor: input.settings.qrAccentColor,
      qrBackgroundColor: input.settings.qrBackgroundColor,
    },
    registeredName || cardName,
  );

  const merged = mergeQrStudioBranding(
    {
      ...base,
      // Normalize CTA so Studio and gallery never diverge on casing.
      ctaText: extras.ctaText.trim() || QR_STUDIO_CTA_DEFAULT,
    },
    {
      ...extras,
      ctaText: extras.ctaText.trim() || QR_STUDIO_CTA_DEFAULT,
      // Prefer Studio website override; fall back to profile website for guest parity.
      websiteUrl: extras.websiteUrl.trim() || input.profile?.website?.trim() || "",
    },
  );

  return {
    ...merged,
    businessName: cardName,
    welcomeMessage: input.premium ? input.settings.welcomeMessage?.trim() || null : null,
    thankYouMessage: input.premium ? input.settings.thankYouMessage?.trim() || null : null,
    brandTagline: input.settings.brandTagline?.trim() || null,
    ctaText: merged.ctaText?.trim() || QR_STUDIO_CTA_DEFAULT,
    templateProfile: {
      name: registeredName || null,
      registeredAddress: input.profile?.registeredAddress ?? null,
      location: input.profile?.location ?? null,
      contactPhone: input.profile?.contactPhone ?? null,
      website:
        String(input.profile?.website ?? "").trim() ||
        extras.websiteUrl.trim() ||
        null,
    },
  };
}
