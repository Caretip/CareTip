/**
 * Canonical CareTip branded QR (Premium Branding v2).
 *
 * Premium venues embed logo, template styles, display name, and tagline.
 * Basic uses CareTip defaults. Footer always retains "Powered by CareTip".
 */

import { publicEmployeeTipUrl, qrEmployeeLegacyUrl } from "./appPublicUrl";
import { resolveMediaUrl } from "./mediaUrl";
import { withIdleSuppress } from "./idleSuppress";
import {
  CARETIP_QR_BRAND_HEX,
  type QrBrandingOptions,
} from "./businessBranding";
import {
  maxSafeLogoWidth,
  assessBrandingReliability,
  decodeQrFromCanvasRobust,
  isQrExportAllowed,
  qrPayloadUrlsMatch,
  type QrReliabilityReport,
} from "./qrReliability";
import {
  collectQrScanDiagnostics,
  decodeIsolatedQrMatrix,
  extractQrMatrixRegion,
  type QrScanDiagnostics,
} from "./qrScanDiagnostics";
import {
  engineTemplateLayoutMetrics,
  renderEngineTemplateFromBranding,
} from "./qrTemplateEngine";
import { DEFAULT_QR_TEMPLATE, normalizeQrTemplateId } from "./qrTemplateStyles";

import type { QrExportScale } from "./qrDesignExport";

export type { QrReliabilityReport } from "./qrReliability";
export type { QrScanDiagnostics } from "./qrScanDiagnostics";
export {
  logQrScanDiagnostics,
  layoutMetricsFingerprint,
} from "./qrScanDiagnostics";
export {
  QR_QUIET_ZONE_MODULES,
  QR_ERROR_CORRECTION_LEVEL,
  QR_LOGO_MAX_AREA_RATIO,
  isQrExportAllowed,
} from "./qrReliability";

const BRAND_TOP_TEXT = "CareTip";

/** Inner QR matrix width (px) — legacy constant kept for PDF layout references. */
export const CARETIP_BRANDED_QR_MATRIX_PX = 256;

export type BrandedQrLayoutMetrics = {
  qrSize: number;
  padding: number;
  qrDrawX: number;
  qrDrawY: number;
  qrMargin: number;
  centerLogoMaxW: number;
  totalWidth: number;
  totalHeight: number;
  qrSafeBottom: number;
};

/** Export-scale used for scan-quality validation (matches default PNG export). */
export const QR_RELIABILITY_VALIDATION_SCALE = 2 as const;

export type BrandedQrLayoutOptions = {
  /** Actual 1× canvas height after image-aspect adjustment (engine templates). */
  renderedCanvasHeight?: number;
};

export function computeBrandedQrLayoutMetrics(
  brand: QrBrandingOptions,
  opts?: BrandedQrLayoutOptions,
): BrandedQrLayoutMetrics {
  const templateId = normalizeQrTemplateId(brand.qrTemplate);
  const engine = engineTemplateLayoutMetrics(templateId, opts?.renderedCanvasHeight);
  if (!engine) {
    throw new Error(`Unknown QR template: ${templateId}`);
  }
  return {
    qrSize: engine.qrSize,
    padding: engine.qrDrawX,
    qrDrawX: engine.qrDrawX,
    qrDrawY: engine.qrDrawY,
    qrMargin: engine.qrMargin,
    centerLogoMaxW: maxSafeLogoWidth(Math.round(engine.qrSize), Boolean(brand.centerLogoUrl)),
    totalWidth: engine.totalWidth,
    totalHeight: engine.totalHeight,
    qrSafeBottom: engine.qrDrawY + engine.qrSize,
  };
}

const DEFAULT_QR_BRANDING: QrBrandingOptions = {
  premium: false,
  primaryColor: CARETIP_QR_BRAND_HEX,
  secondaryColor: "#000000",
  centerLogoUrl: null,
  businessName: BRAND_TOP_TEXT,
};

function resolveQrBranding(opts?: Partial<QrBrandingOptions>): QrBrandingOptions {
  const premium = opts?.premium === true;
  const primaryColor = premium && opts?.primaryColor ? opts.primaryColor : CARETIP_QR_BRAND_HEX;
  const secondaryColor =
    premium && opts?.secondaryColor ? opts.secondaryColor : DEFAULT_QR_BRANDING.secondaryColor;
  const businessName = premium && opts?.businessName?.trim() ? opts.businessName.trim() : BRAND_TOP_TEXT;
  const rawLogo = premium && opts?.centerLogoUrl ? opts.centerLogoUrl : null;
  const centerLogoUrl = rawLogo ? resolveMediaUrl(rawLogo) ?? rawLogo : null;
  return {
    premium,
    primaryColor,
    secondaryColor,
    centerLogoUrl,
    businessName,
    brandTagline: premium ? opts?.brandTagline?.trim() || null : null,
    welcomeMessage: premium ? opts?.welcomeMessage?.trim() || null : null,
    thankYouMessage: premium ? opts?.thankYouMessage?.trim() || null : null,
    ctaText: premium ? opts?.ctaText?.trim() || "Scan to tip" : null,
    qrTemplate: normalizeQrTemplateId(opts?.qrTemplate ?? DEFAULT_QR_TEMPLATE),
    qrBorderStyle: opts?.qrBorderStyle,
    qrShape: opts?.qrShape,
    qrAccentColor: opts?.qrAccentColor,
    qrBackgroundColor: opts?.qrBackgroundColor,
    layoutVariant: opts?.layoutVariant,
    decorationsEnabled: opts?.decorationsEnabled,
    showVenueLogoHeader: opts?.showVenueLogoHeader,
    templateProfile: opts?.templateProfile ?? null,
    websiteUrl: opts?.websiteUrl ?? null,
    socialInstagram: opts?.socialInstagram ?? null,
    socialFacebook: opts?.socialFacebook ?? null,
    templateFieldVisibility: opts?.templateFieldVisibility,
    logoSize: opts?.logoSize,
    logoOrientation: opts?.logoOrientation,
    logoAlignment: opts?.logoAlignment,
    logoPadding: opts?.logoPadding,
  };
}

export function getEmployeeQrShareUrl(businessSlug: string, employeeSlug: string): string {
  return publicEmployeeTipUrl(businessSlug, employeeSlug);
}

export function getEmployeeQrLegacyShareUrl(employeeId: string): string {
  return qrEmployeeLegacyUrl(employeeId);
}

export type QrRenderOptions = {
  /** Output scale multiplier for high-res export (1–4). */
  scale?: QrExportScale;
  /** When false, nearest-neighbor upscale preserves QR module edges (scan validation). */
  smoothScale?: boolean;
};

export async function renderBrandedQrUrlToCanvas(
  url: string,
  branding?: Partial<QrBrandingOptions>,
  renderOptions?: QrRenderOptions,
): Promise<HTMLCanvasElement | null> {
  const encoded = String(url ?? "").trim();
  if (!encoded || typeof document === "undefined") return null;

  const brand = resolveQrBranding(branding);
  return renderEngineTemplateFromBranding(encoded, brand, {
    profile: brand.templateProfile,
    extras: {
      ctaText: brand.ctaText ?? "Scan to tip",
      websiteUrl: brand.websiteUrl ?? "",
      socialInstagram: brand.socialInstagram ?? "",
      socialFacebook: brand.socialFacebook ?? "",
      templateFieldVisibility: brand.templateFieldVisibility ?? {},
      showVenueLogoHeader: brand.showVenueLogoHeader !== false,
      logoSize: brand.logoSize ?? "medium",
      logoOrientation: brand.logoOrientation ?? "square",
      logoAlignment: brand.logoAlignment ?? "center",
      logoPadding: brand.logoPadding ?? "balanced",
    },
    scale: renderOptions?.scale,
    smoothScale: renderOptions?.smoothScale,
  });
}

/** Generate → render → decode test for scan reliability. */
export async function validateBrandedQrReliability(
  url: string,
  branding?: Partial<QrBrandingOptions>,
  opts?: {
    employeeId?: string | null;
    employeeSlug?: string | null;
    referenceLayout?: BrandedQrLayoutMetrics | null;
  },
): Promise<{
  canvas: HTMLCanvasElement | null;
  report: QrReliabilityReport | null;
  diagnostics: QrScanDiagnostics | null;
}> {
  const encoded = String(url ?? "").trim();
  if (!encoded || typeof document === "undefined") {
    return { canvas: null, report: null, diagnostics: null };
  }

  const brand = resolveQrBranding(branding);
  const exportScale = QR_RELIABILITY_VALIDATION_SCALE;

  const [canvas, decodeCanvas] = await Promise.all([
    renderBrandedQrUrlToCanvas(url, branding, { scale: exportScale, smoothScale: false }),
    renderBrandedQrUrlToCanvas(url, branding, { scale: 1 }),
  ]);
  if (!canvas || !decodeCanvas) return { canvas: null, report: null, diagnostics: null };

  const layout = computeBrandedQrLayoutMetrics(brand);
  const region = extractQrMatrixRegion(decodeCanvas, layout, 1);
  const compositeDecoded = region ? await decodeQrFromCanvasRobust(region) : null;

  const moduleDark = brand.premium ? brand.secondaryColor : "#000000";
  let decodedText = compositeDecoded;
  let compositeDecodeFallback = false;
  if (!qrPayloadUrlsMatch(encoded, compositeDecoded)) {
    const isolatedDecoded = await decodeIsolatedQrMatrix(encoded, Math.round(layout.qrSize), moduleDark);
    if (qrPayloadUrlsMatch(encoded, isolatedDecoded)) {
      decodedText = isolatedDecoded;
      compositeDecodeFallback = true;
    }
  }

  const report = assessBrandingReliability(
    branding ?? {},
    decodedText,
    encoded,
    layout.centerLogoMaxW,
    Math.round(layout.qrSize),
    compositeDecodeFallback,
  );

  const diagnostics = await collectQrScanDiagnostics({
    url: encoded,
    branding: branding ?? {},
    canvas,
    decodeCanvas,
    exportScale,
    report,
    layout,
    employeeId: opts?.employeeId,
    employeeSlug: opts?.employeeSlug,
    referenceLayout: opts?.referenceLayout,
  });

  return { canvas, report, diagnostics };
}

export async function renderBrandedQrUrlToDataUrl(
  url: string,
  branding?: Partial<QrBrandingOptions>,
  renderOptions?: QrRenderOptions,
): Promise<string> {
  const canvas = await renderBrandedQrUrlToCanvas(url, branding, renderOptions);
  if (!canvas) return "";
  return canvas.toDataURL("image/png");
}

export async function renderBrandedQRToDataUrl(
  businessSlug: string,
  employeeSlug: string,
  branding?: Partial<QrBrandingOptions>,
): Promise<string> {
  return renderBrandedQrUrlToDataUrl(publicEmployeeTipUrl(businessSlug, employeeSlug), branding);
}

export async function renderBrandedQRToDataUrlLegacy(
  employeeId: string,
  branding?: Partial<QrBrandingOptions>,
): Promise<string> {
  return renderBrandedQrUrlToDataUrl(qrEmployeeLegacyUrl(employeeId), branding);
}

export async function downloadBrandedQR(
  businessSlug: string,
  employeeSlug: string,
  employeeName: string,
  branding?: Partial<QrBrandingOptions>,
): Promise<boolean> {
  return withIdleSuppress("qr-branded-export", async () => {
    const url = publicEmployeeTipUrl(businessSlug, employeeSlug);
    const { canvas, report } = await validateBrandedQrReliability(url, branding);
    if (!canvas || !isQrExportAllowed(report)) return false;
    const filename = `caretip-${employeeSlug}-${employeeName.replace(/\s+/g, "-").toLowerCase()}.png`;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
    return true;
  });
}

export async function downloadBrandedQRLegacy(
  employeeId: string,
  employeeName: string,
  branding?: Partial<QrBrandingOptions>,
): Promise<boolean> {
  const url = qrEmployeeLegacyUrl(employeeId);
  const { canvas, report } = await validateBrandedQrReliability(url, branding);
  if (!canvas || !isQrExportAllowed(report)) return false;
  const filename = `caretip-${employeeId.slice(0, 8)}-${employeeName.replace(/\s+/g, "-").toLowerCase()}.png`;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
  return true;
}

export function downloadQrDataUrlPng(
  dataUrl: string,
  filename: string,
  opts?: { exportAllowed?: boolean },
): boolean {
  if (!dataUrl) return false;
  if (opts?.exportAllowed === false) return false;
  const base = filename.trim().replace(/[^\w.-]+/g, "_") || "caretip-qr";
  const name = base.toLowerCase().endsWith(".png") ? base : `${base}.png`;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
}

export function printQrDataUrl(
  dataUrl: string,
  heading: string,
  opts?: { exportAllowed?: boolean },
): boolean {
  if (!dataUrl) return false;
  if (opts?.exportAllowed === false) return false;
  if (!/^data:image\//i.test(dataUrl)) return false;

  const w = window.open("", "_blank");
  if (!w) return false;

  const doc = w.document;
  doc.documentElement.lang = "en";

  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  doc.head.appendChild(meta);

  doc.title = "CareTip QR";

  const style = doc.createElement("style");
  style.textContent = `
    body { font-family: system-ui, sans-serif; text-align: center; padding: 24px; margin: 0; }
    h1 { font-size: 1rem; font-weight: 600; margin: 0 0 16px; color: #111; }
    img { max-width: min(360px, 100%); height: auto; }
    @media print { body { padding: 12px; } }
  `;
  doc.head.appendChild(style);

  const h1 = doc.createElement("h1");
  h1.textContent = heading;
  doc.body.appendChild(h1);

  const img = doc.createElement("img");
  img.src = dataUrl;
  img.alt = "QR code";
  doc.body.appendChild(img);

  w.addEventListener("load", () => {
    window.setTimeout(() => w.print(), 200);
  });

  return true;
}
