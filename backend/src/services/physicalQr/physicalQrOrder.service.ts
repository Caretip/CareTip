import { prisma } from "../../prisma.js";
import { hasFeature } from "../subscriptionEntitlement.service.js";
import { assertPhysicalQrColorTokens, PhysicalQrColorError } from "../../lib/physicalQr/colors.js";
import { freezePhysicalQrProcessing } from "../../lib/physicalQr/processing.js";
import {
  parsePhysicalQrContactSnapshot,
  parsePhysicalQrShippingSnapshot,
  PhysicalQrShippingError,
} from "../../lib/physicalQr/shipping.js";
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
import {
  allocateQuoteAcrossQuantities,
  isPhysicalQrFreeOrderAvailable,
  isPhysicalQrPrintingIncludedEligible,
  persistPhysicalQrAlbertinaOrderColumns,
  quotePhysicalQrPrints,
  readPhysicalQrQuotaState,
  releasePhysicalQrMonthlyFreeOrderClaim,
  resolvePhysicalQrCheckoutQuote,
  tryClaimPhysicalQrMonthlyFreeOrder,
  type PhysicalQrQuote,
} from "./physicalQrPricing.service.js";
import {
  derivePrimaryLocationId,
  listBusinessLocationsForPrint,
  resolvePhysicalQrContext,
} from "./qrContext.service.js";

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
  shipping?: unknown;
  contact?: unknown;
  colorTokens?: unknown;
  /** Ignored — never trusted from the client. */
  unitPrice?: unknown;
  totalAmount?: unknown;
  businessIdClient?: unknown;
  paymentStatus?: unknown;
  fulfillmentStatus?: unknown;
  qrTargetUrl?: unknown;
};

export type PhysicalQrBatchLineInput = {
  productId: unknown;
  qrContextType: unknown;
  qrSubjectId?: unknown;
  quantity?: unknown;
};

export type CreatePhysicalQrCartInput = {
  businessId: string;
  userId: string;
  lineItems: PhysicalQrBatchLineInput[];
  address?: unknown;
  shipping?: unknown;
  contact?: unknown;
  colorTokens?: unknown;
};

const ORDER_INCLUDE = {
  product: true,
  items: { include: { product: true }, orderBy: { createdAt: "asc" as const } },
} as const;

export type PhysicalQrOrderRecord = Awaited<ReturnType<typeof getPhysicalQrOrderForBusiness>>;

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

function parseLineItems(raw: unknown): PhysicalQrBatchLineInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PhysicalQrOrderError("LINE_ITEMS_REQUIRED", "Add at least one QR code to your order.", 400);
  }
  if (raw.length > 20) {
    throw new PhysicalQrOrderError("LINE_ITEMS_LIMIT", "You can order up to 20 QR codes per checkout.", 400);
  }
  return raw as PhysicalQrBatchLineInput[];
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

type PreparedLine = {
  product: Awaited<ReturnType<typeof getPhysicalQrProductOrThrow>>;
  qr: Awaited<ReturnType<typeof resolvePhysicalQrContext>>;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  addressSnapshot: PhysicalQrAddressSnapshot | null;
  colorTokens: PhysicalQrColorTokens;
};

async function prepareLine(
  businessId: string,
  line: PhysicalQrBatchLineInput,
  shared: {
    registeredAddress: string | null;
    clientAddress: unknown;
    colorTokens: PhysicalQrColorTokens;
    locations: Array<{ id: string; name: string }>;
    productsById: Map<string, Awaited<ReturnType<typeof getPhysicalQrProductOrThrow>>>;
  },
): Promise<PreparedLine> {
  const productId = String(line.productId ?? "").trim();
  if (!productId) {
    throw new PhysicalQrOrderError("PRODUCT_REQUIRED", "Product is required");
  }
  let product = shared.productsById.get(productId);
  if (!product) {
    product = await getPhysicalQrProductOrThrow(productId);
    shared.productsById.set(productId, product);
  }
  try {
    assertPhysicalQrCheckoutReady(product);
  } catch (err) {
    if (err instanceof PhysicalQrCheckoutBlockedError) {
      throw new PhysicalQrOrderError(err.code, err.message, 409);
    }
    throw err;
  }

  const quantity = parseQuantity(line.quantity ?? 1);
  const qr = await resolvePhysicalQrContext({
    businessId,
    qrContextType: line.qrContextType,
    qrSubjectId: line.qrSubjectId,
    locations: shared.locations,
  });
  const addressSnapshot = parseAddressSnapshot({
    supportsAddress: product.supportsAddress,
    registeredAddress: shared.registeredAddress,
    clientAddress: shared.clientAddress,
  });

  return {
    product,
    qr,
    quantity,
    unitPrice: 0,
    totalAmount: 0,
    addressSnapshot,
    colorTokens: shared.colorTokens,
  };
}

function assertBasicSingleLocation(input: {
  printingIncludedEligible: boolean;
  primaryLocationId: string | null;
  locationIds: Array<string | null>;
}): void {
  if (input.printingIncludedEligible) return;
  const normalized = input.locationIds.map((id) => id || input.primaryLocationId);
  const unique = [...new Set(normalized.filter((id): id is string => Boolean(id)))];
  if (unique.length <= 1) {
    if (unique.length === 1 && input.primaryLocationId && unique[0] !== input.primaryLocationId) {
      throw new PhysicalQrOrderError(
        "BASIC_PRIMARY_LOCATION_REQUIRED",
        "Basic plans can only order QR codes from the primary location.",
        403,
      );
    }
    return;
  }
  throw new PhysicalQrOrderError(
    "BASIC_SINGLE_LOCATION_REQUIRED",
    "Basic plans can only order QR codes from one primary location. Upgrade to Pro to combine locations.",
    403,
  );
}

export async function quotePhysicalQrCartForBusiness(input: {
  businessId: string;
  lineItems: PhysicalQrBatchLineInput[];
}): Promise<{
  quote: PhysicalQrQuote;
  printCount: number;
  locationIds: Array<string | null>;
  freeOrderAvailable: boolean;
  primaryLocationId: string | null;
}> {
  const lines = parseLineItems(input.lineItems);
  const locations = await listBusinessLocationsForPrint(input.businessId);
  const primaryLocationId = derivePrimaryLocationId(locations);
  const [printingIncludedEligible, freeOrderAvailable] = await Promise.all([
    isPhysicalQrPrintingIncludedEligible(input.businessId),
    isPhysicalQrFreeOrderAvailable(input.businessId),
  ]);
  const resolved = await Promise.all(
    lines.map((line) =>
      resolvePhysicalQrContext({
        businessId: input.businessId,
        qrContextType: line.qrContextType,
        qrSubjectId: line.qrSubjectId,
        locations,
      }),
    ),
  );
  const locationIds = resolved.map((qr) => qr.locationId);
  assertBasicSingleLocation({ printingIncludedEligible, primaryLocationId, locationIds });
  const printCount = lines.reduce((sum, line) => sum + parseQuantity(line.quantity ?? 1), 0);
  const quote = quotePhysicalQrPrints({
    printCount,
    printingIncludedEligible,
    freeOrderAvailable,
  });
  return { quote, printCount, locationIds, freeOrderAvailable, primaryLocationId };
}

export async function createPhysicalQrCartOrder(input: CreatePhysicalQrCartInput) {
  if (!(await hasFeature(input.businessId, "physicalQrPrinting"))) {
    throw new PhysicalQrOrderError(
      "SUBSCRIPTION_REQUIRED",
      "Physical QR printing requires an active subscription.",
      403,
    );
  }

  const lines = parseLineItems(input.lineItems);
  const colorTokens = assertPhysicalQrColorTokens(
    (input.colorTokens ?? {}) as PhysicalQrColorTokens,
  );

  const [business, user, locations] = await Promise.all([
    prisma.business.findUnique({
      where: { id: input.businessId },
      select: {
        id: true,
        name: true,
        brandDisplayName: true,
        registeredAddress: true,
        legalContactName: true,
        contactEmail: true,
        contactPhone: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    }),
    listBusinessLocationsForPrint(input.businessId),
  ]);
  if (!business) {
    throw new PhysicalQrOrderError("BUSINESS_NOT_FOUND", "Business not found", 404);
  }

  let shippingSnapshot;
  let contactSnapshot;
  try {
    shippingSnapshot = parsePhysicalQrShippingSnapshot(input.shipping);
    contactSnapshot = parsePhysicalQrContactSnapshot(input.contact, {
      name: business.legalContactName,
      email: business.contactEmail || user?.email,
      phone: business.contactPhone,
    });
  } catch (err) {
    if (err instanceof PhysicalQrShippingError) {
      throw new PhysicalQrOrderError(err.code, err.message);
    }
    throw err;
  }

  const productsById = new Map<string, Awaited<ReturnType<typeof getPhysicalQrProductOrThrow>>>();
  const prepared = await Promise.all(
    lines.map((line) =>
      prepareLine(input.businessId, line, {
        registeredAddress: business.registeredAddress,
        clientAddress: input.address,
        colorTokens,
        locations,
        productsById,
      }),
    ),
  );

  const primaryLocationId = derivePrimaryLocationId(locations);
  const [printingIncludedEligible, freeOrderAvailable] = await Promise.all([
    isPhysicalQrPrintingIncludedEligible(input.businessId),
    isPhysicalQrFreeOrderAvailable(input.businessId),
  ]);
  assertBasicSingleLocation({
    printingIncludedEligible,
    primaryLocationId,
    locationIds: prepared.map((line) => line.qr.locationId),
  });

  const orderQuantity = prepared.reduce((sum, line) => sum + line.quantity, 0);
  const quote = quotePhysicalQrPrints({
    printCount: orderQuantity,
    printingIncludedEligible,
    freeOrderAvailable,
  });
  const lineTotals = allocateQuoteAcrossQuantities(
    quote,
    prepared.map((line) => line.quantity),
  );
  prepared.forEach((line, i) => {
    line.totalAmount = lineTotals[i] ?? 0;
    line.unitPrice = line.quantity > 0 ? Math.round(line.totalAmount / line.quantity) : 0;
  });

  const placedAt = new Date();
  const processing = freezePhysicalQrProcessing(placedAt);
  const businessName = business.brandDisplayName?.trim() || business.name;
  const currency = prepared[0]!.product.currency;
  const first = prepared[0]!;

  const created = await prisma.physicalQrOrder.create({
    data: {
      businessId: input.businessId,
      userId: input.userId,
      productId: first.product.id,
      qrContextType: first.qr.qrContextType,
      qrSubjectId: first.qr.qrSubjectId,
      qrTargetUrlSnapshot: first.qr.qrTargetUrl,
      quantity: orderQuantity,
      unitPrice: first.unitPrice,
      totalAmount: quote.totalCents,
      currency,
      placedAt,
      processingClass: processing.processingClass,
      processingDeadlineAt: processing.processingDeadlineAt,
      processingCopySnapshot: processing.processingCopySnapshot,
      addressSnapshot: first.addressSnapshot as object | undefined,
      shippingSnapshot: shippingSnapshot as object,
      contactSnapshot: contactSnapshot as object,
      colorTokensSnapshot: colorTokens as object,
      businessNameSnapshot: businessName,
      paymentStatus: "PENDING",
      fulfillmentStatus: "PENDING_PAYMENT",
      items: {
        create: prepared.map((line) => ({
          productId: line.product.id,
          qrContextType: line.qr.qrContextType,
          qrSubjectId: line.qr.qrSubjectId,
          qrTargetUrlSnapshot: line.qr.qrTargetUrl,
          labelSnapshot: line.qr.label.slice(0, 200),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalAmount: line.totalAmount,
          addressSnapshot: line.addressSnapshot as object | undefined,
          colorTokensSnapshot: line.colorTokens as object,
        })),
      },
    },
    include: ORDER_INCLUDE,
  });
  // Preview snapshot may include freeOrderApplied (eligibility). Omit a claim
  // timestamp here so the monthly quota is not marked consumed at create time.
  await persistPhysicalQrAlbertinaOrderColumns({
    orderId: created.id,
    quote,
    items: prepared.map((line) => ({
      qrTargetUrl: line.qr.qrTargetUrl,
      locationId: line.qr.locationId,
      locationName: line.qr.locationName,
    })),
  });
  return {
    ...created,
    pricingSnapshot: quote,
    monthlyFreeQuotaApplied: false,
    items: created.items.map((item) => {
      const line = prepared.find((p) => p.qr.qrTargetUrl === item.qrTargetUrlSnapshot);
      return {
        ...item,
        locationId: line?.qr.locationId ?? null,
        locationNameSnapshot: line?.qr.locationName ?? null,
      };
    }),
  };
}

export async function createPhysicalQrOrder(input: CreatePhysicalQrOrderInput) {
  return createPhysicalQrCartOrder({
    businessId: input.businessId,
    userId: input.userId,
    lineItems: [
      {
        productId: input.productId,
        qrContextType: input.qrContextType,
        qrSubjectId: input.qrSubjectId,
        quantity: input.quantity,
      },
    ],
    address: input.address,
    shipping: input.shipping,
    contact: input.contact,
    colorTokens: input.colorTokens,
  });
}

export async function listPhysicalQrOrdersForBusiness(businessId: string) {
  return prisma.physicalQrOrder.findMany({
    where: { businessId },
    include: ORDER_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getPhysicalQrOrderForBusiness(businessId: string, orderId: string) {
  const row = await prisma.physicalQrOrder.findFirst({
    where: { id: orderId, businessId },
    include: ORDER_INCLUDE,
  });
  if (!row) {
    throw new PhysicalQrOrderError("ORDER_NOT_FOUND", "Order not found", 404);
  }
  return row;
}

export async function lockQuoteForPhysicalQrCheckout(input: {
  businessId: string;
  orderId: string;
  printCount: number;
}): Promise<{
  quote: PhysicalQrQuote;
  claimedAt: Date | null;
  previousUsedAt: Date | null;
  quotaClaimedAt: Date | null;
}> {
  const order = await prisma.physicalQrOrder.findFirst({
    where: { id: input.orderId, businessId: input.businessId },
    select: {
      paymentStatus: true,
      monthlyFreeQuotaApplied: true,
      pricingSnapshot: true,
    },
  });
  if (!order) {
    throw new PhysicalQrOrderError("ORDER_NOT_FOUND", "Order not found", 404);
  }
  if (order.paymentStatus !== "PENDING") {
    throw new PhysicalQrOrderError("ORDER_NOT_CHECKOUTABLE", "This order cannot be paid.", 409);
  }

  const quota = await readPhysicalQrQuotaState(input.businessId);
  if (!quota) {
    throw new PhysicalQrOrderError("BUSINESS_NOT_FOUND", "Business not found", 404);
  }
  const [printingIncludedEligible, freeOrderAvailable] = await Promise.all([
    isPhysicalQrPrintingIncludedEligible(input.businessId),
    isPhysicalQrFreeOrderAvailable(input.businessId),
  ]);
  const resolved = resolvePhysicalQrCheckoutQuote({
    printCount: input.printCount,
    printingIncludedEligible,
    freeOrderAvailable,
    orderMonthlyFreeQuotaApplied: order.monthlyFreeQuotaApplied,
    storedQuote: order.pricingSnapshot,
  });

  if (resolved.reuseStoredFreeQuote) {
    const quotaClaimedAt = resolved.quotaClaimedAt;
    if (!quotaClaimedAt) {
      throw new PhysicalQrOrderError("ORDER_NOT_CHECKOUTABLE", "This order cannot be paid.", 409);
    }
    await prisma.physicalQrOrder.update({
      where: { id: input.orderId },
      data: { totalAmount: resolved.quote.totalCents },
    });
    await persistPhysicalQrAlbertinaOrderColumns({
      orderId: input.orderId,
      quote: resolved.quote,
      quotaClaimedAt,
    });
    return {
      quote: resolved.quote,
      claimedAt: null,
      previousUsedAt: quota.usedAt,
      quotaClaimedAt,
    };
  }

  const quote = resolved.quote;
  let claimedAt: Date | null = null;
  const previousUsedAt = quota.usedAt;

  if (quote.freeOrderApplied) {
    const claim = await tryClaimPhysicalQrMonthlyFreeOrder({
      businessId: input.businessId,
      timezone: quota.timezone,
    });
    if (!claim.claimed) {
      throw new PhysicalQrOrderError(
        "QUOTA_CHANGED",
        "The monthly free print order was just used in another session. Refresh to see regular pricing.",
        409,
      );
    }
    claimedAt = claim.claimedAt;
  }

  await prisma.physicalQrOrder.update({
    where: { id: input.orderId },
    data: {
      totalAmount: quote.totalCents,
    },
  });
  await persistPhysicalQrAlbertinaOrderColumns({
    orderId: input.orderId,
    quote,
    quotaClaimedAt: claimedAt,
  });

  return { quote, claimedAt, previousUsedAt, quotaClaimedAt: claimedAt };
}

export { releasePhysicalQrMonthlyFreeOrderClaim };

export type PhysicalQrOrderLineProduct = {
  name: string;
  supportsAddress: boolean;
  templateId: string;
  priceCents: number | null;
  orderable: boolean;
  currency: string;
};

export function resolveOrderItemRows(row: {
  id: string;
  productId: string | null;
  product?: PhysicalQrOrderLineProduct | null;
  qrContextType: PhysicalQrContextType | string | null;
  qrSubjectId: string | null;
  qrTargetUrlSnapshot?: string | null;
  quantity: number;
  unitPrice?: number;
  totalAmount: number;
  addressSnapshot: unknown;
  colorTokensSnapshot: unknown;
  items?: Array<{
    id: string;
    productId: string;
    product?: PhysicalQrOrderLineProduct | null;
    qrContextType: PhysicalQrContextType | string;
    qrSubjectId: string | null;
    qrTargetUrlSnapshot: string;
    labelSnapshot: string;
    locationId?: string | null;
    locationNameSnapshot?: string | null;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    addressSnapshot: unknown;
    colorTokensSnapshot: unknown;
  }>;
}) {
  if (row.items?.length) return row.items;
  if (row.productId && row.qrContextType && row.qrTargetUrlSnapshot) {
    return [
      {
        id: `${row.id}-legacy`,
        productId: row.productId,
        product: row.product ?? undefined,
        qrContextType: row.qrContextType,
        qrSubjectId: row.qrSubjectId,
        qrTargetUrlSnapshot: row.qrTargetUrlSnapshot,
        labelSnapshot: row.product?.name ?? "QR",
        quantity: row.quantity,
        unitPrice: row.unitPrice ?? 0,
        totalAmount: row.totalAmount,
        addressSnapshot: row.addressSnapshot,
        colorTokensSnapshot: row.colorTokensSnapshot,
      },
    ];
  }
  return [];
}

export function toOrderItemDto(item: {
  id: string;
  productId: string;
  product?: PhysicalQrOrderLineProduct | null;
  qrContextType: PhysicalQrContextType | string;
  qrSubjectId: string | null;
  qrTargetUrlSnapshot: string;
  labelSnapshot: string;
  locationId?: string | null;
  locationNameSnapshot?: string | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  addressSnapshot: unknown;
  colorTokensSnapshot: unknown;
}) {
  return {
    id: item.id,
    productId: item.productId,
    productName: item.product?.name ?? null,
    templateId: item.product?.templateId ?? null,
    supportsAddress: item.product?.supportsAddress ?? false,
    qrContextType: item.qrContextType,
    qrSubjectId: item.qrSubjectId,
    label: item.labelSnapshot,
    locationId: item.locationId ?? null,
    locationName: item.locationNameSnapshot ?? null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalAmount: item.totalAmount,
    addressSnapshot: item.addressSnapshot ?? null,
    colorTokensSnapshot: item.colorTokensSnapshot ?? null,
  };
}

export function toCustomerOrderDto(row: PhysicalQrOrderRecord) {
  const items = resolveOrderItemRows(row).map(toOrderItemDto);
  const first = items[0];
  const itemCount = items.length;
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    id: row.id,
    productId: first?.productId ?? row.productId ?? "",
    productName: first?.productName ?? row.product?.name ?? null,
    templateId: first?.templateId ?? row.product?.templateId ?? null,
    supportsAddress: first?.supportsAddress ?? row.product?.supportsAddress ?? false,
    qrContextType: first?.qrContextType ?? row.qrContextType ?? "storefront",
    qrSubjectId: first?.qrSubjectId ?? row.qrSubjectId ?? null,
    quantity: totalQuantity,
    itemCount,
    items,
    currency: row.currency,
    unitPrice: row.unitPrice,
    totalAmount: row.totalAmount,
    pricing: row.pricingSnapshot ?? null,
    monthlyFreeQuotaApplied: row.monthlyFreeQuotaApplied ?? false,
    placedAt: row.placedAt.toISOString(),
    processingClass: row.processingClass,
    processingDeadlineAt: row.processingDeadlineAt.toISOString(),
    processingCopySnapshot: row.processingCopySnapshot,
    addressSnapshot: first?.addressSnapshot ?? row.addressSnapshot ?? null,
    shippingSnapshot: row.shippingSnapshot ?? null,
    contactSnapshot: row.contactSnapshot ?? null,
    colorTokensSnapshot: first?.colorTokensSnapshot ?? row.colorTokensSnapshot ?? null,
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
