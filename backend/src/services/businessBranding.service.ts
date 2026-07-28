import { prisma } from "../prisma.js";
import { hasFeature, resolveSubscriptionEntitlements } from "./subscriptionEntitlement.service.js";
import { trackProductEvent } from "./productEvent.service.js";
import { assertValidBrandHexColor, DEFAULT_BRAND_SECONDARY_COLOR } from "../lib/brandColorValidation.js";
import {
  assertQrBorderStyle,
  assertQrShape,
  assertQrTemplate,
  normalizeQrTemplate,
  trimBrandDisplayName,
  trimBrandTagline,
} from "../lib/qrBrandingValidation.js";
import { assertQrModuleContrast, moduleLightForTemplate } from "../lib/qrColorContrast.js";
import {
  BUSINESS_BRANDING_SELECT,
  toBusinessBrandingSettingsDto,
  type BusinessBrandingSettingsDto,
} from "./businessBranding.dto.js";
import { emitBusinessDataChanged } from "../socket/socketEmitters.js";
import { invalidateBrandedQrCacheForBusiness } from "./qr/brandedQrRender.service.js";

const WELCOME_MAX = 120;
const THANK_YOU_MAX = 250;

function trimMessage(raw: unknown, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > max) {
    throw new Error(`Message must be at most ${max} characters.`);
  }
  return s;
}

export async function getBrandingSettingsForManager(
  businessId: string,
): Promise<BusinessBrandingSettingsDto | null> {
  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: BUSINESS_BRANDING_SELECT,
  });
  if (!row) return null;
  const canEdit = await hasFeature(businessId, "brandingCustomization");
  const entitlements = await resolveSubscriptionEntitlements(businessId);
  return toBusinessBrandingSettingsDto(row, canEdit, entitlements.subscriptionTier);
}

export async function updateBrandingSettings(
  businessId: string,
  data: {
    brandPrimaryColor?: string;
    brandSecondaryColor?: string;
    welcomeMessage?: string | null;
    thankYouMessage?: string | null;
    brandDisplayName?: string | null;
    brandTagline?: string | null;
    qrTemplate?: string;
    qrBorderStyle?: string;
    qrShape?: string;
    qrAccentColor?: string;
    qrBackgroundColor?: string;
  },
): Promise<BusinessBrandingSettingsDto> {
  const existing = await prisma.business.findUnique({
    where: { id: businessId },
    select: BUSINESS_BRANDING_SELECT,
  });
  if (!existing) throw new Error("Business not found");

  const patch: {
    brandPrimaryColor?: string;
    brandSecondaryColor?: string;
    welcomeMessage?: string | null;
    thankYouMessage?: string | null;
    brandDisplayName?: string | null;
    brandTagline?: string | null;
    qrTemplate?: string;
    qrBorderStyle?: string;
    qrShape?: string;
    qrAccentColor?: string | null;
    qrBackgroundColor?: string;
  } = {};

  if (data.brandPrimaryColor !== undefined) {
    patch.brandPrimaryColor = assertValidBrandHexColor(data.brandPrimaryColor, "Primary color");
  }
  if (data.brandSecondaryColor !== undefined) {
    patch.brandSecondaryColor = assertValidBrandHexColor(data.brandSecondaryColor, "Secondary color");
  }
  if (data.welcomeMessage !== undefined) {
    patch.welcomeMessage = trimMessage(data.welcomeMessage, WELCOME_MAX);
  }
  if (data.thankYouMessage !== undefined) {
    patch.thankYouMessage = trimMessage(data.thankYouMessage, THANK_YOU_MAX);
  }
  if (data.brandDisplayName !== undefined) {
    patch.brandDisplayName = trimBrandDisplayName(data.brandDisplayName);
  }
  if (data.brandTagline !== undefined) {
    patch.brandTagline = trimBrandTagline(data.brandTagline);
  }
  if (data.qrTemplate !== undefined) {
    patch.qrTemplate = assertQrTemplate(data.qrTemplate);
  }
  if (data.qrBorderStyle !== undefined) {
    patch.qrBorderStyle = assertQrBorderStyle(data.qrBorderStyle);
  }
  if (data.qrShape !== undefined) {
    patch.qrShape = assertQrShape(data.qrShape);
  }
  if (data.qrAccentColor !== undefined) {
    const raw = String(data.qrAccentColor ?? "").trim();
    patch.qrAccentColor = raw ? assertValidBrandHexColor(raw, "QR accent color") : null;
  }
  if (data.qrBackgroundColor !== undefined) {
    patch.qrBackgroundColor = assertValidBrandHexColor(data.qrBackgroundColor, "QR background color");
  }

  if (Object.keys(patch).length === 0) {
    return toBusinessBrandingSettingsDto(existing, true);
  }

  const canEdit = await hasFeature(businessId, "brandingCustomization");
  if (canEdit) {
    const secondary =
      patch.brandSecondaryColor ??
      existing.brandSecondaryColor ??
      DEFAULT_BRAND_SECONDARY_COLOR;
    const template = normalizeQrTemplate(patch.qrTemplate ?? existing.qrTemplate);
    const moduleLight = moduleLightForTemplate(template);
    assertQrModuleContrast(secondary, moduleLight);
  }

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: patch,
    select: BUSINESS_BRANDING_SELECT,
  });

  if (patch.brandPrimaryColor !== undefined || patch.brandSecondaryColor !== undefined) {
    trackProductEvent("branding_colors_changed", {
      businessId,
      brandPrimaryColor: updated.brandPrimaryColor,
      brandSecondaryColor: updated.brandSecondaryColor,
    });
  }
  if (patch.welcomeMessage !== undefined) {
    trackProductEvent("branding_welcome_updated", { businessId });
  }
  if (patch.thankYouMessage !== undefined) {
    trackProductEvent("branding_thankyou_updated", { businessId });
  }
  if (
    patch.brandDisplayName !== undefined ||
    patch.brandTagline !== undefined ||
    patch.qrTemplate !== undefined ||
    patch.qrBorderStyle !== undefined ||
    patch.qrShape !== undefined ||
    patch.qrAccentColor !== undefined ||
    patch.qrBackgroundColor !== undefined
  ) {
    trackProductEvent("branding_qr_v2_updated", {
      businessId,
      qrTemplate: updated.qrTemplate,
      qrBorderStyle: updated.qrBorderStyle,
      qrShape: updated.qrShape,
    });
  }

  emitBusinessDataChanged(businessId, "branding_updated");
  invalidateBrandedQrCacheForBusiness(businessId);
  return toBusinessBrandingSettingsDto(updated, true);
}

export async function setBusinessBannerPath(businessId: string, publicPath: string): Promise<void> {
  await prisma.business.update({
    where: { id: businessId },
    data: { bannerImagePath: publicPath },
  });
  trackProductEvent("branding_banner_uploaded", { businessId });
  emitBusinessDataChanged(businessId, "branding_updated");
  invalidateBrandedQrCacheForBusiness(businessId);
}

export function trackBrandingLogoUploaded(businessId: string): void {
  trackProductEvent("branding_logo_uploaded", { businessId });
  invalidateBrandedQrCacheForBusiness(businessId);
}
