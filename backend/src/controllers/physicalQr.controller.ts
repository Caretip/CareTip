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
  toCustomerOrderDto,
} from "../services/physicalQr/physicalQrOrder.service.js";
import { createPhysicalQrCheckoutSession } from "../services/physicalQr/physicalQrCheckout.service.js";
import { PhysicalQrCheckoutBlockedError } from "../config/physicalQrCheckout.js";
import { renderPhysicalQrPrint } from "../lib/physicalQr/printPipeline.js";

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
    const format = String(req.query.format ?? "pdf").toLowerCase();
    if (format === "png") {
      res.setHeader("Content-Type", "image/png");
      return res.send(printed.png);
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="caretip-a5-${row.id}.pdf"`);
    return res.send(printed.pdf);
  } catch (err) {
    return mapErr(res, err, "physicalQr.print");
  }
}

export async function patchMyPhysicalQrOrder(_req: Request, res: Response) {
  return res.status(403).json({
    success: false,
    code: "CUSTOMER_CANNOT_MODIFY_FULFILLMENT",
    message: "Customers cannot change fulfillment status.",
  });
}
