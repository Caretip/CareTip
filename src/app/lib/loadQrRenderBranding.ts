import {
  fetchBusinessBrandingSettings,
  fetchBusinessProfile,
  getBusinessById,
  type BusinessInfo,
} from "./api";
import {
  qrBrandingForManager,
  qrBrandingFromGuestBranding,
  pickRegisteredBusinessName,
  resolveQrCardBusinessName,
  type QrBrandingOptions,
} from "./businessBranding";
import { loadQrStudioDesignExtras, mergeQrStudioBranding } from "./qrDesignSystem";
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
        "name" | "businessName" | "registeredAddress" | "location" | "contactPhone" | "website"
      >;
    }
  | { mode: "employee"; businessId: string };

function templateProfileFromBusinessInfo(
  profile: Pick<
    BusinessInfo,
    "name" | "businessName" | "registeredAddress" | "location" | "contactPhone" | "website"
  >,
): NonNullable<QrBrandingOptions["templateProfile"]> {
  return {
    name: pickRegisteredBusinessName(profile) || null,
    registeredAddress: profile.registeredAddress ?? null,
    location: profile.location ?? null,
    contactPhone: profile.contactPhone ?? null,
    website: profile.website ?? null,
  };
}

function mergeStudioExtras(
  businessId: string,
  base: QrBrandingOptions,
  profile: Pick<
    BusinessInfo,
    "name" | "businessName" | "registeredAddress" | "location" | "contactPhone" | "website"
  >,
): QrBrandingOptions {
  const extras = loadQrStudioDesignExtras(businessId);
  return {
    ...mergeQrStudioBranding(base, extras),
    templateProfile: templateProfileFromBusinessInfo(profile),
  };
}

/** Shared QR render branding — same pipeline for QR Studio, employee modal, and exports. */
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
      const registeredName = pickRegisteredBusinessName(
        profile,
        source.fallbackBusinessName,
      );
      const cardName = resolveQrCardBusinessName({
        premium: source.tier === "premium" || source.tier === "enterprise",
        registeredName,
        brandDisplayName: settings.brandDisplayName,
        sessionFallbackName: source.fallbackBusinessName,
      });
      const base = qrBrandingForManager(source.tier, settings, registeredName || cardName);
      const merged = mergeStudioExtras(businessId, base, profile);
      return {
        ...merged,
        businessName: cardName,
        templateProfile: {
          ...merged.templateProfile,
          name: registeredName || merged.templateProfile?.name || null,
        },
      };
    }

    const profile = await getBusinessById(businessId);
    if (!profile?.branding) return null;
    const base = qrBrandingFromGuestBranding(profile.branding);
    const merged = mergeStudioExtras(businessId, base, profile);
    const registeredName = pickRegisteredBusinessName(
      profile,
      profile.branding.businessName,
    );
    const cardName = resolveQrCardBusinessName({
      premium: base.premium,
      registeredName,
      brandDisplayName: profile.branding.brandDisplayName,
      sessionFallbackName: profile.branding.businessName,
    });
    return {
      ...merged,
      businessName: cardName,
      templateProfile: {
        ...merged.templateProfile,
        name: registeredName || null,
      },
    };
  } catch (err) {
    logClientError("loadQrRenderBranding", err);
    return null;
  }
}

/** Manager fallback when branding APIs fail (matches QRCodeManagementPage). */
export function fallbackManagerQrRenderBranding(
  tier: "basic" | "premium" | "enterprise",
  businessName: string,
  logoPath?: string | null,
): QrBrandingOptions {
  const name = resolveQrCardBusinessName({
    premium: tier === "premium" || tier === "enterprise",
    registeredName: businessName,
  });
  return {
    ...qrBrandingForManager(
      tier,
      {
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
      name,
    ),
    businessName: name,
    templateProfile: {
      name: String(businessName ?? "").trim() || null,
    },
  };
}
