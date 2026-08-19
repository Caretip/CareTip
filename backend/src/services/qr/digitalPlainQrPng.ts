/**
 * Server-side digital plain QR PNG (Employee / Location / Table / storefront downloads).
 * Not the Physical A5 print pipeline — do not import physicalQr/* from here.
 */

import QRCode from "qrcode";
import { BrandedQrRenderFailedError } from "./brandedQr.errors.js";

export const DIGITAL_PLAIN_QR_FINGERPRINT = "digital-plain-v1";
export const DIGITAL_PLAIN_QR_WIDTH_PX = 640;

export async function renderDigitalPlainQrPngBuffer(targetUrl: string): Promise<Buffer> {
  const encoded = targetUrl.trim();
  if (!encoded) {
    throw new BrandedQrRenderFailedError();
  }

  try {
    const buffer = await QRCode.toBuffer(encoded, {
      type: "png",
      errorCorrectionLevel: "H",
      margin: 4,
      width: DIGITAL_PLAIN_QR_WIDTH_PX,
      color: { dark: "#000000", light: "#FFFFFF" },
    });
    if (!buffer?.length) {
      throw new BrandedQrRenderFailedError();
    }
    return buffer;
  } catch (err) {
    if (err instanceof BrandedQrRenderFailedError) throw err;
    throw new BrandedQrRenderFailedError();
  }
}
