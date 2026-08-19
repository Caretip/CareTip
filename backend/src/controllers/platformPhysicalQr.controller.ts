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
import {
  listPhysicalQrInternalNotes,
  postPhysicalQrInternalNote,
} from "../services/physicalQr/physicalQrMessage.service.js";
import { renderPhysicalQrPrint } from "../lib/physicalQr/printPipeline.js";
import { jpegToA5Pdf } from "../lib/physicalQr/pdfA5.js";
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
    const product = row.product;
    const address =
      product.supportsAddress && row.addressSnapshot && typeof row.addressSnapshot === "object"
        ? String((row.addressSnapshot as { line?: string }).line ?? "")
        : null;
    const printed = await renderPhysicalQrPrint({
      targetUrl: row.qrTargetUrlSnapshot,
      businessName: row.businessNameSnapshot,
      address,
      supportsAddress: product.supportsAddress,
      colorTokens: (row.colorTokensSnapshot ?? {}) as {
        backgroundGradientStart: string;
        backgroundGradientEnd: string;
        primaryTextColor: string;
        secondaryTextColor: string;
      },
    });
    const copies = Math.min(
      PHYSICAL_QR_QUANTITY_MAX,
      Math.max(PHYSICAL_QR_QUANTITY_MIN, Number.isInteger(row.quantity) ? row.quantity : 1),
    );
    const format = String(req.query.format ?? "pdf").toLowerCase();
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
