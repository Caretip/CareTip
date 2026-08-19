import { createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { brandedQrCache } from "./brandedQrCache.service.js";
import { DIGITAL_PLAIN_QR_FINGERPRINT, renderDigitalPlainQrPngBuffer } from "./digitalPlainQrPng.js";
import {
  BrandedQrNotFoundError,
  BrandedQrRenderFailedError,
} from "./brandedQr.errors.js";
import type { BrandedQrImageDto } from "./brandedQr.dto.js";
import { logServerError } from "../../utils/httpErrors.js";

export function brandedQrCacheKey(businessId: string, targetUrl: string, fingerprint: string): string {
  const urlHash = createHash("sha256").update(targetUrl.trim()).digest("hex").slice(0, 16);
  return `${businessId}:${fingerprint}:${urlHash}`;
}

function bufferToDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function etagForBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 32);
}

/**
 * Digital QR PNG for mobile / staff downloads.
 * Plain black-on-white matrix of `targetUrl` — not the Physical A5 flyer and not the old branded card.
 */
export async function renderBrandedQrPngBuffer(
  businessId: string,
  targetUrl: string,
  mode: "manager" | "employee",
): Promise<{ buffer: Buffer; etag: string; fingerprint: string; fallback?: "standard" }> {
  const trimmedUrl = targetUrl.trim();
  if (!trimmedUrl) throw new BrandedQrNotFoundError("targetUrl is required");

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true },
  });
  if (!business) throw new BrandedQrNotFoundError("Business not found");

  const fingerprint = DIGITAL_PLAIN_QR_FINGERPRINT;
  const cacheKey = brandedQrCacheKey(businessId, trimmedUrl, fingerprint);
  const cached = brandedQrCache.get(cacheKey);
  if (cached) {
    return { buffer: cached.buffer, etag: cached.etag, fingerprint };
  }

  let buffer: Buffer;
  try {
    buffer = await renderDigitalPlainQrPngBuffer(trimmedUrl);
  } catch (err) {
    logServerError("brandedQr.render.plainFailed", err, {
      businessId,
      mode,
      targetUrl: trimmedUrl,
    });
    if (err instanceof BrandedQrRenderFailedError) throw err;
    throw new BrandedQrRenderFailedError();
  }

  const etag = etagForBuffer(buffer);
  brandedQrCache.set(cacheKey, { buffer, etag: `"${etag}"`, fingerprint, at: Date.now() });
  return { buffer, etag: `"${etag}"`, fingerprint };
}

export async function buildBrandedQrImageDto(
  businessId: string,
  targetUrl: string,
  mode: "manager" | "employee",
): Promise<BrandedQrImageDto> {
  const { buffer, etag } = await renderBrandedQrPngBuffer(businessId, targetUrl, mode);
  const brandingVersion = etag.replace(/^"|"$/g, "");
  return {
    success: true,
    imageUrl: bufferToDataUrl(buffer),
    lastUpdated: new Date().toISOString(),
    brandingVersion,
  };
}

export function invalidateBrandedQrCacheForBusiness(businessId: string): void {
  brandedQrCache.invalidateBusiness(businessId);
}
