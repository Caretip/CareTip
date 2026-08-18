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
