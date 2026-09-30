import type { sniffImageKind } from "./imageUploadValidation.js";

/** Max edge length for decoded raster (avatars, logos, banners). */
export const MAX_IMAGE_EDGE_PX = 4096;

/** Max width × height (16 MP at 4096²). */
export const MAX_IMAGE_PIXELS = 16_777_216;

export type ImageDimensions = { width: number; height: number };

function assertPositiveDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Could not read this image. Try JPEG or PNG.");
  }
  if (width > MAX_IMAGE_EDGE_PX || height > MAX_IMAGE_EDGE_PX) {
    throw new Error(`Image dimensions are too large (max ${MAX_IMAGE_EDGE_PX}px per side).`);
  }
  const pixels = width * height;
  if (pixels > MAX_IMAGE_PIXELS) {
    throw new Error("Image resolution is too high. Try a smaller photo.");
  }
}

/** PNG IHDR — does not decode image data. */
export function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null;
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

/** GIF logical screen descriptor. */
export function readGifDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 10) return null;
  const sig = buffer.subarray(0, 6).toString("ascii");
  if (sig !== "GIF87a" && sig !== "GIF89a") return null;
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  return { width, height };
}

/** JPEG SOF0 / SOF2 markers — scans without full decode. */
export function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1]!;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLen = buffer.readUInt16BE(offset);
    if (segmentLen < 2 || offset + segmentLen > buffer.length) break;
    if (marker === 0xc0 || marker === 0xc2) {
      if (offset + 7 > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return { width, height };
    }
    offset += segmentLen;
  }
  return null;
}

/** WebP VP8 / VP8L chunk headers (RIFF WEBP). */
export function readWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    if (buffer.length < 30) return null;
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  if (chunk === "VP8L") {
    if (buffer.length < 25) return null;
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (chunk === "VP8X") {
    if (buffer.length < 30) return null;
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }
  return null;
}

export function readImageDimensionsForKind(
  buffer: Buffer,
  kind: Exclude<ReturnType<typeof sniffImageKind>, "unknown">,
): ImageDimensions | null {
  switch (kind) {
    case "png":
      return readPngDimensions(buffer);
    case "jpeg":
      return readJpegDimensions(buffer);
    case "gif":
      return readGifDimensions(buffer);
    case "webp":
      return readWebpDimensions(buffer);
    case "heic":
    case "avif":
      return null;
  }
}

/**
 * Reject decompression bombs where header declares excessive dimensions.
 * HEIC/AVIF: dimension probe not implemented — rely on byte limits + magic-byte kind check.
 */
export function assertImageDimensionsWithinLimits(
  buffer: Buffer,
  kind: Exclude<ReturnType<typeof sniffImageKind>, "unknown">,
): void {
  if (kind === "heic" || kind === "avif") {
    return;
  }
  const dim = readImageDimensionsForKind(buffer, kind);
  if (!dim) {
    throw new Error("Could not read this image. Try JPEG or PNG.");
  }
  assertPositiveDimensions(dim.width, dim.height);
}
