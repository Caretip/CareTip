/**
 * Digital-only plain QR renderer (Employee, Location, Table, Basic/Default).
 *
 * Matrix-only black-on-white PNG. No poster, logo, CTA, CareTip shell, or
 * Physical A5 artwork. Scan payload is the caller-supplied public URL.
 */

import { publicEmployeeTipUrl, qrEmployeeLegacyUrl } from "./appPublicUrl";
import { getQrCanvasEnvironment } from "./qrCanvasEnvironment";
import { withIdleSuppress } from "./idleSuppress";
import { downloadQrDataUrlPng } from "./qrExport";
import {
  QR_ERROR_CORRECTION_LEVEL,
  QR_QUIET_ZONE_MODULES,
  buildReliabilityReport,
  decodeQrFromCanvasRobust,
  isQrExportAllowed,
  type QrReliabilityReport,
} from "./qrReliability";

export const PLAIN_QR_MODULE_DARK = "#000000";
export const PLAIN_QR_MODULE_LIGHT = "#FFFFFF";
/** Default export / print edge in CSS pixels (includes quiet zone). */
export const PLAIN_QR_WIDTH_PX = 512;
/** On-screen card thumbnail. */
export const PLAIN_QR_PREVIEW_WIDTH_PX = 320;
export const PLAIN_QR_RENDER_VERSION = "digital-plain-v1";

let qrcodeModulePromise: Promise<typeof import("qrcode")> | null = null;

function loadQrCodeModule() {
  qrcodeModulePromise ??= import("qrcode");
  return qrcodeModulePromise;
}

export type PlainQrRenderOptions = {
  width?: number;
};

export async function renderPlainQrUrlToCanvas(
  url: string,
  opts?: PlainQrRenderOptions,
): Promise<HTMLCanvasElement | null> {
  const encoded = String(url ?? "").trim();
  if (!encoded) return null;

  const width = Math.max(128, Math.round(opts?.width ?? PLAIN_QR_WIDTH_PX));
  const canvas = getQrCanvasEnvironment().createCanvas(width, width);
  const { toCanvas } = await loadQrCodeModule();
  await toCanvas(canvas, encoded, {
    width,
    margin: QR_QUIET_ZONE_MODULES,
    errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
    color: { dark: PLAIN_QR_MODULE_DARK, light: PLAIN_QR_MODULE_LIGHT },
  });
  return canvas;
}

export async function renderPlainQrUrlToDataUrl(
  url: string,
  opts?: PlainQrRenderOptions,
): Promise<string> {
  const canvas = await renderPlainQrUrlToCanvas(url, opts);
  if (!canvas) return "";
  return canvas.toDataURL("image/png");
}

export async function validatePlainQrReliability(
  url: string,
  opts?: PlainQrRenderOptions,
): Promise<{
  canvas: HTMLCanvasElement | null;
  report: QrReliabilityReport | null;
}> {
  const encoded = String(url ?? "").trim();
  if (!encoded) {
    return { canvas: null, report: null };
  }

  const canvas = await renderPlainQrUrlToCanvas(encoded, {
    width: opts?.width ?? PLAIN_QR_WIDTH_PX,
  });
  if (!canvas) return { canvas: null, report: null };

  const decodedText = await decodeQrFromCanvasRobust(canvas);
  const report = buildReliabilityReport({
    expectedUrl: encoded,
    decodedText,
    moduleDark: PLAIN_QR_MODULE_DARK,
    moduleLight: PLAIN_QR_MODULE_LIGHT,
    logoAreaRatio: 0,
    requestedShape: "square",
    shapeSanitized: false,
  });

  return { canvas, report };
}

export async function renderPlainEmployeeQrToDataUrl(
  businessSlug: string,
  employeeSlug: string,
  opts?: PlainQrRenderOptions,
): Promise<string> {
  return renderPlainQrUrlToDataUrl(publicEmployeeTipUrl(businessSlug, employeeSlug), opts);
}

export async function renderPlainEmployeeQrToDataUrlLegacy(
  employeeId: string,
  opts?: PlainQrRenderOptions,
): Promise<string> {
  return renderPlainQrUrlToDataUrl(qrEmployeeLegacyUrl(employeeId), opts);
}

function triggerPngDownload(canvas: HTMLCanvasElement, filename: string): boolean {
  const dataUrl = canvas.toDataURL("image/png");
  return downloadQrDataUrlPng(dataUrl, filename, { exportAllowed: true });
}

export async function downloadPlainEmployeeQr(
  businessSlug: string,
  employeeSlug: string,
  employeeName: string,
): Promise<boolean> {
  return withIdleSuppress("qr-plain-export", async () => {
    const url = publicEmployeeTipUrl(businessSlug, employeeSlug);
    const { canvas, report } = await validatePlainQrReliability(url);
    if (!canvas || !isQrExportAllowed(report)) return false;
    const filename = `caretip-${employeeSlug}-${employeeName.replace(/\s+/g, "-").toLowerCase()}.png`;
    return triggerPngDownload(canvas, filename);
  });
}

export async function downloadPlainEmployeeQrLegacy(
  employeeId: string,
  employeeName: string,
): Promise<boolean> {
  const url = qrEmployeeLegacyUrl(employeeId);
  const { canvas, report } = await validatePlainQrReliability(url);
  if (!canvas || !isQrExportAllowed(report)) return false;
  const filename = `caretip-${employeeId.slice(0, 8)}-${employeeName.replace(/\s+/g, "-").toLowerCase()}.png`;
  return triggerPngDownload(canvas, filename);
}
