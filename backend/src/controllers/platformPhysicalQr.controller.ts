import type { Request, Response } from "express";
import { logServerError } from "../utils/httpErrors.js";
import { PhysicalQrStatusError } from "../lib/physicalQr/status.js";
import { PhysicalQrOrderError } from "../services/physicalQr/physicalQrOrder.service.js";
import {
  PhysicalQrFulfillmentError,
  deliverPhysicalQrOrder,
  getPhysicalQrOrderForAdmin,
  listPhysicalQrOrdersForAdmin,
  markPhysicalQrOrderPrinting,
  markPhysicalQrOrderProcessing,
  shipPhysicalQrOrder,
  toAdminOrderDto,
} from "../services/physicalQr/physicalQrFulfillment.service.js";
import { resolveOrderItemRows } from "../services/physicalQr/physicalQrOrder.service.js";
import {
  listPhysicalQrInternalNotes,
  postPhysicalQrInternalNote,
} from "../services/physicalQr/physicalQrMessage.service.js";
import { renderPhysicalQrPrint } from "../lib/physicalQr/printPipeline.js";
import { jpegToA5Pdf, jpegsToA5Pdf } from "../lib/physicalQr/pdfA5.js";
import { PHYSICAL_QR_QUANTITY_MAX, PHYSICAL_QR_QUANTITY_MIN } from "../lib/physicalQr/types.js";

function mapErr(res: Response, err: unknown, ctx: string) {
  if (err instanceof PhysicalQrFulfillmentError) {
    return res.status(err.httpStatus).json({ success: false, code: err.code, message: err.message });
  }
  if (err instanceof PhysicalQrOrderError) {
    return res.status(err.httpStatus).json({ success: false, code: err.code, message: err.message });
  }
  if (err instanceof PhysicalQrStatusError) {
    return res.status(409).json({ success: false, code: err.code, message: err.message });
  }
  logServerError(ctx, err);
  return res.status(500).json({ success: false, message: "Something went wrong" });
}

function actorId(req: Request): string {
  return String(req.user?.userId ?? req.user?.id ?? "");
}

export async function adminListPhysicalQrOrders(req: Request, res: Response) {
  try {
    const rows = await listPhysicalQrOrdersForAdmin({
      filter: typeof req.query.filter === "string" ? req.query.filter : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
    });
    return res.json({ orders: rows.map(toAdminOrderDto) });
  } catch (err) {
    return mapErr(res, err, "physicalQr.admin.list");
  }
}

export async function adminGetPhysicalQrOrder(req: Request, res: Response) {
  try {
    const row = await getPhysicalQrOrderForAdmin(String(req.params.orderId ?? ""));
    const internalNotes = await listPhysicalQrInternalNotes(row.id);
    return res.json({ order: toAdminOrderDto(row), internalNotes });
  } catch (err) {
    return mapErr(res, err, "physicalQr.admin.get");
  }
}

function itemPrintAddress(item: {
  product?: { supportsAddress?: boolean } | null;
  addressSnapshot: unknown;
}): string | null {
  const supportsAddress = Boolean(item.product?.supportsAddress);
  if (
    !supportsAddress ||
    !item.addressSnapshot ||
    typeof item.addressSnapshot !== "object"
  ) {
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

export async function adminPrintPhysicalQrOrder(req: Request, res: Response) {
  try {
    const row = await getPhysicalQrOrderForAdmin(String(req.params.orderId ?? ""));
    if (row.paymentStatus !== "PAID") {
      return res.status(409).json({
        success: false,
        code: "PAYMENT_REQUIRED",
        message: "Print files are available after payment is confirmed.",
      });
    }
    const itemId = String(req.query.itemId ?? "").trim();
    const items = resolveOrderItemRows(row);
    if (!items.length) {
      return res.status(404).json({ success: false, message: "Print item not found." });
    }

    const format = String(req.query.format ?? "pdf").toLowerCase();
    const renderOne = async (item: (typeof items)[number]) => {
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
    };

    // Single line item (explicit itemId, or legacy one-item order with PNG).
    if (itemId || format === "png" || items.length === 1) {
      const item = itemId ? items.find((i) => i.id === itemId) : items[0];
      if (!item) {
        return res.status(404).json({ success: false, message: "Print item not found." });
      }
      const printed = await renderOne(item);
      const copies = itemCopies(item.quantity);
      if (format === "png") {
        res.setHeader("Content-Type", "image/png");
        return res.send(printed.png);
      }
      const pdf = jpegToA5Pdf(printed.jpeg, printed.widthPx, printed.heightPx, copies);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="caretip-a5-${row.id}${copies > 1 ? `-x${copies}` : ""}.pdf"`,
      );
      return res.send(pdf);
    }

    // Bulk: one combined PDF with every line item × its quantity (same parent order only).
    try {
      const pages = [];
      for (const item of items) {
        const printed = await renderOne(item);
        pages.push({
          jpeg: printed.jpeg,
          pixelWidth: printed.widthPx,
          pixelHeight: printed.heightPx,
          copies: itemCopies(item.quantity),
        });
      }
      const totalPages = pages.reduce((sum, p) => sum + (p.copies ?? 1), 0);
      const pdf = jpegsToA5Pdf(pages);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="caretip-a5-${row.id}-all-x${totalPages}.pdf"`,
      );
      return res.send(pdf);
    } catch (bulkErr) {
      const message = bulkErr instanceof Error ? bulkErr.message : "Could not build combined PDF.";
      if (message.includes("exceeds")) {
        return res.status(413).json({ success: false, code: "PRINT_TOO_LARGE", message });
      }
      throw bulkErr;
    }
  } catch (err) {
    return mapErr(res, err, "physicalQr.admin.print");
  }
}

export async function adminMarkPhysicalQrProcessing(req: Request, res: Response) {
  try {
    const row = await markPhysicalQrOrderProcessing(String(req.params.orderId ?? ""));
    return res.json(toAdminOrderDto(row));
  } catch (err) {
    return mapErr(res, err, "physicalQr.admin.processing");
  }
}

export async function adminMarkPhysicalQrPrinting(req: Request, res: Response) {
  try {
    const row = await markPhysicalQrOrderPrinting(String(req.params.orderId ?? ""));
    return res.json(toAdminOrderDto(row));
  } catch (err) {
    return mapErr(res, err, "physicalQr.admin.printing");
  }
}

export async function adminShipPhysicalQrOrder(req: Request, res: Response) {
  try {
    const row = await shipPhysicalQrOrder({
      orderId: String(req.params.orderId ?? ""),
      carrier: req.body?.carrier,
      trackingNumber: req.body?.trackingNumber,
      trackingUrl: req.body?.trackingUrl,
    });
    return res.json(toAdminOrderDto(row));
  } catch (err) {
    return mapErr(res, err, "physicalQr.admin.ship");
  }
}

export async function adminDeliverPhysicalQrOrder(req: Request, res: Response) {
  try {
    const row = await deliverPhysicalQrOrder(String(req.params.orderId ?? ""));
    return res.json(toAdminOrderDto(row));
  } catch (err) {
    return mapErr(res, err, "physicalQr.admin.deliver");
  }
}

export async function adminListPhysicalQrNotes(req: Request, res: Response) {
  try {
    const notes = await listPhysicalQrInternalNotes(String(req.params.orderId ?? ""));
    return res.json({ notes });
  } catch (err) {
    return mapErr(res, err, "physicalQr.admin.notes");
  }
}

export async function adminPostPhysicalQrNote(req: Request, res: Response) {
  try {
    const note = await postPhysicalQrInternalNote({
      userId: actorId(req),
      orderId: String(req.params.orderId ?? ""),
      body: req.body?.body,
    });
    return res.status(201).json(note);
  } catch (err) {
    return mapErr(res, err, "physicalQr.admin.postNote");
  }
}
