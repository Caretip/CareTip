import {
  fetchBusinessBrandingSettings,
  fetchBusinessProfile,
  getBusinessById,
  type BusinessInfo,
} from "./api";
import {
  pickRegisteredBusinessName,
  type QrBrandingOptions,
} from "./businessBranding";
import { buildUnifiedQrBrandingOptions } from "./qrBrandingSnapshot";
import { loadQrStudioDesignExtras } from "./qrDesignSystem";
import {
  DEFAULT_QR_BACKGROUND_COLOR,
  DEFAULT_QR_BORDER_STYLE,
  DEFAULT_QR_SHAPE,
  DEFAULT_QR_TEMPLATE,
} from "./qrTemplateStyles";
import { logClientError } from "./clientLog";

export type QrRenderBrandingSource =
  | {
      mode: "manager";
      businessId: string;
      tier: "basic" | "premium" | "enterprise";
      fallbackBusinessName?: string;
      /** Skip redundant profile fetch when caller already loaded it. */
      prefetchedProfile?: Pick<
        BusinessInfo,
        "name" | "businessName" | "registeredAddress" | "location" | "contactPhone" | "website" | "logo"
      >;
    }
  | { mode: "employee"; businessId: string };

/** Shared QR render branding for surfaces OUTSIDE QR Studio (staff modal, public guest).
 * QR Studio must use BusinessBrandingProvider / useBusinessBrandingSnapshot instead.
 */
export async function loadQrRenderBranding(
  source: QrRenderBrandingSource,
): Promise<QrBrandingOptions | null> {
  const { businessId } = source;
  if (!businessId?.trim()) return null;

  try {
    if (source.mode === "manager") {
      const [settings, profile] = await Promise.all([
        fetchBusinessBrandingSettings(),
        source.prefetchedProfile
          ? Promise.resolve(source.prefetchedProfile as BusinessInfo)
          : fetchBusinessProfile(),
      ]);
      const premium = source.tier === "premium" || source.tier === "enterprise";
      const registeredName = pickRegisteredBusinessName(
        profile,
        source.fallbackBusinessName,
      );
      return buildUnifiedQrBrandingOptions({
        premium,
        settings,
        registeredBusinessName: registeredName,
        profile,
        extras: loadQrStudioDesignExtras(businessId),
        businessId,
        sessionFallbackName: source.fallbackBusinessName,
      });
    }

    const profile = await getBusinessById(businessId);
    if (!profile?.branding) return null;
    const b = profile.branding;
    const registeredName = pickRegisteredBusinessName(profile, b.businessName);
    return buildUnifiedQrBrandingOptions({
      premium: b.premium === true,
      settings: {
        logoPath: b.logoPath,
        brandPrimaryColor: b.brandPrimaryColor,
        brandSecondaryColor: b.brandSecondaryColor,
        brandDisplayName: b.brandDisplayName,
        brandTagline: b.brandTagline,
        welcomeMessage: b.welcomeMessage,
        thankYouMessage: b.thankYouMessage,
        qrTemplate: b.qrTemplate,
        qrBorderStyle: b.qrBorderStyle,
        qrShape: b.qrShape,
        qrAccentColor: b.qrAccentColor,
        qrBackgroundColor: b.qrBackgroundColor,
      },
      registeredBusinessName: registeredName,
      profile,
      extras: loadQrStudioDesignExtras(businessId),
      businessId,
      sessionFallbackName: b.businessName,
    });
  } catch (err) {
    logClientError("loadQrRenderBranding", err);
    return null;
  }
}

/** Manager fallback when branding APIs fail — still merges Studio extras when possible. */
export function fallbackManagerQrRenderBranding(
  tier: "basic" | "premium" | "enterprise",
  businessName: string,
  logoPath?: string | null,
  businessId?: string | null,
): QrBrandingOptions {
  const premium = tier === "premium" || tier === "enterprise";
  return buildUnifiedQrBrandingOptions({
    premium,
    settings: {
      logoPath: logoPath ?? null,
      brandPrimaryColor: "#EB992C",
      brandSecondaryColor: "#000000",
      brandDisplayName: null,
      brandTagline: null,
      welcomeMessage: null,
      thankYouMessage: null,
      qrTemplate: DEFAULT_QR_TEMPLATE,
      qrBorderStyle: DEFAULT_QR_BORDER_STYLE,
      qrShape: DEFAULT_QR_SHAPE,
      qrAccentColor: "#EB992C",
      qrBackgroundColor: DEFAULT_QR_BACKGROUND_COLOR,
    },
    registeredBusinessName: businessName,
    profile: { name: businessName },
    extras: businessId ? loadQrStudioDesignExtras(businessId) : undefined,
    businessId,
    sessionFallbackName: businessName,
  });
}
