import { prisma } from "../../prisma.js";
import { assertFulfillmentTransition } from "../../lib/physicalQr/status.js";
import type { PhysicalQrFulfillmentStatus } from "../../lib/physicalQr/types.js";
import { sanitizeLikeContainsSearch } from "../../utils/likeSearch.js";
import {
  notifyPhysicalQrDelivered,
  notifyPhysicalQrPrinting,
  notifyPhysicalQrShipped,
} from "./physicalQrNotify.service.js";

export class PhysicalQrFulfillmentError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const ADMIN_FILTERS: Record<string, { paymentStatus?: string; fulfillmentStatus?: string }> = {
  pending_payment: { fulfillmentStatus: "PENDING_PAYMENT" },
  paid: { paymentStatus: "PAID" },
  processing: { fulfillmentStatus: "PROCESSING" },
  printing: { fulfillmentStatus: "PRINTING" },
  shipped: { fulfillmentStatus: "SHIPPED" },
  delivered: { fulfillmentStatus: "DELIVERED" },
  cancelled: { fulfillmentStatus: "CANCELLED" },
  payment_failed: { fulfillmentStatus: "PAYMENT_FAILED" },
};

export async function listPhysicalQrOrdersForAdmin(opts: {
  filter?: string;
  q?: string;
  take?: number;
}) {
  const take = Math.min(Math.max(opts.take ?? 80, 1), 200);
  const filter = ADMIN_FILTERS[String(opts.filter ?? "").trim().toLowerCase()];
  const q = sanitizeLikeContainsSearch(opts.q);
  return prisma.physicalQrOrder.findMany({
    where: {
      ...(filter?.fulfillmentStatus
        ? { fulfillmentStatus: filter.fulfillmentStatus as PhysicalQrFulfillmentStatus }
        : {}),
      ...(filter?.paymentStatus ? { paymentStatus: filter.paymentStatus as "PAID" } : {}),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" } },
              { business: { name: { contains: q, mode: "insensitive" } } },
              { businessNameSnapshot: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      product: true,
      business: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { placedAt: "desc" },
    take,
  });
}

export async function getPhysicalQrOrderForAdmin(orderId: string) {
  const row = await prisma.physicalQrOrder.findUnique({
    where: { id: orderId },
    include: {
      product: true,
      business: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!row) {
    throw new PhysicalQrFulfillmentError("ORDER_NOT_FOUND", "Order not found", 404);
  }
  return row;
}

async function transitionOrder(
  orderId: string,
  to: PhysicalQrFulfillmentStatus,
  extra: Record<string, unknown> = {},
) {
  const order = await prisma.physicalQrOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new PhysicalQrFulfillmentError("ORDER_NOT_FOUND", "Order not found", 404);
  }
  assertFulfillmentTransition(order.fulfillmentStatus as PhysicalQrFulfillmentStatus, to);
  return prisma.physicalQrOrder.update({
    where: { id: order.id },
    data: { fulfillmentStatus: to, ...extra },
    include: {
      product: true,
      business: { select: { id: true, name: true, slug: true } },
    },
  });
}

export async function markPhysicalQrOrderProcessing(orderId: string) {
  const now = new Date();
  return transitionOrder(orderId, "PROCESSING", { processingAt: now });
}

export async function markPhysicalQrOrderPrinting(orderId: string) {
  const row = await transitionOrder(orderId, "PRINTING", { printingAt: new Date() });
  notifyPhysicalQrPrinting({ businessId: row.businessId, orderId: row.id });
  return row;
}

export async function shipPhysicalQrOrder(input: {
  orderId: string;
  carrier: unknown;
  trackingNumber: unknown;
  trackingUrl: unknown;
}) {
  const carrier = String(input.carrier ?? "").trim();
  const trackingNumber = String(input.trackingNumber ?? "").trim();
  const trackingUrl = String(input.trackingUrl ?? "").trim();
  if (!carrier || !trackingNumber) {
    throw new PhysicalQrFulfillmentError(
      "TRACKING_REQUIRED",
      "Carrier and tracking number are required to mark shipped.",
    );
  }
  const row = await transitionOrder(input.orderId, "SHIPPED", {
    carrier,
    trackingNumber,
    trackingUrl: trackingUrl || null,
    shippedAt: new Date(),
  });
  notifyPhysicalQrShipped({
    businessId: row.businessId,
    orderId: row.id,
    trackingNumber,
  });
  return row;
}

export async function deliverPhysicalQrOrder(orderId: string) {
  const row = await transitionOrder(orderId, "DELIVERED", { deliveredAt: new Date() });
  notifyPhysicalQrDelivered({ businessId: row.businessId, orderId: row.id });
  return row;
}

export function toAdminOrderDto(row: {
  id: string;
  businessId: string;
  business?: { id: string; name: string; slug: string };
  productId: string;
  product?: { name: string; supportsAddress?: boolean };
  qrContextType: string;
  qrSubjectId: string | null;
  quantity: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  paidAt?: Date | null;
  processingAt?: Date | null;
  printingAt?: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  placedAt: Date;
  updatedAt?: Date;
  currency: string;
  unitPrice?: number;
  totalAmount: number;
  processingClass?: string;
  processingCopySnapshot?: unknown;
  addressSnapshot?: unknown;
  shippingSnapshot?: unknown;
  contactSnapshot?: unknown;
  qrTargetUrlSnapshot?: string;
  stripePaymentIntentId?: string | null;
  businessNameSnapshot?: string;
  colorTokensSnapshot?: unknown;
  supportsAddress?: boolean;
}) {
  return {
    id: row.id,
    businessId: row.businessId,
    businessName: row.business?.name ?? row.businessNameSnapshot ?? null,
    businessSlug: row.business?.slug ?? null,
    productId: row.productId,
    productName: row.product?.name ?? null,
    supportsAddress: row.product?.supportsAddress ?? false,
    qrContextType: row.qrContextType,
    qrSubjectId: row.qrSubjectId,
    quantity: row.quantity,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    paidAt: row.paidAt?.toISOString() ?? null,
    processingAt: row.processingAt?.toISOString() ?? null,
    printingAt: row.printingAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    placedAt: row.placedAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
    currency: row.currency,
    unitPrice: row.unitPrice ?? row.totalAmount,
    totalAmount: row.totalAmount,
    processingClass: row.processingClass ?? null,
    processingCopySnapshot: row.processingCopySnapshot ?? null,
    addressSnapshot: row.addressSnapshot ?? null,
    shippingSnapshot: row.shippingSnapshot ?? null,
    contactSnapshot: row.contactSnapshot ?? null,
    qrTargetUrlSnapshot: row.qrTargetUrlSnapshot ?? null,
    stripePaymentIntentId: row.stripePaymentIntentId ?? null,
    businessNameSnapshot: row.businessNameSnapshot ?? null,
    colorTokensSnapshot: row.colorTokensSnapshot ?? null,
  };
}
