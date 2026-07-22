import {
  fetchBusinessBrandingSettings,
  fetchBusinessProfile,
  getBusinessById,
  type BusinessInfo,
} from "./api";
import {
  qrBrandingForManager,
  qrBrandingFromGuestBranding,
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
        "name" | "registeredAddress" | "location" | "contactPhone" | "website"
      >;
    }
  | { mode: "employee"; businessId: string };

function templateProfileFromBusinessInfo(
  profile: Pick<
    BusinessInfo,
    "registeredAddress" | "location" | "contactPhone" | "website"
  >,
): NonNullable<QrBrandingOptions["templateProfile"]> {
  return {
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
    "registeredAddress" | "location" | "contactPhone" | "website"
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
      const name =
        String(profile.name ?? "").trim() ||
        String(source.fallbackBusinessName ?? "").trim() ||
        "Business";
      const base = qrBrandingForManager(source.tier, settings, name);
      return mergeStudioExtras(businessId, base, profile);
    }

    const profile = await getBusinessById(businessId);
    if (!profile?.branding) return null;
    const base = qrBrandingFromGuestBranding(profile.branding);
    return mergeStudioExtras(businessId, base, profile);
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
  return qrBrandingForManager(
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
    businessName.trim() || "Business",
  );
}
