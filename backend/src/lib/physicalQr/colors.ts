import { qrModuleContrastRatio, QR_MIN_MODULE_CONTRAST_RATIO } from "../qrColorContrast.js";
import {
  PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
  PHYSICAL_QR_MODULE_DARK,
  PHYSICAL_QR_MODULE_LIGHT,
  type PhysicalQrColorTokens,
} from "./types.js";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function isPhysicalQrHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value.trim());
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

export type PhysicalQrColorValidation = {
  ok: boolean;
  reasons: string[];
};

export function validatePhysicalQrColorTokens(
  tokens: PhysicalQrColorTokens,
): PhysicalQrColorValidation {
  const merged = mergePhysicalQrColorTokens(tokens);
  const reasons: string[] = [];
  const primaryVsStart = qrModuleContrastRatio(merged.primaryTextColor, merged.backgroundGradientStart);
  const primaryVsEnd = qrModuleContrastRatio(merged.primaryTextColor, merged.backgroundGradientEnd);
  const secondaryVsStart = qrModuleContrastRatio(
    merged.secondaryTextColor,
    merged.backgroundGradientStart,
  );
  const secondaryVsEnd = qrModuleContrastRatio(
    merged.secondaryTextColor,
    merged.backgroundGradientEnd,
  );
  const qrContrast = qrModuleContrastRatio(PHYSICAL_QR_MODULE_DARK, PHYSICAL_QR_MODULE_LIGHT);
  if (Math.min(primaryVsStart, primaryVsEnd) < 1.2) {
    reasons.push("primary_text_low_contrast");
  }
  if (Math.min(secondaryVsStart, secondaryVsEnd) < QR_MIN_MODULE_CONTRAST_RATIO) {
    reasons.push("secondary_text_low_contrast");
  }
  if (qrContrast < QR_MIN_MODULE_CONTRAST_RATIO) reasons.push("qr_module_low_contrast");
  return { ok: reasons.length === 0, reasons };
}

export class PhysicalQrColorError extends Error {
  readonly code = "UNSAFE_PHYSICAL_QR_COLORS";
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super("These colours would make the printed flyer or QR unreliable.");
    this.reasons = reasons;
  }
}

export function assertPhysicalQrColorTokens(tokens: PhysicalQrColorTokens): PhysicalQrColorTokens {
  const merged = mergePhysicalQrColorTokens(tokens);
  const result = validatePhysicalQrColorTokens(merged);
  if (!result.ok) throw new PhysicalQrColorError(result.reasons);
  return merged;
}
