import {
  PHYSICAL_QR_PRINT_HEIGHT_MM,
  PHYSICAL_QR_PRINT_WIDTH_MM,
  PHYSICAL_QR_QUANTITY_MAX,
  PHYSICAL_QR_QUANTITY_MIN,
} from "./types.js";

/** Soft cap for a single combined admin download (sum of line-item copies). */
export const PHYSICAL_QR_COMBINED_PDF_MAX_PAGES = 250;

function pad10(n: number): string {
  return String(n).padStart(10, "0");
}

function clampPageCount(pageCount: number | undefined): number {
  if (pageCount == null || !Number.isInteger(pageCount)) return PHYSICAL_QR_QUANTITY_MIN;
  return Math.min(PHYSICAL_QR_QUANTITY_MAX, Math.max(PHYSICAL_QR_QUANTITY_MIN, pageCount));
}

export type A5JpegPageInput = {
  jpeg: Buffer;
  pixelWidth: number;
  pixelHeight: number;
  /** How many identical A5 pages to emit for this JPEG (order line quantity). */
  copies?: number;
};

/**
 * Build one A5 PDF from one or more JPEG rasters.
 * Each input becomes `copies` identical pages (default 1). Different inputs
 * keep distinct QR destinations / artwork while sharing one download file.
 */
export function jpegsToA5Pdf(inputs: A5JpegPageInput[]): Buffer {
  if (!inputs.length) {
    throw new Error("jpegsToA5Pdf requires at least one page");
  }

  const slots = inputs.map((input) => ({
    jpeg: input.jpeg,
    pixelWidth: input.pixelWidth,
    pixelHeight: input.pixelHeight,
    copies: clampPageCount(input.copies),
  }));
  const totalPages = slots.reduce((sum, slot) => sum + slot.copies, 0);
  if (totalPages > PHYSICAL_QR_COMBINED_PDF_MAX_PAGES) {
    throw new Error(
      `Combined PDF exceeds ${PHYSICAL_QR_COMBINED_PDF_MAX_PAGES} pages (${totalPages}). Download line items individually.`,
    );
  }

  const pageW = ((PHYSICAL_QR_PRINT_WIDTH_MM * 72) / 25.4).toFixed(3);
  const pageH = ((PHYSICAL_QR_PRINT_HEIGHT_MM * 72) / 25.4).toFixed(3);

  type FlatPage = { slotIndex: number };
  const flatPages: FlatPage[] = [];
  slots.forEach((slot, slotIndex) => {
    for (let i = 0; i < slot.copies; i++) flatPages.push({ slotIndex });
  });

  const firstPageId = 3;
  const firstImageId = firstPageId + flatPages.length;
  const firstContentsId = firstImageId + slots.length;
  const lastId = firstContentsId + slots.length - 1;

  const parts: Buffer[] = [];
  const offsets: number[] = [0];
  let cursor = 0;

  const push = (chunk: Buffer | string) => {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "latin1") : chunk;
    parts.push(buf);
    cursor += buf.length;
  };

  const addObj = (id: number, body: Buffer | string) => {
    offsets[id] = cursor;
    push(`${id} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  };

  const kids = flatPages.map((_, i) => `${firstPageId + i} 0 R`).join(" ");

  push("%PDF-1.4\n");
  addObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObj(2, `<< /Type /Pages /Kids [${kids}] /Count ${flatPages.length} >>`);

  for (let i = 0; i < flatPages.length; i++) {
    const slotIndex = flatPages[i]!.slotIndex;
    const imageId = firstImageId + slotIndex;
    const contentsId = firstContentsId + slotIndex;
    addObj(
      firstPageId + i,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentsId} 0 R >>`,
    );
  }

  for (let s = 0; s < slots.length; s++) {
    const slot = slots[s]!;
    const imageId = firstImageId + s;
    offsets[imageId] = cursor;
    push(`${imageId} 0 obj\n`);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${slot.pixelWidth} /Height ${slot.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${slot.jpeg.length} >>\nstream\n`,
    );
    push(slot.jpeg);
    push("\nendstream\nendobj\n");
  }

  for (let s = 0; s < slots.length; s++) {
    const contents = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q\n`;
    addObj(firstContentsId + s, `<< /Length ${contents.length} >>\nstream\n${contents}endstream`);
  }

  const xrefPos = cursor;
  let xref = `xref\n0 ${lastId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= lastId; i++) {
    xref += `${pad10(offsets[i] ?? 0)} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${lastId + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return Buffer.concat(parts);
}

/**
 * A5 PDF wrapping a JPEG raster. `pageCount` defaults to 1 so existing callers
 * still get a single page. When greater than 1, the same JPEG is repeated on
 * identical A5 pages (ordered quantity).
 * Page size is exactly 148 × 210 mm.
 */
export function jpegToA5Pdf(
  jpeg: Buffer,
  pixelWidth: number,
  pixelHeight: number,
  pageCount?: number,
): Buffer {
  return jpegsToA5Pdf([{ jpeg, pixelWidth, pixelHeight, copies: pageCount }]);
}
