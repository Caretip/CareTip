import { prisma } from "../../prisma.js";
import { deliverUserNotification } from "../notifications/notificationOrchestrator.service.js";
import { NotificationType } from "../push/notification.types.js";
import type { NotificationTemplate } from "../../notifications/notificationI18n.js";
import { onPlatformOperationalAlert } from "../push/notification.triggers.js";

function orderUrl(orderId: string): string {
  return `/dashboard/qr-studio/branding/orders/${encodeURIComponent(orderId)}`;
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

export function notifyPhysicalQrPaymentReceived(input: { businessId: string; orderId: string }): void {
  void notifyBusinessOrder({
    ...input,
    title: "Payment received",
    body: "Your physical QR order has been paid for and is now being processed.",
    template: { id: "physical_qr_paid" },
    dedupeKey: `physical-qr:${input.orderId}:paid`,
    email: true,
  }).catch(() => undefined);

  void prisma.business
    .findUnique({
      where: { id: input.businessId },
      select: { name: true, brandDisplayName: true },
    })
    .then((business) => {
      const businessName = business?.brandDisplayName?.trim() || business?.name || "A business";
      onPlatformOperationalAlert({
        title: "Physical QR order paid",
        body: `${businessName} paid for a physical QR order.`,
        url: `/platform-admin/businesses/branding-orders/${encodeURIComponent(input.orderId)}`,
        entityId: input.orderId,
        localeTemplate: {
          id: "physical_qr_paid_admin",
          params: { businessName, orderId: input.orderId },
        },
        metadata: {
          source: "physical_qr_order",
          orderId: input.orderId,
          businessId: input.businessId,
        },
      });
    })
    .catch(() => undefined);
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
