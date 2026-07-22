import type { QrBrandingOptions } from "./businessBranding";
import { renderBrandedQrUrlToDataUrl } from "./qrBranded";

/** Live preview debounce — balances instant feel vs canvas churn. */
export const QR_STUDIO_PREVIEW_DEBOUNCE_MS = 300;

/** Gallery card thumbnails — sharp enough at card size, faster than validation pipeline. */
export const QR_GALLERY_THUMBNAIL_SCALE = 2 as const;

/** Background reliability meta — lower priority than thumbnail paint. */
export const QR_GALLERY_META_CONCURRENCY = 2;

export async function renderQrGalleryThumbnail(
  url: string,
  branding?: Partial<QrBrandingOptions>,
): Promise<string> {
  return renderBrandedQrUrlToDataUrl(url, branding, { scale: QR_GALLERY_THUMBNAIL_SCALE });
}

/** Run async work with a fixed concurrency limit (gallery meta validation). */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
