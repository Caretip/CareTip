/**
 * PDF export for digital QR images (plain matrix or leftover branded cards).
 *
 * Embeds the caller-supplied PNG on A4 or 105×148 mm. Digital management surfaces
 * pass a plain QR; this helper does not render Physical A5 artwork.
 */

import { createJsPdfDocument, type JsPDFDocument } from "./qrPdfLazy";

export type PdfSize = "a4" | "card";

const EMBED_MARGIN_MM = 12;

function safeFileBase(raw: string): string {
  const s = String(raw ?? "").trim();
  const base = s.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return base || "caretip_qr";
}

async function buildPdf(size: PdfSize): Promise<JsPDFDocument> {
  if (size === "card") {
    return createJsPdfDocument({ unit: "mm", format: [105, 148], orientation: "portrait" });
  }
  return createJsPdfDocument({ unit: "mm", format: "a4", orientation: "portrait" });
}

/** Load intrinsic pixel dimensions of a PNG data URL (browser only). */
export function loadBrandedCardDimensions(
  brandedCardPngDataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        reject(new Error("Branded card image has no dimensions"));
      }
    };
    img.onerror = () => reject(new Error("Failed to load branded card image"));
    img.src = brandedCardPngDataUrl;
  });
}

/**
 * Fit the full branded template card on a PDF page (contain, centered).
 * The image is the complete Template Engine output — preview parity guaranteed.
 */
export function embedBrandedTemplateCardOnPage(
  pdf: JsPDFDocument,
  brandedCardPngDataUrl: string,
  imagePx: { width: number; height: number },
  opts?: { marginMm?: number },
): void {
  const margin = opts?.marginMm ?? EMBED_MARGIN_MM;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  const aspect = imagePx.width / imagePx.height;

  let drawW = availW;
  let drawH = drawW / aspect;
  if (drawH > availH) {
    drawH = availH;
    drawW = drawH * aspect;
  }

  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;
  pdf.addImage(brandedCardPngDataUrl, "PNG", x, y, drawW, drawH);
}

/** Core PDF builder — one branded template card per page. */
export async function createBrandedTemplateCardPdf(params: {
  brandedCardPngDataUrl: string;
  size?: PdfSize;
  marginMm?: number;
}): Promise<JsPDFDocument> {
  const dataUrl = params.brandedCardPngDataUrl?.trim();
  if (!dataUrl) throw new Error("Missing branded card image for PDF export");

  const dims = await loadBrandedCardDimensions(dataUrl);
  const pdf = await buildPdf(params.size ?? "a4");
  embedBrandedTemplateCardOnPage(pdf, dataUrl, dims, { marginMm: params.marginMm });
  return pdf;
}

/**
 * Business / venue PDF — embeds `qrPngDataUrl` (plain digital QR on management surfaces).
 * @deprecated Legacy params (`businessName`, `subtext`, `instruction`, `businessLogoPngDataUrl`) are ignored for layout.
 */
export async function createBusinessQrPrintPdf(params: {
  qrPngDataUrl: string;
  businessName?: string;
  subtext?: string | null;
  instruction?: string | null;
  size?: PdfSize;
  businessLogoPngDataUrl?: string | null;
}): Promise<JsPDFDocument> {
  return createBrandedTemplateCardPdf({
    brandedCardPngDataUrl: params.qrPngDataUrl,
    size: params.size,
  });
}

export async function downloadBusinessQrPrintPdf(params: {
  qrPngDataUrl: string;
  businessName?: string;
  subtext?: string | null;
  instruction?: string | null;
  fileBaseName?: string;
  size?: PdfSize;
  businessLogoPngDataUrl?: string | null;
}): Promise<void> {
  const pdf = await createBusinessQrPrintPdf(params);
  const base = safeFileBase(
    params.fileBaseName ?? `CareTip_QR_${String(params.businessName ?? "").trim() || "Business"}`,
  );
  pdf.save(`${base}.pdf`);
}

/**
 * Employee PDF — embeds `qrPngDataUrl` (plain digital QR on management surfaces).
 * @deprecated Legacy params (`employeeName`, `businessName`, `instruction`, `businessLogoPngDataUrl`) are ignored for layout.
 */
export async function createEmployeeQrPrintPdf(params: {
  qrPngDataUrl: string;
  employeeName?: string;
  businessName?: string;
  instruction?: string | null;
  size?: PdfSize;
  businessLogoPngDataUrl?: string | null;
}): Promise<JsPDFDocument> {
  return createBrandedTemplateCardPdf({
    brandedCardPngDataUrl: params.qrPngDataUrl,
    size: params.size,
  });
}

export async function downloadEmployeeQrPrintPdf(params: {
  qrPngDataUrl: string;
  employeeName?: string;
  businessName?: string;
  instruction?: string | null;
  fileBaseName?: string;
  size?: PdfSize;
  businessLogoPngDataUrl?: string | null;
}): Promise<void> {
  const pdf = await createEmployeeQrPrintPdf(params);
  const base = safeFileBase(
    params.fileBaseName ?? `CareTip_QR_${String(params.employeeName ?? "").trim() || "Team_member"}`,
  );
  pdf.save(`${base}.pdf`);
}
