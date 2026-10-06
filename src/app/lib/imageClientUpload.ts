/** Client-side checks before sending images to the API (must stay aligned with backend limits). */

export const CLIENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Must match backend `MAX_IMAGE_EDGE_PX` (imageDimensionValidation.ts). */
export const CLIENT_IMAGE_MAX_EDGE_PX = 4096;

const ALLOWED = /^image\/(jpeg|jpg|png|gif|webp|heic|heif|avif)$/i;

export function validateImageFileForUpload(file: File): { ok: true } | { ok: false; message: string } {
  if (!file || file.size === 0) {
    return { ok: false, message: "Image file is empty." };
  }
  if (file.size > CLIENT_IMAGE_MAX_BYTES) {
    return { ok: false, message: "Image is too large (max 5 MB)." };
  }
  const t = file.type?.trim() ?? "";
  if (/svg/i.test(t)) {
    return { ok: false, message: "SVG uploads are not allowed." };
  }
  if (!ALLOWED.test(t)) {
    return {
      ok: false,
      message: "Unsupported image type. Use JPEG, PNG, GIF, WebP, HEIC, or AVIF.",
    };
  }
  return { ok: true };
}

/**
 * Downscales oversized raster logos in the browser so uploads stay within backend limits.
 * HEIC/AVIF and unreadable dimensions are left to the server.
 */
export async function prepareLogoFileForUpload(file: File): Promise<File> {
  const check = validateImageFileForUpload(file);
  if (!check.ok) {
    throw new Error(check.message);
  }
  if (typeof createImageBitmap !== "function") {
    return file;
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const maxEdge = Math.max(bitmap.width, bitmap.height);
    if (maxEdge <= CLIENT_IMAGE_MAX_EDGE_PX) {
      return file;
    }
    const scale = CLIENT_IMAGE_MAX_EDGE_PX / maxEdge;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    const preferJpeg = /^image\/jpe?g$/i.test(file.type) || /^image\/webp$/i.test(file.type);
    const mime = preferJpeg ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), mime, preferJpeg ? 0.88 : undefined);
    });
    if (!blob) {
      return file;
    }
    const base = file.name.replace(/\.[^.]+$/, "") || "logo";
    const ext = preferJpeg ? ".jpg" : ".png";
    return new File([blob], `${base}${ext}`, { type: mime, lastModified: Date.now() });
  } finally {
    bitmap?.close();
  }
}
