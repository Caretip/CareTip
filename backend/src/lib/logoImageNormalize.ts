import { createCanvas, loadImage } from "@napi-rs/canvas";
import { MAX_IMAGE_EDGE_PX, readImageDimensionsForKind } from "./imageDimensionValidation.js";
import { sniffImageKind } from "./imageUploadValidation.js";

type ImageKind = Exclude<ReturnType<typeof sniffImageKind>, "unknown">;

/**
 * Downscales raster logos that exceed {@link MAX_IMAGE_EDGE_PX} so uploads succeed without
 * weakening post-upload dimension limits. HEIC/AVIF skip raster resize (dimension check skipped server-side).
 */
export async function normalizeManagerLogoBuffer(
  buffer: Buffer,
  mimetype: string,
): Promise<{ buffer: Buffer; mimetype: string }> {
  const kind = sniffImageKind(buffer);
  if (kind === "unknown" || kind === "heic" || kind === "avif") {
    return { buffer, mimetype };
  }

  const dim = readImageDimensionsForKind(buffer, kind as ImageKind);
  if (!dim) {
    return { buffer, mimetype };
  }

  const maxEdge = Math.max(dim.width, dim.height);
  if (maxEdge <= MAX_IMAGE_EDGE_PX) {
    return { buffer, mimetype };
  }

  const scale = MAX_IMAGE_EDGE_PX / maxEdge;
  const targetW = Math.max(1, Math.round(dim.width * scale));
  const targetH = Math.max(1, Math.round(dim.height * scale));

  const img = await loadImage(buffer);
  const canvas = createCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const outMime = kind === "jpeg" || kind === "webp" ? "image/jpeg" : "image/png";
  const outBuffer =
    outMime === "image/jpeg"
      ? canvas.toBuffer("image/jpeg", 88)
      : canvas.toBuffer("image/png");

  return { buffer: outBuffer, mimetype: outMime };
}
