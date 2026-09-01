import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import QRCode from "qrcode";
import { assertPhysicalQrColorTokens } from "./colors.js";
import {
  PHYSICAL_QR_MODULE_DARK,
  PHYSICAL_QR_MODULE_LIGHT,
  PHYSICAL_QR_PRINT_HEIGHT_PX,
  PHYSICAL_QR_PRINT_WIDTH_PX,
  PHYSICAL_QR_TEMPORARY_FONT_FAMILY,
  PHYSICAL_QR_VIEWBOX_HEIGHT,
  PHYSICAL_QR_VIEWBOX_WIDTH,
  PHYSICAL_QR_ZONES,
  physicalQrOverlayTextColor,
  type PhysicalQrColorTokens,
} from "./types.js";
import { jpegToA5Pdf } from "./pdfA5.js";
import { renderPhysicalQrSvg, resolvePhysicalQrArtworkPngPath } from "./svg.js";

export type PhysicalQrPrintInput = {
  targetUrl: string;
  businessName: string;
  address: string | null;
  supportsAddress: boolean;
  colorTokens: PhysicalQrColorTokens;
  templateId?: string | null;
};

export type PhysicalQrPrintResult = {
  svg: string;
  png: Buffer;
  jpeg: Buffer;
  pdf: Buffer;
  widthPx: number;
  heightPx: number;
  qrDataUrl: string;
};

function vx(n: number): number {
  return (n / PHYSICAL_QR_VIEWBOX_WIDTH) * PHYSICAL_QR_PRINT_WIDTH_PX;
}
function vy(n: number): number {
  return (n / PHYSICAL_QR_VIEWBOX_HEIGHT) * PHYSICAL_QR_PRINT_HEIGHT_PX;
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

async function qrPngDataUrl(targetUrl: string): Promise<string> {
  return QRCode.toDataURL(targetUrl, {
    errorCorrectionLevel: "H",
    margin: 4,
    width: 1024,
    color: { dark: PHYSICAL_QR_MODULE_DARK, light: PHYSICAL_QR_MODULE_LIGHT },
  });
}

/**
 * Print: uploaded A5 PNG → overlay live QR / name / address → 300 DPI → A5 PDF.
 * SVG wrapper is retained as the structured production document.
 */
export async function renderPhysicalQrPrint(input: PhysicalQrPrintInput): Promise<PhysicalQrPrintResult> {
  const colors = assertPhysicalQrColorTokens(input.colorTokens);
  const overlayTextColor = physicalQrOverlayTextColor(input.templateId, colors.secondaryTextColor);
  const overlayTokens = { ...colors, secondaryTextColor: overlayTextColor };
  const qrDataUrl = await qrPngDataUrl(input.targetUrl);
  const svg = renderPhysicalQrSvg({
    qrDataUrl,
    businessName: input.businessName,
    address: input.supportsAddress ? input.address : null,
    supportsAddress: input.supportsAddress,
    colorTokens: overlayTokens,
    templateId: input.templateId,
  });

  const w = PHYSICAL_QR_PRINT_WIDTH_PX;
  const h = PHYSICAL_QR_PRINT_HEIGHT_PX;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);

  const artwork = await loadImage(readFileSync(resolvePhysicalQrArtworkPngPath(input.templateId)));
  ctx.drawImage(artwork, 0, 0, w, h);

  const qrImg = await loadImage(qrDataUrl);
  const qz = PHYSICAL_QR_ZONES.qrZone;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrImg, vx(qz.x), vy(qz.y), vx(qz.w), vy(qz.h));
  ctx.imageSmoothingEnabled = true;

  ctx.textAlign = "center";
  ctx.fillStyle = overlayTextColor;
  const name = input.businessName.trim();
  if (name) {
    const nameSize = Math.min(vy(36), Math.max(vy(22), vx(560) / Math.max(8, name.length)));
    ctx.font = `700 ${nameSize}px ${PHYSICAL_QR_TEMPORARY_FONT_FAMILY}`;
    const nz = PHYSICAL_QR_ZONES.businessNameZone;
    ctx.fillText(name, vx(nz.x + nz.w / 2), vy(nz.y + 38));
  }
  if (input.supportsAddress && input.address?.trim()) {
    ctx.font = `500 ${vy(24)}px ${PHYSICAL_QR_TEMPORARY_FONT_FAMILY}`;
    const az = PHYSICAL_QR_ZONES.addressZone;
    wrapLines(input.address.trim(), 42, 2).forEach((line, i) => {
      ctx.fillText(line, vx(az.x + az.w / 2), vy(az.y + 28 + i * 32));
    });
  }

  const png = Buffer.from(await canvas.encode("png"));
  const jpeg = Buffer.from(await canvas.encode("jpeg", 92));
  const pdf = jpegToA5Pdf(jpeg, w, h);
  return { svg, png, jpeg, pdf, widthPx: w, heightPx: h, qrDataUrl };
}
