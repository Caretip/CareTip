/**
 * Canvas + image loading abstraction — browser default; Node backend sets its own adapter
 * so the same qrTemplateEngine renderer runs server-side for branded QR PNG export.
 */

export type QrCanvasEnvironment = {
  createCanvas(width: number, height: number): HTMLCanvasElement;
  loadImage(url: string): Promise<HTMLImageElement | null>;
};

const IMAGE_CACHE_MAX = 48;
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function trimImageCache(): void {
  while (imageCache.size > IMAGE_CACHE_MAX) {
    const oldest = imageCache.keys().next().value;
    if (!oldest) break;
    imageCache.delete(oldest);
  }
}

function browserLoadImage(url: string): Promise<HTMLImageElement | null> {
  const key = url.trim();
  if (!key) return Promise.resolve(null);
  let pending = imageCache.get(key);
  if (!pending) {
    pending = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = key;
    });
    imageCache.set(key, pending);
    trimImageCache();
  }
  return pending;
}

const browserEnvironment: QrCanvasEnvironment = {
  createCanvas(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  loadImage: browserLoadImage,
};

let activeEnvironment: QrCanvasEnvironment = browserEnvironment;

export function setQrCanvasEnvironment(env: QrCanvasEnvironment): void {
  activeEnvironment = env;
}

export function getQrCanvasEnvironment(): QrCanvasEnvironment {
  return activeEnvironment;
}

export function resetQrCanvasEnvironmentForTests(): void {
  activeEnvironment = browserEnvironment;
}
