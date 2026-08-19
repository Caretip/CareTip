import {
  PHYSICAL_QR_PRINT_HEIGHT_MM,
  PHYSICAL_QR_PRINT_WIDTH_MM,
  PHYSICAL_QR_QUANTITY_MAX,
  PHYSICAL_QR_QUANTITY_MIN,
} from "./types.js";

function pad10(n: number): string {
  return String(n).padStart(10, "0");
}

function clampPageCount(pageCount: number | undefined): number {
  if (pageCount == null || !Number.isInteger(pageCount)) return PHYSICAL_QR_QUANTITY_MIN;
  return Math.min(PHYSICAL_QR_QUANTITY_MAX, Math.max(PHYSICAL_QR_QUANTITY_MIN, pageCount));
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
  const copies = clampPageCount(pageCount);
  const pageW = ((PHYSICAL_QR_PRINT_WIDTH_MM * 72) / 25.4).toFixed(3);
  const pageH = ((PHYSICAL_QR_PRINT_HEIGHT_MM * 72) / 25.4).toFixed(3);
  const contents = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q\n`;
  const firstPageId = 3;
  const imageId = firstPageId + copies;
  const contentsId = imageId + 1;
  const lastId = contentsId;

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

  const kids = Array.from({ length: copies }, (_, i) => `${firstPageId + i} 0 R`).join(" ");

  push("%PDF-1.4\n");
  addObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObj(2, `<< /Type /Pages /Kids [${kids}] /Count ${copies} >>`);
  for (let i = 0; i < copies; i++) {
    addObj(
      firstPageId + i,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentsId} 0 R >>`,
    );
  }

  offsets[imageId] = cursor;
  push(`${imageId} 0 obj\n`);
  push(
    `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push("\nendstream\nendobj\n");

  addObj(contentsId, `<< /Length ${contents.length} >>\nstream\n${contents}endstream`);

  const xrefPos = cursor;
  let xref = `xref\n0 ${lastId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= lastId; i++) {
    xref += `${pad10(offsets[i] ?? 0)} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${lastId + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return Buffer.concat(parts);
}
