import { assertImageDimensionsWithinLimits } from "./imageDimensionValidation.js";

/** Shared rules for profile / logo image uploads (multer + Supabase Storage / disk path). */

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Accept common browser + mobile camera MIME types (HEIC from iOS). SVG is never allowed. */
export const ALLOWED_IMAGE_MIME_RE = /^image\/(jpeg|jpg|png|gif|webp|heic|heif|avif)$/i;

export function isSvgMimetype(mimetype: string): boolean {
  return /svg/i.test(mimetype.trim());
}

export function isAllowedImageMimetype(mimetype: string): boolean {
  if (isSvgMimetype(mimetype)) return false;
  return ALLOWED_IMAGE_MIME_RE.test(mimetype.trim());
}

/** Sniff magic bytes so we do not trust `mimetype` alone (some clients send wrong or empty types). */
export function sniffImageKind(
  buffer: Buffer,
): "jpeg" | "png" | "gif" | "webp" | "heic" | "avif" | "unknown" {
  if (buffer.length < 12) return "unknown";
  const b0 = buffer[0]!;
  const b1 = buffer[1]!;
  const b2 = buffer[2]!;
  const b3 = buffer[3]!;
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return "jpeg";
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return "png";
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return "gif";
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 && buffer.length >= 12) {
    const webp = buffer.subarray(8, 12).toString("ascii");
    if (webp === "WEBP") return "webp";
  }
  // ISO BMFF (HEIC/HEIF/AVIF): "ftyp" at offset 4, major brand at 8–12
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "avif";
    if (
      brand.startsWith("heic") ||
      brand.startsWith("heix") ||
      brand.startsWith("mif1") ||
      brand.startsWith("msf1")
    ) {
      return "heic";
    }
  }
  return "unknown";
}

export function validateImageBufferForUpload(buffer: Buffer, claimedMimetype: string): void {
  if (!buffer || buffer.length === 0) {
    throw new Error("Image file is empty.");
  }
  if (buffer.length > AVATAR_MAX_BYTES) {
    throw new Error("Image is too large (max 5 MB).");
  }
  if (buffer.length < 32) {
    throw new Error("Image file is too small or corrupted.");
  }
  if (isSvgMimetype(claimedMimetype)) {
    throw new Error("SVG uploads are not allowed.");
  }
  const mt = claimedMimetype.trim();
  const kind = sniffImageKind(buffer);
  if (kind === "unknown") {
    throw new Error("Could not read this image. Try JPEG or PNG.");
  }
  const mimeOk =
    isAllowedImageMimetype(mt) ||
    (kind === "heic" && /^image\/(jpeg|jpg|png)$/i.test(mt)) ||
    (kind === "avif" && /^image\/(jpeg|jpg)$/i.test(mt));
  if (!mimeOk) {
    throw new Error("Unsupported image type. Use JPEG, PNG, GIF, WebP, HEIC, or AVIF.");
  }
  if (kind !== "heic" && kind !== "avif") {
    assertImageDimensionsWithinLimits(buffer, kind);
  }
}

export function extensionForImageKind(
  kind: Exclude<ReturnType<typeof sniffImageKind>, "unknown">,
): string {
  switch (kind) {
    case "jpeg":
      return ".jpg";
    case "png":
      return ".png";
    case "gif":
      return ".gif";
    case "webp":
      return ".webp";
    case "heic":
      return ".heic";
    case "avif":
      return ".avif";
  }
}

/** Derive stored extension from magic bytes (never from original filename). */
export function extensionForImageBuffer(buffer: Buffer): string {
  const kind = sniffImageKind(buffer);
  if (kind === "unknown") {
    throw new Error("Could not read this image. Try JPEG or PNG.");
  }
  return extensionForImageKind(kind);
}
