import { prisma } from "../../prisma.js";
import { hasFeature } from "../subscriptionEntitlement.service.js";
import { assertPhysicalQrColorTokens, PhysicalQrColorError } from "../../lib/physicalQr/colors.js";
import { freezePhysicalQrProcessing } from "../../lib/physicalQr/processing.js";
import {
  PHYSICAL_QR_QUANTITY_MAX,
  PHYSICAL_QR_QUANTITY_MIN,
  type PhysicalQrAddressSnapshot,
  type PhysicalQrColorTokens,
  type PhysicalQrContextType,
} from "../../lib/physicalQr/types.js";
import { orderCanPay } from "../../lib/physicalQr/status.js";
import {
  assertPhysicalQrCheckoutReady,
  PhysicalQrCheckoutBlockedError,
} from "../../config/physicalQrCheckout.js";
import { getPhysicalQrProductOrThrow } from "./physicalQrCatalog.service.js";
import { resolvePhysicalQrContext } from "./qrContext.service.js";

export class PhysicalQrOrderError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type CreatePhysicalQrOrderInput = {
  businessId: string;
  userId: string;
  productId: unknown;
  qrContextType: unknown;
  qrSubjectId?: unknown;
  quantity?: unknown;
  address?: unknown;
  colorTokens?: unknown;
  /** Ignored — never trusted from the client. */
  unitPrice?: unknown;
  totalAmount?: unknown;
  businessIdClient?: unknown;
  paymentStatus?: unknown;
  fulfillmentStatus?: unknown;
  qrTargetUrl?: unknown;
};

function parseQuantity(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw ?? 1);
  if (!Number.isInteger(n) || n < PHYSICAL_QR_QUANTITY_MIN || n > PHYSICAL_QR_QUANTITY_MAX) {
    throw new PhysicalQrOrderError(
      "INVALID_QUANTITY",
      `Quantity must be an integer from ${PHYSICAL_QR_QUANTITY_MIN} to ${PHYSICAL_QR_QUANTITY_MAX}.`,
    );
  }
  return n;
}

function parseAddressSnapshot(input: {
  supportsAddress: boolean;
  registeredAddress: string | null;
  clientAddress: unknown;
}): PhysicalQrAddressSnapshot | null {
  if (!input.supportsAddress) return null;
  const edited = typeof input.clientAddress === "string" ? input.clientAddress.trim() : "";
  if (edited) {
    return { line: edited.slice(0, 500), source: "order_edit" };
  }
  const registered = input.registeredAddress?.trim() || "";
  if (!registered) {
    throw new PhysicalQrOrderError(
      "ADDRESS_REQUIRED",
      "An address is required for this product.",
    );
  }
  return { line: registered.slice(0, 500), source: "registered" };
}

export async function createPhysicalQrOrder(input: CreatePhysicalQrOrderInput) {
  // Client-supplied price/status/businessId/QR URL are ignored. Server values are authoritative.
  if (!(await hasFeature(input.businessId, "brandingCustomization"))) {
    throw new PhysicalQrOrderError(
      "SUBSCRIPTION_REQUIRED",
      "Physical Branding ordering requires Premium or Enterprise.",
      403,
    );
  }

  const productId = String(input.productId ?? "").trim();
  if (!productId) {
    throw new PhysicalQrOrderError("PRODUCT_REQUIRED", "Product is required");
  }
  const product = await getPhysicalQrProductOrThrow(productId);

  try {
    assertPhysicalQrCheckoutReady(product);
  } catch (err) {
    if (err instanceof PhysicalQrCheckoutBlockedError) {
      throw new PhysicalQrOrderError(err.code, err.message, 409);
    }
    throw err;
  }

  const quantity = parseQuantity(input.quantity);
  const colorTokens = assertPhysicalQrColorTokens(
    (input.colorTokens ?? {}) as PhysicalQrColorTokens,
  );

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: {
      id: true,
      name: true,
      brandDisplayName: true,
      registeredAddress: true,
    },
  });
  if (!business) {
    throw new PhysicalQrOrderError("BUSINESS_NOT_FOUND", "Business not found", 404);
  }

  const qr = await resolvePhysicalQrContext({
    businessId: input.businessId,
    qrContextType: input.qrContextType,
    qrSubjectId: input.qrSubjectId,
  });

  const addressSnapshot = parseAddressSnapshot({
    supportsAddress: product.supportsAddress,
    registeredAddress: business.registeredAddress,
    clientAddress: input.address,
  });

  const placedAt = new Date();
  const processing = freezePhysicalQrProcessing(placedAt);
  const unitPrice = product.priceCents!;
  const totalAmount = unitPrice * quantity;
  const businessName = business.brandDisplayName?.trim() || business.name;

  return prisma.physicalQrOrder.create({
    data: {
      businessId: input.businessId,
      userId: input.userId,
      productId: product.id,
      qrContextType: qr.qrContextType,
      qrSubjectId: qr.qrSubjectId,
      qrTargetUrlSnapshot: qr.qrTargetUrl,
      quantity,
      unitPrice,
      totalAmount,
      currency: product.currency,
      placedAt,
      processingClass: processing.processingClass,
      processingDeadlineAt: processing.processingDeadlineAt,
      processingCopySnapshot: processing.processingCopySnapshot,
      addressSnapshot: addressSnapshot as object | undefined,
      colorTokensSnapshot: colorTokens as object,
      businessNameSnapshot: businessName,
      paymentStatus: "PENDING",
      fulfillmentStatus: "PENDING_PAYMENT",
    },
    include: { product: true },
  });
}

export async function listPhysicalQrOrdersForBusiness(businessId: string) {
  return prisma.physicalQrOrder.findMany({
    where: { businessId },
    include: { product: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getPhysicalQrOrderForBusiness(businessId: string, orderId: string) {
  const row = await prisma.physicalQrOrder.findFirst({
    where: { id: orderId, businessId },
    include: { product: true },
  });
  if (!row) {
    throw new PhysicalQrOrderError("ORDER_NOT_FOUND", "Order not found", 404);
  }
  return row;
}

export function toCustomerOrderDto(row: {
  id: string;
  productId: string;
  product?: { name: string; supportsAddress: boolean; templateId: string };
  qrContextType: PhysicalQrContextType | string;
  qrSubjectId: string | null;
  quantity: number;
  currency: string;
  placedAt: Date;
  processingClass: string;
  processingDeadlineAt: Date;
  processingCopySnapshot: unknown;
  addressSnapshot: unknown;
  colorTokensSnapshot?: unknown;
  businessNameSnapshot: string;
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
  priceCents?: never;
  unitPrice: number;
  totalAmount: number;
}) {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.product?.name ?? null,
    templateId: row.product?.templateId ?? null,
    supportsAddress: row.product?.supportsAddress ?? false,
    qrContextType: row.qrContextType,
    qrSubjectId: row.qrSubjectId,
    quantity: row.quantity,
    currency: row.currency,
    unitPrice: row.unitPrice,
    totalAmount: row.totalAmount,
    placedAt: row.placedAt.toISOString(),
    processingClass: row.processingClass,
    processingDeadlineAt: row.processingDeadlineAt.toISOString(),
    processingCopySnapshot: row.processingCopySnapshot,
    addressSnapshot: row.addressSnapshot,
    colorTokensSnapshot: row.colorTokensSnapshot ?? null,
    businessNameSnapshot: row.businessNameSnapshot,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    canPay: orderCanPay(row),
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    paidAt: row.paidAt?.toISOString() ?? null,
    processingAt: row.processingAt?.toISOString() ?? null,
    printingAt: row.printingAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    deliveryEstimateCopy: {
      en: "Estimated delivery: 24–72 hours after shipment.",
      de: "Voraussichtliche Lieferung: 24–72 Stunden nach Versand.",
    },
  };
}

export { PhysicalQrColorError };
