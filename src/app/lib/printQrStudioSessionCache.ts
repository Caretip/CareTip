/**
 * Session-scoped Order Print snapshot + QR data-URL reuse.
 * In-memory only (pageSessionCache). Never localStorage. Cleared on logout.
 */
import type { PhysicalQrCatalogProduct, PhysicalQrContextOptions } from "./api";
import {
  getPageSessionCache,
  invalidatePageSessionCache,
  invalidatePageSessionCacheByPrefix,
  setPageSessionCache,
  PAGE_CACHE_TTL_LOW_MS,
} from "./pageSessionCache";

export const PRINT_QR_STUDIO_CACHE_PREFIX = "print-qr-studio:";

export type PrintQrStudioCartLine = {
  id: string;
  qrContextType: "storefront" | "employee" | "table" | "location";
  qrSubjectId?: string;
  label: string;
  quantity: number;
  locationId?: string | null;
  locationName?: string | null;
};

export type PrintQrStudioSnapshot = {
  businessId: string;
  products: PhysicalQrCatalogProduct[];
  productId: string;
  contexts: PhysicalQrContextOptions;
  cart: PrintQrStudioCartLine[];
  printAddress: string;
  recipientName: string;
  streetLine: string;
  city: string;
  contactEmail: string;
  contactPhone: string;
  previewTargetUrl: string;
};

const QR_DATA_URL_MAX = 8;
const qrDataUrls = new Map<string, string>();

export function printQrStudioCacheKey(businessId: string): string {
  return `${PRINT_QR_STUDIO_CACHE_PREFIX}${businessId.trim()}`;
}

export function readPrintQrStudioSnapshot(businessId: string | null | undefined): PrintQrStudioSnapshot | null {
  const id = businessId?.trim();
  if (!id) return null;
  const hit = getPageSessionCache<PrintQrStudioSnapshot>(printQrStudioCacheKey(id), PAGE_CACHE_TTL_LOW_MS);
  if (!hit || hit.businessId !== id) return null;
  return hit;
}

export function writePrintQrStudioSnapshot(snapshot: PrintQrStudioSnapshot): void {
  const id = snapshot.businessId.trim();
  if (!id) return;
  setPageSessionCache(printQrStudioCacheKey(id), { ...snapshot, businessId: id });
}

export function invalidatePrintQrStudioSnapshot(businessId: string | null | undefined): void {
  const id = businessId?.trim();
  if (!id) return;
  invalidatePageSessionCache(printQrStudioCacheKey(id));
}

function qrCacheKey(businessId: string, targetUrl: string): string {
  return `${businessId.trim()}::${targetUrl.trim()}`;
}

export function getCachedPrintQrDataUrl(
  businessId: string | null | undefined,
  targetUrl: string,
): string | null {
  const id = businessId?.trim();
  const url = targetUrl.trim();
  if (!id || !url) return null;
  return qrDataUrls.get(qrCacheKey(id, url)) ?? null;
}

export function setCachedPrintQrDataUrl(
  businessId: string | null | undefined,
  targetUrl: string,
  dataUrl: string,
): void {
  const id = businessId?.trim();
  const url = targetUrl.trim();
  if (!id || !url || !dataUrl.startsWith("data:")) return;
  const key = qrCacheKey(id, url);
  if (qrDataUrls.has(key)) qrDataUrls.delete(key);
  qrDataUrls.set(key, dataUrl);
  while (qrDataUrls.size > QR_DATA_URL_MAX) {
    const oldest = qrDataUrls.keys().next().value;
    if (oldest == null) break;
    qrDataUrls.delete(oldest);
  }
}

export function clearPrintQrStudioSessionCache(): void {
  invalidatePageSessionCacheByPrefix(PRINT_QR_STUDIO_CACHE_PREFIX);
  qrDataUrls.clear();
}
