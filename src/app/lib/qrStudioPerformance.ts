import { PLAIN_QR_PREVIEW_WIDTH_PX, renderPlainQrUrlToDataUrl } from "./plainQr";

/** Live preview debounce — balances instant feel vs canvas churn. */
export const QR_STUDIO_PREVIEW_DEBOUNCE_MS = 300;

/** Gallery card thumbnails — sharp enough at card size, faster than validation pipeline. */
export const QR_GALLERY_THUMBNAIL_SCALE = 2 as const;

/** Background reliability meta — lower priority than thumbnail paint. */
export const QR_GALLERY_META_CONCURRENCY = 2;

/** Digital management cards — plain QR only (not branded template cards, not Physical A5). */
export async function renderQrGalleryThumbnail(url: string): Promise<string> {
  return renderPlainQrUrlToDataUrl(url, { width: PLAIN_QR_PREVIEW_WIDTH_PX });
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
