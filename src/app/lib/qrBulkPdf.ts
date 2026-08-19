/**
 * Bulk staff QR PDF — one plain QR PNG per A4 page.
 * Uses the same digital plain matrix as QR Studio preview / gallery PNGs.
 */

import { publicEmployeeTipUrl, qrEmployeeLegacyUrl } from "./appPublicUrl";
import { renderPlainQrUrlToDataUrl } from "./plainQr";
import { createJsPdfDocument } from "./qrPdfLazy";
import {
  embedBrandedTemplateCardOnPage,
  loadBrandedCardDimensions,
} from "./qrPrintPdf";

export type StaffQrPdfRow = {
  id: string;
  name: string;
  businessSlug?: string;
  employeeSlug?: string;
};

export type StaffQrBulkPdfOptions = {
  /** Re-use gallery preview PNGs when available (same pixels as on-screen cards). */
  resolveCardDataUrl?: (employeeId: string) => string | null | undefined;
};

/** A4 multi-page PDF: each page is one plain QR matrix. */
export async function downloadStaffQrPdf(
  items: StaffQrPdfRow[],
  fileBaseName: string,
  opts?: StaffQrBulkPdfOptions,
): Promise<void> {
  const withId = items.filter((i) => i.id?.trim());
  if (withId.length === 0) return;

  const pdf = await createJsPdfDocument({ unit: "mm", format: "a4", orientation: "portrait" });

  for (let i = 0; i < withId.length; i++) {
    if (i > 0) pdf.addPage();
    const row = withId[i]!;

    let dataUrl = opts?.resolveCardDataUrl?.(row.id)?.trim() || "";
    if (!dataUrl) {
      const url =
        row.businessSlug && row.employeeSlug
          ? publicEmployeeTipUrl(row.businessSlug, row.employeeSlug)
          : qrEmployeeLegacyUrl(row.id);
      dataUrl = await renderPlainQrUrlToDataUrl(url);
    }
    if (!dataUrl) continue;

    const dims = await loadBrandedCardDimensions(dataUrl);
    embedBrandedTemplateCardOnPage(pdf, dataUrl, dims);
  }

  pdf.save(`${fileBaseName}.pdf`);
}
