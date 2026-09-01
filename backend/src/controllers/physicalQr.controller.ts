import type { Request, Response } from "express";
import { Role } from "@prisma/client";
import { logServerError } from "../utils/httpErrors.js";
import { resolveBusinessIdForRequest } from "../services/subscriptionEntitlement.service.js";
import { PhysicalQrColorError } from "../lib/physicalQr/colors.js";
import { PhysicalQrContextError, listPhysicalQrContextOptions, resolvePhysicalQrContext } from "../services/physicalQr/qrContext.service.js";
import { listActivePhysicalQrProducts } from "../services/physicalQr/physicalQrCatalog.service.js";
import {
  PhysicalQrOrderError,
  createPhysicalQrOrder,
  getPhysicalQrOrderForBusiness,
  listPhysicalQrOrdersForBusiness,
  quotePhysicalQrCartForBusiness,
  resolveOrderItemRows,
  toCustomerOrderDto,
} from "../services/physicalQr/physicalQrOrder.service.js";
import { createPhysicalQrCheckoutSession } from "../services/physicalQr/physicalQrCheckout.service.js";
import {
  createPhysicalQrBatchCheckoutSession,
  createPhysicalQrBatchOrders,
} from "../services/physicalQr/physicalQrBatch.service.js";
import { PhysicalQrCheckoutBlockedError } from "../config/physicalQrCheckout.js";
import { renderPhysicalQrPrint } from "../lib/physicalQr/printPipeline.js";
import { jpegToA5Pdf } from "../lib/physicalQr/pdfA5.js";
import {
  PHYSICAL_QR_QUANTITY_MAX,
  PHYSICAL_QR_QUANTITY_MIN,
} from "../lib/physicalQr/types.js";

function mapErr(res: Response, err: unknown, ctx: string) {
  if (err instanceof PhysicalQrOrderError) {
    return res.status(err.httpStatus).json({ success: false, code: err.code, message: err.message });
  }
  if (err instanceof PhysicalQrContextError) {
    return res.status(err.httpStatus).json({ success: false, code: err.code, message: err.message });
  }
  if (err instanceof PhysicalQrCheckoutBlockedError) {
    return res.status(409).json({ success: false, code: err.code, message: err.message });
  }
  if (err instanceof PhysicalQrColorError) {
    return res.status(400).json({ success: false, code: err.code, reasons: err.reasons, message: err.message });
  }
  logServerError(ctx, err);
  return res.status(500).json({ success: false, message: "Something went wrong" });
}

async function requireManagerBusiness(req: Request, res: Response): Promise<{ userId: string; businessId: string } | null> {
  const userId = req.user?.userId ?? req.user?.id;
  if (!userId || req.user?.role !== Role.MANAGER) {
    res.status(401).json({ message: "Authentication required" });
    return null;
  }
  const businessId = await resolveBusinessIdForRequest(req);
  if (!businessId) {
    res.status(403).json({ message: "Insufficient permissions" });
    return null;
  }
  return { userId, businessId };
}

export async function listPhysicalQrCatalog(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const products = await listActivePhysicalQrProducts();
    return res.json({ products });
  } catch (err) {
    return mapErr(res, err, "physicalQr.catalog");
  }
}

export async function listPhysicalQrContexts(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const options = await listPhysicalQrContextOptions(auth.businessId);
    return res.json(options);
  } catch (err) {
    return mapErr(res, err, "physicalQr.contexts");
  }
}

export async function resolvePhysicalQrContextEndpoint(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const resolved = await resolvePhysicalQrContext({
      businessId: auth.businessId,
      qrContextType: req.body?.qrContextType ?? req.query.qrContextType,
      qrSubjectId: req.body?.qrSubjectId ?? req.query.qrSubjectId,
    });
    return res.json(resolved);
  } catch (err) {
    return mapErr(res, err, "physicalQr.resolveContext");
  }
}

export async function listMyPhysicalQrOrders(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const rows = await listPhysicalQrOrdersForBusiness(auth.businessId);
    return res.json({ orders: rows.map(toCustomerOrderDto) });
  } catch (err) {
    return mapErr(res, err, "physicalQr.listOrders");
  }
}

export async function getMyPhysicalQrOrder(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const row = await getPhysicalQrOrderForBusiness(auth.businessId, String(req.params.orderId ?? ""));
    return res.json(toCustomerOrderDto(row));
  } catch (err) {
    return mapErr(res, err, "physicalQr.getOrder");
  }
}

export async function createMyPhysicalQrOrder(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const row = await createPhysicalQrOrder({
      businessId: auth.businessId,
      userId: auth.userId,
      productId: req.body?.productId,
      qrContextType: req.body?.qrContextType,
      qrSubjectId: req.body?.qrSubjectId,
      quantity: req.body?.quantity,
      address: req.body?.address,
      shipping: req.body?.shipping,
      contact: req.body?.contact,
      colorTokens: req.body?.colorTokens,
      unitPrice: req.body?.unitPrice,
      totalAmount: req.body?.totalAmount,
      businessIdClient: req.body?.businessId,
      paymentStatus: req.body?.paymentStatus,
      fulfillmentStatus: req.body?.fulfillmentStatus,
      qrTargetUrl: req.body?.qrTargetUrl,
    });
    return res.status(201).json(toCustomerOrderDto(row));
  } catch (err) {
    return mapErr(res, err, "physicalQr.createOrder");
  }
}

export async function checkoutMyPhysicalQrOrder(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const result = await createPhysicalQrCheckoutSession({
      businessId: auth.businessId,
      userId: auth.userId,
      orderId: String(req.params.orderId ?? req.body?.orderId ?? ""),
    });
    return res.json(result);
  } catch (err) {
    return mapErr(res, err, "physicalQr.checkout");
  }
}

export async function printMyPhysicalQrOrder(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const row = await getPhysicalQrOrderForBusiness(auth.businessId, String(req.params.orderId ?? ""));
    if (row.paymentStatus !== "PAID") {
      return res.status(409).json({
        success: false,
        code: "PAYMENT_REQUIRED",
        message: "Print files are available after payment is confirmed.",
      });
    }
    const itemId = String(req.query.itemId ?? "").trim();
    const items = resolveOrderItemRows(row);
    const item = itemId ? items.find((i) => i.id === itemId) : items[0];
    if (!item?.product) {
      return res.status(404).json({ success: false, message: "Print item not found." });
    }
    const product = item.product;
    const address =
      product.supportsAddress && item.addressSnapshot && typeof item.addressSnapshot === "object"
        ? String((item.addressSnapshot as { line?: string }).line ?? "")
        : null;
    const printed = await renderPhysicalQrPrint({
      targetUrl: item.qrTargetUrlSnapshot,
      businessName: row.businessNameSnapshot,
      address,
      supportsAddress: product.supportsAddress,
      colorTokens: (item.colorTokensSnapshot ?? {}) as {
        backgroundGradientStart: string;
        backgroundGradientEnd: string;
        primaryTextColor: string;
        secondaryTextColor: string;
      },
    });
    const copies = Math.min(
      PHYSICAL_QR_QUANTITY_MAX,
      Math.max(PHYSICAL_QR_QUANTITY_MIN, Number.isInteger(item.quantity) ? item.quantity : 1),
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
    return mapErr(res, err, "physicalQr.print");
  }
}

export async function quoteMyPhysicalQrCart(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const result = await quotePhysicalQrCartForBusiness({
      businessId: auth.businessId,
      lineItems: req.body?.lineItems,
    });
    return res.json(result);
  } catch (err) {
    return mapErr(res, err, "physicalQr.quote");
  }
}

export async function createMyPhysicalQrBatch(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const order = await createPhysicalQrBatchOrders({
      businessId: auth.businessId,
      userId: auth.userId,
      lineItems: req.body?.lineItems,
      address: req.body?.address,
      shipping: req.body?.shipping,
      contact: req.body?.contact,
      colorTokens: req.body?.colorTokens,
    });
    return res.status(201).json({ order: toCustomerOrderDto(order) });
  } catch (err) {
    return mapErr(res, err, "physicalQr.createBatch");
  }
}

export async function checkoutMyPhysicalQrBatch(req: Request, res: Response) {
  try {
    const auth = await requireManagerBusiness(req, res);
    if (!auth) return;
    const orderId =
      String(req.body?.orderId ?? "").trim() ||
      (Array.isArray(req.body?.orderIds) ? String(req.body.orderIds[0] ?? "").trim() : "");
    const result = await createPhysicalQrBatchCheckoutSession({
      businessId: auth.businessId,
      userId: auth.userId,
      orderId,
    });
    return res.json(result);
  } catch (err) {
    return mapErr(res, err, "physicalQr.batchCheckout");
  }
}

export async function patchMyPhysicalQrOrder(_req: Request, res: Response) {
  return res.status(403).json({
    success: false,
    code: "CUSTOMER_CANNOT_MODIFY_FULFILLMENT",
    message: "Customers cannot change fulfillment status.",
  });
}
