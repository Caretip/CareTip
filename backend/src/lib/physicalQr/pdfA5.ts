import {
  PHYSICAL_QR_PRINT_HEIGHT_MM,
  PHYSICAL_QR_PRINT_WIDTH_MM,
} from "./types.js";

function pad10(n: number): string {
  return String(n).padStart(10, "0");
}

/**
 * Single-page A5 PDF wrapping a JPEG raster. Avoids a heavy PDF dependency.
 * Page size is exactly 148 × 210 mm.
 */
export function jpegToA5Pdf(jpeg: Buffer, pixelWidth: number, pixelHeight: number): Buffer {
  const pageW = ((PHYSICAL_QR_PRINT_WIDTH_MM * 72) / 25.4).toFixed(3);
  const pageH = ((PHYSICAL_QR_PRINT_HEIGHT_MM * 72) / 25.4).toFixed(3);
  const contents = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q\n`;

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

  push("%PDF-1.4\n");
  addObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );

  offsets[4] = cursor;
  push("4 0 obj\n");
  push(
    `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push("\nendstream\nendobj\n");

  addObj(5, `<< /Length ${contents.length} >>\nstream\n${contents}endstream`);

  const xrefPos = cursor;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    xref += `${pad10(offsets[i] ?? 0)} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return Buffer.concat(parts);
}
