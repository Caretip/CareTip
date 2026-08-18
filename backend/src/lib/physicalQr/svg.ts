import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergePhysicalQrColorTokens } from "./colors.js";
import {
  PHYSICAL_QR_FONT_STATUS,
  PHYSICAL_QR_TEMPORARY_FONT_FAMILY,
  type PhysicalQrColorTokens,
} from "./types.js";

export type PhysicalQrSvgInput = {
  qrDataUrl: string | null;
  businessName: string;
  address: string | null;
  supportsAddress: boolean;
  colorTokens: PhysicalQrColorTokens;
  artworkDataUrl?: string | null;
};

const TOKEN = {
  bgStart: "__CT_BG_START__",
  bgEnd: "__CT_BG_END__",
  primary: "__CT_PRIMARY__",
  secondary: "__CT_SECONDARY__",
  font: "__CT_FONT_FAMILY__",
  businessName: "__CT_BUSINESS_NAME__",
  businessNameSize: "__CT_BUSINESS_NAME_SIZE__",
  addressDisplay: "__CT_ADDRESS_DISPLAY__",
  addressLine1: "__CT_ADDRESS_LINE_1__",
  addressLine2: "__CT_ADDRESS_LINE_2__",
  supportsAddress: "__CT_SUPPORTS_ADDRESS__",
  qrHref: "__CT_QR_HREF__",
  qrVisibility: "__CT_QR_VISIBILITY__",
  artworkHref: "__CT_ARTWORK_HREF__",
} as const;

let cachedTemplate: string | null = null;
let cachedArtworkDataUrl: string | null = null;

function resolveExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

function resolveAuthoredSvgPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const found = resolveExisting([
    path.resolve(here, "../../../../src/assets/physical-qr/caretip-a5.svg"),
    path.resolve(process.cwd(), "../src/assets/physical-qr/caretip-a5.svg"),
    path.resolve(process.cwd(), "src/assets/physical-qr/caretip-a5.svg"),
    path.join(here, "caretip-a5.svg"),
  ]);
  if (!found) throw new Error("Authored CareTip A5 SVG not found (src/assets/physical-qr/caretip-a5.svg)");
  return found;
}

export function resolvePhysicalQrArtworkPngPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const found = resolveExisting([
    path.resolve(here, "../../../../src/assets/physical-qr/caretip-a5-artwork.png"),
    path.resolve(process.cwd(), "../src/assets/physical-qr/caretip-a5-artwork.png"),
    path.resolve(process.cwd(), "src/assets/physical-qr/caretip-a5-artwork.png"),
    path.resolve(process.cwd(), "../template/A5_Flyer without Address.png"),
    path.join(here, "caretip-a5-artwork.png"),
  ]);
  if (!found) throw new Error("Uploaded A5 artwork PNG not found");
  return found;
}

export function loadPhysicalQrArtworkDataUrl(): string {
  if (cachedArtworkDataUrl) return cachedArtworkDataUrl;
  const buf = readFileSync(resolvePhysicalQrArtworkPngPath());
  cachedArtworkDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  return cachedArtworkDataUrl;
}

export function loadAuthoredPhysicalQrSvg(): string {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = readFileSync(resolveAuthoredSvgPath(), "utf8");
  return cachedTemplate;
}

export function escapePhysicalQrXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

export function injectPhysicalQrSvg(template: string, input: PhysicalQrSvgInput): string {
  const colors = mergePhysicalQrColorTokens(input.colorTokens);
  const showAddress = Boolean(input.supportsAddress && input.address?.trim());
  const name = input.businessName.trim() || " ";
  const addressLines = showAddress ? wrapLines(input.address!.trim(), 42, 2) : [];
  const qrHref = input.qrDataUrl?.startsWith("data:image/")
    ? input.qrDataUrl
    : "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const nameFontSize = String(Math.min(36, Math.max(22, 560 / Math.max(8, name.length))));
  const font = PHYSICAL_QR_TEMPORARY_FONT_FAMILY.replace(/"/g, "'");
  const hasQr = Boolean(input.qrDataUrl?.startsWith("data:image/"));
  const artworkHref = input.artworkDataUrl?.startsWith("data:image/")
    ? input.artworkDataUrl
    : loadPhysicalQrArtworkDataUrl();

  let svg = template;
  const replacements: Array<[string, string]> = [
    [TOKEN.bgStart, colors.backgroundGradientStart],
    [TOKEN.bgEnd, colors.backgroundGradientEnd],
    [TOKEN.primary, colors.primaryTextColor],
    [TOKEN.secondary, colors.secondaryTextColor],
    [TOKEN.font, escapePhysicalQrXml(font)],
    [TOKEN.businessName, escapePhysicalQrXml(name)],
    [TOKEN.businessNameSize, nameFontSize],
    [TOKEN.addressDisplay, showAddress ? "inline" : "none"],
    [TOKEN.addressLine1, escapePhysicalQrXml(addressLines[0] ?? "")],
    [TOKEN.addressLine2, escapePhysicalQrXml(addressLines[1] ?? "")],
    [TOKEN.supportsAddress, input.supportsAddress ? "true" : "false"],
    [TOKEN.qrHref, escapePhysicalQrXml(qrHref)],
    [TOKEN.qrVisibility, hasQr ? "visible" : "hidden"],
    [TOKEN.artworkHref, escapePhysicalQrXml(artworkHref)],
  ];
  for (const [token, value] of replacements) {
    svg = svg.split(token).join(value);
  }
  if (!svg.includes(PHYSICAL_QR_FONT_STATUS)) {
    svg = svg.replace("<svg ", `<svg data-font-status="${PHYSICAL_QR_FONT_STATUS}" `);
  }
  return svg;
}

export function renderPhysicalQrSvg(input: PhysicalQrSvgInput): string {
  return injectPhysicalQrSvg(loadAuthoredPhysicalQrSvg(), input);
}

export function svgHidesAddress(svg: string): boolean {
  return /id="physical-address"[^>]*display="none"/.test(svg);
}

export function svgShowsAddress(svg: string): boolean {
  return /id="physical-address"[^>]*display="inline"/.test(svg);
}
