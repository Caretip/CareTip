import type { PhysicalQrColorTokens } from "./types";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const MIN_BODY_CONTRAST = 3;
const MIN_HEADLINE_CONTRAST = 1.2;

/** Artwork-matched defaults from the CareTip A5 reference (cream → peach, orange + near-black type). */
export const PHYSICAL_QR_DEFAULT_COLOR_TOKENS: PhysicalQrColorTokens = {
  backgroundGradientStart: "#FFF8F0",
  backgroundGradientEnd: "#F4B184",
  primaryTextColor: "#EB992C",
  secondaryTextColor: "#1A1A1A",
};

/** Physical QR modules are never customer-customizable. */
export const PHYSICAL_QR_MODULE_DARK = "#111111";
export const PHYSICAL_QR_MODULE_LIGHT = "#FFFFFF";
export const PHYSICAL_QR_WELL_FILL = "#FFFFFF";

export function isPhysicalQrHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value.trim());
}

/** Parse a typed/pasted colour without snapping incomplete input back to the default. */
export function tryParsePhysicalQrHex(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  if (isPhysicalQrHexColor(withHash)) return withHash.toUpperCase();
  return null;
}

export function normalizePhysicalQrHex(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (isPhysicalQrHexColor(raw)) return raw.toUpperCase();
  return fallback.toUpperCase();
}

export function mergePhysicalQrColorTokens(
  input?: Partial<PhysicalQrColorTokens> | null,
): PhysicalQrColorTokens {
  return {
    backgroundGradientStart: normalizePhysicalQrHex(
      input?.backgroundGradientStart,
      PHYSICAL_QR_DEFAULT_COLOR_TOKENS.backgroundGradientStart,
    ),
    backgroundGradientEnd: normalizePhysicalQrHex(
      input?.backgroundGradientEnd,
      PHYSICAL_QR_DEFAULT_COLOR_TOKENS.backgroundGradientEnd,
    ),
    primaryTextColor: normalizePhysicalQrHex(
      input?.primaryTextColor,
      PHYSICAL_QR_DEFAULT_COLOR_TOKENS.primaryTextColor,
    ),
    secondaryTextColor: normalizePhysicalQrHex(
      input?.secondaryTextColor,
      PHYSICAL_QR_DEFAULT_COLOR_TOKENS.secondaryTextColor,
    ),
  };
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const h = String(hex ?? "").trim().replace("#", "");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return [r, g, b];
}

function relativeLuminance(hex: string): number {
  const rgb = parseHexRgb(hex);
  if (!rgb) return 0;
  const channels = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export type PhysicalQrColorValidation = {
  ok: boolean;
  reasons: string[];
  textOnStart: number;
  textOnEnd: number;
  secondaryOnStart: number;
  secondaryOnEnd: number;
  qrModuleContrast: number;
};

/**
 * Reject colour combinations that make body copy unreadable or collapse headlines
 * into the background. QR modules stay black-on-white in the well.
 */
export function validatePhysicalQrColorTokens(
  tokens: PhysicalQrColorTokens,
): PhysicalQrColorValidation {
  const merged = mergePhysicalQrColorTokens(tokens);
  const reasons: string[] = [];
  const fields: Array<keyof PhysicalQrColorTokens> = [
    "backgroundGradientStart",
    "backgroundGradientEnd",
    "primaryTextColor",
    "secondaryTextColor",
  ];
  for (const key of fields) {
    if (!isPhysicalQrHexColor(merged[key])) reasons.push(`invalid_${key}`);
  }

  const textOnStart = contrastRatio(merged.primaryTextColor, merged.backgroundGradientStart);
  const textOnEnd = contrastRatio(merged.primaryTextColor, merged.backgroundGradientEnd);
  const secondaryOnStart = contrastRatio(merged.secondaryTextColor, merged.backgroundGradientStart);
  const secondaryOnEnd = contrastRatio(merged.secondaryTextColor, merged.backgroundGradientEnd);
  const qrModuleContrast = contrastRatio(PHYSICAL_QR_MODULE_DARK, PHYSICAL_QR_MODULE_LIGHT);

  if (Math.min(textOnStart, textOnEnd) < MIN_HEADLINE_CONTRAST) {
    reasons.push("primary_text_low_contrast");
  }
  if (Math.min(secondaryOnStart, secondaryOnEnd) < MIN_BODY_CONTRAST) {
    reasons.push("secondary_text_low_contrast");
  }
  if (qrModuleContrast < MIN_BODY_CONTRAST) {
    reasons.push("qr_module_low_contrast");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    textOnStart,
    textOnEnd,
    secondaryOnStart,
    secondaryOnEnd,
    qrModuleContrast,
  };
}
