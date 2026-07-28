import { createCanvas, loadImage } from "@napi-rs/canvas";
import { pathToFileURL } from "node:url";

/** Mirrors web `QrCanvasEnvironment` — kept local so backend tsc never pulls SPA sources. */
type QrCanvasEnvironment = {
  createCanvas(width: number, height: number): HTMLCanvasElement;
  loadImage(url: string): Promise<HTMLImageElement | null>;
};

type QrRenderBundle = {
  setQrCanvasEnvironment: (env: QrCanvasEnvironment) => void;
};

/** Installs Node canvas adapter on the bundled web QR renderer module. */
export function installNodeQrCanvas(bundle: QrRenderBundle): void {
  bundle.setQrCanvasEnvironment({
    createCanvas(width: number, height: number) {
      return createCanvas(width, height) as unknown as HTMLCanvasElement;
    },
    async loadImage(url: string) {
      const key = url.trim();
      if (!key) return null;
      try {
        const src = key.startsWith("file://") ? key : pathToFileURL(key).href;
        const img = await loadImage(src);
        return img as unknown as HTMLImageElement;
      } catch {
        try {
          const img = await loadImage(key);
          return img as unknown as HTMLImageElement;
        } catch {
          return null;
        }
      }
    },
  });
}
