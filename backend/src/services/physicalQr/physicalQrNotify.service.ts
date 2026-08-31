import { prisma } from "../../prisma.js";
import { deliverUserNotification } from "../notifications/notificationOrchestrator.service.js";
import { NotificationType } from "../push/notification.types.js";
import type { NotificationTemplate } from "../../notifications/notificationI18n.js";
import { onPlatformOperationalAlert } from "../push/notification.triggers.js";

function orderUrl(orderId: string): string {
  return `/dashboard/qr-studio/branding/orders/${encodeURIComponent(orderId)}`;
}

function adminOrderUrl(orderId: string): string {
  return `/platform-admin/branding-orders/${encodeURIComponent(orderId)}`;
}

/** Pro included printing → €0 total; Basic paid orders have a positive total. */
function isIncludedPhysicalQrOrder(totalAmount: number | null | undefined): boolean {
  return (Number(totalAmount) || 0) <= 0;
}

async function managerUserIdForBusiness(businessId: string): Promise<string | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { userId: true },
  });
  return business?.userId ?? null;
}

async function notifyBusinessOrder(input: {
  businessId: string;
  orderId: string;
  title: string;
  body: string;
  template: NotificationTemplate;
  dedupeKey: string;
  email: boolean;
}): Promise<void> {
  const userId = await managerUserIdForBusiness(input.businessId);
  if (!userId) return;
  await deliverUserNotification({
    userId,
    payload: {
      type: NotificationType.SYSTEM_ALERT,
      title: input.title,
      body: input.body,
      localeTemplate: input.template,
      url: orderUrl(input.orderId),
      timestamp: new Date().toISOString(),
      metadata: {
        entityId: input.orderId,
        orderId: input.orderId,
        businessId: input.businessId,
        source: "physical_qr_order",
      },
    },
    channels: { in_app: true, push: true, email: input.email },
    dedupeKey: input.dedupeKey,
  });
}

async function loadPaidOrderForNotify(input: { businessId: string; orderId: string }) {
  const order = await prisma.physicalQrOrder.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      businessId: true,
      quantity: true,
      totalAmount: true,
      currency: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      paidAt: true,
      product: { select: { name: true } },
      business: { select: { name: true, brandDisplayName: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: { labelSnapshot: true, quantity: true },
      },
    },
  });
  if (!order || order.businessId !== input.businessId) return null;
  if (order.paymentStatus !== "PAID") return null;
  return order;
}

async function notifyPlatformAdminPhysicalQrOrder(input: {
  businessId: string;
  orderId: string;
}): Promise<void> {
  const order = await loadPaidOrderForNotify(input);
  if (!order) return;

  const businessName =
    order.business?.brandDisplayName?.trim() || order.business?.name || "A business";
  const productLabel = order.product?.name ?? "Physical QR order";
  const eventAtIso = order.paidAt?.toISOString() ?? new Date().toISOString();
  const itemRows =
    order.items.length > 0
      ? order.items
      : [{ labelSnapshot: productLabel, quantity: order.quantity }];
  const itemLineCount = itemRows.length;
  const lineItemsSummary = itemRows
    .map((item) => `${item.labelSnapshot} × ${item.quantity}`)
    .join("; ");
  const included = isIncludedPhysicalQrOrder(order.totalAmount);

  if (included) {
    onPlatformOperationalAlert({
      title: "Physical QR order received",
      body: `${businessName} placed a physical QR order (included in plan).`,
      url: adminOrderUrl(input.orderId),
      entityId: input.orderId,
      localeTemplate: {
        id: "physical_qr_order_received_admin",
        params: {
          businessName,
          orderId: input.orderId,
          productLabel,
          quantity: order.quantity,
          itemLineCount,
          lineItemsSummary,
          currency: order.currency,
          receivedAtIso: eventAtIso,
        },
      },
      metadata: {
        source: "physical_qr_order",
        orderId: input.orderId,
        businessId: input.businessId,
      },
      channels: { in_app: true, push: true, email: true },
    });
    return;
  }

  onPlatformOperationalAlert({
    title: "Physical QR order paid",
    body: `${businessName} paid for a physical QR order.`,
    url: adminOrderUrl(input.orderId),
    entityId: input.orderId,
    localeTemplate: {
      id: "physical_qr_paid_admin",
      params: {
        businessName,
        orderId: input.orderId,
        productLabel,
        quantity: order.quantity,
        itemLineCount,
        lineItemsSummary,
        totalAmountCents: order.totalAmount,
        currency: order.currency,
        paidAtIso: eventAtIso,
      },
    },
    metadata: {
      source: "physical_qr_order",
      orderId: input.orderId,
      businessId: input.businessId,
    },
    channels: { in_app: true, push: true, email: true },
  });
}

/**
 * Business + admin alerts when an order becomes PAID.
 * Pro (€0 / included) → "Order received"; Basic (paid) → "Payment received".
 */
export function notifyPhysicalQrPaymentReceived(input: { businessId: string; orderId: string }): void {
  void (async () => {
    const order = await prisma.physicalQrOrder.findUnique({
      where: { id: input.orderId },
      select: { businessId: true, totalAmount: true, paymentStatus: true },
    });
    if (!order || order.businessId !== input.businessId) return;
    if (order.paymentStatus !== "PAID") return;

    const included = isIncludedPhysicalQrOrder(order.totalAmount);
    await notifyBusinessOrder({
      ...input,
      title: included ? "Order received" : "Payment received",
      body: included
        ? "Your physical QR order has been received and is now being processed."
        : "Your physical QR order has been paid for and is now being processed.",
      template: included ? { id: "physical_qr_order_received" } : { id: "physical_qr_paid" },
      // Shared dedupe key so Pro/Basic never double-fire for the same order lifecycle event.
      dedupeKey: `physical-qr:${input.orderId}:paid`,
      email: true,
    });

    await notifyPlatformAdminPhysicalQrOrder(input);
  })().catch(() => undefined);
}

export function notifyPhysicalQrPrinting(input: { businessId: string; orderId: string }): void {
  void notifyBusinessOrder({
    ...input,
    title: "Printing",
    body: "Your physical QR order is now being printed.",
    template: { id: "physical_qr_printing" },
    dedupeKey: `physical-qr:${input.orderId}:printing`,
    email: true,
  }).catch(() => undefined);
}

export function notifyPhysicalQrShipped(input: {
  businessId: string;
  orderId: string;
  trackingNumber: string | null;
}): void {
  const tracking = input.trackingNumber?.trim() || "";
  void notifyBusinessOrder({
    ...input,
    title: "Shipped",
    body: tracking
      ? `Your physical QR order has been shipped. Tracking number: ${tracking}`
      : "Your physical QR order has been shipped.",
    template: { id: "physical_qr_shipped", params: { trackingNumber: tracking || null } },
    dedupeKey: `physical-qr:${input.orderId}:shipped`,
    email: true,
  }).catch(() => undefined);
}

export function notifyPhysicalQrDelivered(input: { businessId: string; orderId: string }): void {
  void notifyBusinessOrder({
    ...input,
    title: "Delivered",
    body: "Your physical QR order has been delivered.",
    template: { id: "physical_qr_delivered" },
    dedupeKey: `physical-qr:${input.orderId}:delivered`,
    email: true,
  }).catch(() => undefined);
}
