import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prisma } from "../../prisma.js";
import { resolveSubscriptionEntitlements } from "../subscriptionEntitlement.service.js";
import {
  BUSINESS_BRANDING_SELECT,
  toPublicGuestBrandingDto,
} from "../businessBranding.dto.js";
import { getBrandingSettingsForManager } from "../businessBranding.service.js";
import { brandedQrCache } from "./brandedQrCache.service.js";
import { resolveQrRenderBundlePath } from "../../qr/resolveQrRenderBundlePath.js";
import {
  BrandedQrNotFoundError,
  BrandedQrRenderFailedError,
  BrandedQrRenderUnavailableError,
} from "./brandedQr.errors.js";
import type { BrandedQrImageDto } from "./brandedQr.dto.js";
import { logServerError } from "../../utils/httpErrors.js";

type QrRenderBundle = {
  renderBrandedQrUrlToDataUrl: (
    url: string,
    branding?: Record<string, unknown>,
    renderOptions?: { scale?: number; smoothScale?: boolean },
  ) => Promise<string>;
  buildUnifiedQrBrandingOptions: (input: Record<string, unknown>) => Record<string, unknown>;
  qrBrandingFingerprint: (opts: Record<string, unknown> | null | undefined) => string;
  setQrCanvasEnvironment: (env: unknown) => void;
};

let bundlePromise: Promise<QrRenderBundle> | null = null;

async function loadRenderBundle(): Promise<QrRenderBundle> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      let bundlePath: string;
      try {
        bundlePath = resolveQrRenderBundlePath();
      } catch (err) {
        logServerError("brandedQr.loadRenderBundle.missing", err);
        throw new BrandedQrRenderUnavailableError();
      }

      try {
        const bundle = (await import(pathToFileURL(bundlePath).href)) as QrRenderBundle;
        const { installNodeQrCanvas } = await import("../../qr/installNodeQrCanvas.js");
        installNodeQrCanvas(bundle);
        return bundle;
      } catch (err) {
        logServerError("brandedQr.loadRenderBundle.import", err, { bundlePath });
        throw new BrandedQrRenderUnavailableError();
      }
    })();
  }
  return bundlePromise;
}

export function brandedQrCacheKey(businessId: string, targetUrl: string, fingerprint: string): string {
  const urlHash = createHash("sha256").update(targetUrl.trim()).digest("hex").slice(0, 16);
  return `${businessId}:${fingerprint}:${urlHash}`;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  if (!dataUrl?.startsWith("data:image/png")) {
    throw new BrandedQrRenderFailedError();
  }
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return Buffer.from(base64, "base64");
}

function bufferToDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function etagForBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 32);
}

async function renderDataUrl(
  targetUrl: string,
  branding: Record<string, unknown>,
  context: string,
): Promise<string> {
  const bundle = await loadRenderBundle();
  try {
    const dataUrl = await bundle.renderBrandedQrUrlToDataUrl(targetUrl, branding);
    if (!dataUrl?.startsWith("data:image/png")) {
      logServerError("brandedQr.render.empty", new Error("Renderer returned empty PNG"), {
        context,
        targetUrl,
      });
      throw new BrandedQrRenderFailedError();
    }
    return dataUrl;
  } catch (err) {
    if (
      err instanceof BrandedQrRenderFailedError ||
      err instanceof BrandedQrRenderUnavailableError
    ) {
      throw err;
    }
    logServerError("brandedQr.render.exception", err, { context, targetUrl });
    throw new BrandedQrRenderFailedError();
  }
}

async function buildStandardBrandingOptions(bundle: QrRenderBundle) {
  return bundle.buildUnifiedQrBrandingOptions({
    premium: false,
    settings: {},
    registeredBusinessName: "CareTip Venue",
    profile: { name: "CareTip Venue" },
    businessId: "standard",
    sessionFallbackName: "CareTip Venue",
  });
}

export async function buildManagerQrBrandingOptions(businessId: string) {
  const settings = await getBrandingSettingsForManager(businessId);
  if (!settings) throw new BrandedQrNotFoundError("Business branding not found");

  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      location: true,
      registeredAddress: true,
      contactPhone: true,
      website: true,
    },
  });
  if (!row) throw new BrandedQrNotFoundError("Business not found");

  const entitlements = await resolveSubscriptionEntitlements(businessId);
  const premium =
    entitlements.subscriptionTier === "premium" || entitlements.subscriptionTier === "enterprise";

  const bundle = await loadRenderBundle();
  return bundle.buildUnifiedQrBrandingOptions({
    premium,
    settings,
    registeredBusinessName: row.name,
    profile: {
      name: row.name,
      registeredAddress: row.registeredAddress,
      location: row.location,
      contactPhone: row.contactPhone,
      website: row.website,
    },
    businessId,
    sessionFallbackName: row.name,
  });
}

export async function buildEmployeeQrBrandingOptions(businessId: string) {
  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: BUSINESS_BRANDING_SELECT,
  });
  if (!row) throw new BrandedQrNotFoundError("Business not found");

  const entitlements = await resolveSubscriptionEntitlements(businessId);
  const guest = toPublicGuestBrandingDto(row, entitlements.subscriptionTier);
  const bundle = await loadRenderBundle();

  return bundle.buildUnifiedQrBrandingOptions({
    premium: guest.premium,
    settings: {
      logoPath: guest.logoPath,
      brandPrimaryColor: guest.brandPrimaryColor,
      brandSecondaryColor: guest.brandSecondaryColor,
      brandDisplayName: guest.brandDisplayName,
      brandTagline: guest.brandTagline,
      welcomeMessage: guest.welcomeMessage,
      thankYouMessage: guest.thankYouMessage,
      qrTemplate: guest.qrTemplate,
      qrBorderStyle: guest.qrBorderStyle,
      qrShape: guest.qrShape,
      qrAccentColor: guest.qrAccentColor,
      qrBackgroundColor: guest.qrBackgroundColor,
    },
    registeredBusinessName: guest.businessName,
    profile: { name: row.name },
    businessId,
    sessionFallbackName: guest.businessName,
  });
}

export async function renderBrandedQrPngBuffer(
  businessId: string,
  targetUrl: string,
  mode: "manager" | "employee",
): Promise<{ buffer: Buffer; etag: string; fingerprint: string; fallback?: "standard" }> {
  const trimmedUrl = targetUrl.trim();
  if (!trimmedUrl) throw new BrandedQrNotFoundError("targetUrl is required");

  const branding =
    mode === "employee"
      ? await buildEmployeeQrBrandingOptions(businessId)
      : await buildManagerQrBrandingOptions(businessId);

  const bundle = await loadRenderBundle();
  const fingerprint = bundle.qrBrandingFingerprint(branding);
  const cacheKey = brandedQrCacheKey(businessId, trimmedUrl, fingerprint);

  const cached = brandedQrCache.get(cacheKey);
  if (cached) {
    return { buffer: cached.buffer, etag: cached.etag, fingerprint };
  }

  let dataUrl: string;
  let fallback: "standard" | undefined;
  try {
    dataUrl = await renderDataUrl(trimmedUrl, branding, `${mode}:branded`);
  } catch (brandedErr) {
    logServerError("brandedQr.render.brandedFailed", brandedErr, {
      businessId,
      mode,
      targetUrl: trimmedUrl,
    });
    const standardBranding = await buildStandardBrandingOptions(bundle);
    dataUrl = await renderDataUrl(trimmedUrl, standardBranding, `${mode}:standard-fallback`);
    fallback = "standard";
  }

  const buffer = dataUrlToBuffer(dataUrl);
  const etag = etagForBuffer(buffer);

  brandedQrCache.set(cacheKey, { buffer, etag: `"${etag}"`, fingerprint, at: Date.now() });
  return { buffer, etag: `"${etag}"`, fingerprint, fallback };
}

export async function buildBrandedQrImageDto(
  businessId: string,
  targetUrl: string,
  mode: "manager" | "employee",
): Promise<BrandedQrImageDto> {
  const { buffer, etag, fallback } = await renderBrandedQrPngBuffer(businessId, targetUrl, mode);
  const brandingVersion = etag.replace(/^"|"$/g, "");
  return {
    success: true,
    imageUrl: bufferToDataUrl(buffer),
    lastUpdated: new Date().toISOString(),
    brandingVersion,
    ...(fallback ? { fallback } : {}),
  };
}

export function invalidateBrandedQrCacheForBusiness(businessId: string): void {
  brandedQrCache.invalidateBusiness(businessId);
}
