import { renderPhysicalQrPrint } from "../../lib/physicalQr/printPipeline.js";
import { jpegToA5Pdf, jpegsToA5Pdf } from "../../lib/physicalQr/pdfA5.js";
import { zipStore } from "../../lib/physicalQr/zipStore.js";
import { PHYSICAL_QR_QUANTITY_MAX, PHYSICAL_QR_QUANTITY_MIN } from "../../lib/physicalQr/types.js";
import { resolveOrderItemRows } from "./physicalQrOrder.service.js";
import { PhysicalQrFulfillmentError, getPhysicalQrOrderForAdmin } from "./physicalQrFulfillment.service.js";

export const PHYSICAL_QR_BULK_ZIP_MAX_ORDERS = 25;

function itemPrintAddress(item: {
  product?: { supportsAddress?: boolean } | null;
  addressSnapshot: unknown;
}): string | null {
  const supportsAddress = Boolean(item.product?.supportsAddress);
  if (!supportsAddress || !item.addressSnapshot || typeof item.addressSnapshot !== "object") {
    return null;
  }
  return String((item.addressSnapshot as { line?: string }).line ?? "") || null;
}

function itemCopies(quantity: number): number {
  return Math.min(
    PHYSICAL_QR_QUANTITY_MAX,
    Math.max(PHYSICAL_QR_QUANTITY_MIN, Number.isInteger(quantity) ? quantity : 1),
  );
}

function parseRequestedOrderIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of raw) {
    const id = String(value ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function normalizePhysicalQrBulkPrintOrderIds(raw: unknown): string[] {
  return parseRequestedOrderIds(raw).slice(0, PHYSICAL_QR_BULK_ZIP_MAX_ORDERS);
}

async function renderItem(row: Awaited<ReturnType<typeof getPhysicalQrOrderForAdmin>>, item: ReturnType<typeof resolveOrderItemRows>[number]) {
  const product = item.product!;
  return renderPhysicalQrPrint({
    targetUrl: item.qrTargetUrlSnapshot,
    businessName: row.businessNameSnapshot,
    address: itemPrintAddress(item),
    supportsAddress: product.supportsAddress,
    colorTokens: (item.colorTokensSnapshot ?? {}) as {
      backgroundGradientStart: string;
      backgroundGradientEnd: string;
      primaryTextColor: string;
      secondaryTextColor: string;
    },
  });
}

/** Same PDF the admin individual/combined download already produces. */
export async function buildPhysicalQrOrderPdfForAdmin(
  row: Awaited<ReturnType<typeof getPhysicalQrOrderForAdmin>>,
  itemId?: string,
): Promise<{ pdf: Buffer; filename: string; pageCount: number }> {
  if (row.paymentStatus !== "PAID") {
    throw new PhysicalQrFulfillmentError(
      "PAYMENT_REQUIRED",
      "Print files are available after payment is confirmed.",
      409,
    );
  }
  const items = resolveOrderItemRows(row);
  if (!items.length) {
    throw new PhysicalQrFulfillmentError("PRINT_ITEM_NOT_FOUND", "Print item not found.", 404);
  }

  if (itemId || items.length === 1) {
    const item = itemId ? items.find((i) => i.id === itemId) : items[0];
    if (!item) {
      throw new PhysicalQrFulfillmentError("PRINT_ITEM_NOT_FOUND", "Print item not found.", 404);
    }
    const printed = await renderItem(row, item);
    const copies = itemCopies(item.quantity);
    return {
      pdf: jpegToA5Pdf(printed.jpeg, printed.widthPx, printed.heightPx, copies),
      filename: `caretip-a5-${row.id}${copies > 1 ? `-x${copies}` : ""}.pdf`,
      pageCount: copies,
    };
  }

  const pages = [];
  for (const item of items) {
    const printed = await renderItem(row, item);
    pages.push({
      jpeg: printed.jpeg,
      pixelWidth: printed.widthPx,
      pixelHeight: printed.heightPx,
      copies: itemCopies(item.quantity),
    });
  }
  const pageCount = pages.reduce((sum, p) => sum + (p.copies ?? 1), 0);
  return {
    pdf: jpegsToA5Pdf(pages),
    filename: `caretip-a5-${row.id}-all-x${pageCount}.pdf`,
    pageCount,
  };
}

export async function buildPhysicalQrOrdersZipForAdmin(orderIdsRaw: unknown): Promise<{
  zip: Buffer | null;
  prepared: number;
  failed: number;
  requested: number;
}> {
  const orderIds = parseRequestedOrderIds(orderIdsRaw);
  if (orderIds.length > PHYSICAL_QR_BULK_ZIP_MAX_ORDERS) {
    throw new PhysicalQrFulfillmentError(
      "BULK_TOO_LARGE",
      `At most ${PHYSICAL_QR_BULK_ZIP_MAX_ORDERS} orders can be prepared at once.`,
      413,
    );
  }
  const entries: Array<{ name: string; data: Buffer }> = [];
  let failed = 0;
  for (const orderId of orderIds) {
    try {
      const row = await getPhysicalQrOrderForAdmin(orderId);
      const built = await buildPhysicalQrOrderPdfForAdmin(row);
      entries.push({ name: built.filename, data: built.pdf });
    } catch {
      failed += 1;
    }
  }
  return {
    zip: entries.length ? zipStore(entries) : null,
    prepared: entries.length,
    failed,
    requested: orderIds.length,
  };
}
