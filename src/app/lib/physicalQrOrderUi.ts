import type { TFunction } from "i18next";

export const PHYSICAL_QR_BERLIN_TZ = "Europe/Berlin";

export function physicalQrOrderNumber(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase() || id.slice(-8).toUpperCase();
}

export function formatBerlinDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat(locale.startsWith("de") ? "de-DE" : "en-GB", {
    timeZone: PHYSICAL_QR_BERLIN_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("day")} ${pick("month")} ${pick("year")} · ${pick("hour")}:${pick("minute")} Berlin`;
}

export function formatPhysicalQrMoney(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale.startsWith("de") ? "de-DE" : "en-GB", {
    style: "currency",
    currency: currency || "EUR",
  }).format(cents / 100);
}

export function physicalQrAddressLine(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const line = String((snapshot as { line?: unknown }).line ?? "").trim();
  return line || null;
}

export function physicalQrPaymentLabel(paymentStatus: string, t: TFunction): string {
  if (paymentStatus === "PAID") return t("business.qrStudio.physical.orders.paymentReceived");
  if (paymentStatus === "FAILED") return t("business.qrStudio.physical.orders.paymentFailed");
  if (paymentStatus === "CANCELLED") return t("business.qrStudio.physical.orders.cancelled");
  return t("business.qrStudio.physical.orders.paymentPending");
}

export function physicalQrFulfillmentLabel(fulfillmentStatus: string, t: TFunction): string {
  switch (fulfillmentStatus) {
    case "PENDING_PAYMENT":
      return t("business.qrStudio.physical.orders.paymentPending");
    case "PAID":
      return t("business.qrStudio.physical.orders.paymentReceived");
    case "PROCESSING":
      return t("business.qrStudio.physical.orders.processing");
    case "PRINTING":
      return t("business.qrStudio.physical.orders.beingPrinted");
    case "SHIPPED":
      return t("business.qrStudio.physical.orders.shipped");
    case "DELIVERED":
      return t("business.qrStudio.physical.orders.delivered");
    case "CANCELLED":
      return t("business.qrStudio.physical.orders.cancelled");
    case "PAYMENT_FAILED":
      return t("business.qrStudio.physical.orders.paymentFailed");
    default:
      return t("business.qrStudio.physical.orders.processing");
  }
}

export function physicalQrCustomerStatus(
  order: { paymentStatus: string; fulfillmentStatus: string },
  t: TFunction,
  confirming?: boolean,
): { title: string; detail: string | null } {
  if (confirming) {
    return {
      title: t("business.qrStudio.physical.orders.confirmingTitle"),
      detail: t("business.qrStudio.physical.orders.statusConfirmingDetail"),
    };
  }
  const payment = order.paymentStatus;
  const fulfillment = order.fulfillmentStatus;
  if (payment === "FAILED" || fulfillment === "PAYMENT_FAILED") {
    return {
      title: t("business.qrStudio.physical.orders.paymentFailed"),
      detail: t("business.qrStudio.physical.orders.statusFailedDetail"),
    };
  }
  if (payment === "CANCELLED" || fulfillment === "CANCELLED") {
    return { title: t("business.qrStudio.physical.orders.cancelled"), detail: null };
  }
  if (fulfillment === "PENDING_PAYMENT" || payment === "PENDING") {
    return {
      title: t("business.qrStudio.physical.orders.paymentPending"),
      detail: t("business.qrStudio.physical.orders.statusPendingDetail"),
    };
  }
  if (fulfillment === "DELIVERED") {
    return { title: t("business.qrStudio.physical.orders.delivered"), detail: null };
  }
  if (fulfillment === "SHIPPED") {
    return {
      title: t("business.qrStudio.physical.orders.shipped"),
      detail: t("business.qrStudio.physical.orders.statusShippedDetail"),
    };
  }
  if (fulfillment === "PRINTING") {
    return { title: t("business.qrStudio.physical.orders.beingPrinted"), detail: null };
  }
  return {
    title: t("business.qrStudio.physical.orders.paymentReceived"),
    detail: t("business.qrStudio.physical.orders.statusProcessingDetail"),
  };
}

export function physicalQrContextLabel(type: string, t: TFunction): string {
  const key = `business.qrStudio.gallery.assetType.${type}`;
  const translated = t(key);
  return translated === key ? type : translated;
}

export type PhysicalQrTimelineStepId =
  | "placed"
  | "paid"
  | "processing"
  | "printing"
  | "shipped"
  | "delivered";

export type PhysicalQrTimelineStep = {
  id: PhysicalQrTimelineStepId;
  label: string;
  at: string | null;
  done: boolean;
};

export function physicalQrTimeline(
  order: {
    placedAt: string;
    paidAt?: string | null;
    processingAt?: string | null;
    printingAt?: string | null;
    shippedAt?: string | null;
    deliveredAt?: string | null;
    paymentStatus: string;
    fulfillmentStatus: string;
  },
  t: TFunction,
): PhysicalQrTimelineStep[] {
  const rank: Record<string, number> = {
    PENDING_PAYMENT: 0,
    PAYMENT_FAILED: 0,
    CANCELLED: 0,
    PAID: 2,
    PROCESSING: 3,
    PRINTING: 4,
    SHIPPED: 5,
    DELIVERED: 6,
  };
  const current = rank[order.fulfillmentStatus] ?? 0;
  const paid = order.paymentStatus === "PAID" || Boolean(order.paidAt) || current >= 2;
  return [
    {
      id: "placed",
      label: t("business.qrStudio.physical.orders.stepPlaced"),
      at: order.placedAt,
      done: true,
    },
    {
      id: "paid",
      label: t("business.qrStudio.physical.orders.stepPaid"),
      at: order.paidAt ?? null,
      done: paid,
    },
    {
      id: "processing",
      label: t("business.qrStudio.physical.orders.stepProcessing"),
      at: order.processingAt ?? null,
      done: Boolean(order.processingAt) || current >= 3,
    },
    {
      id: "printing",
      label: t("business.qrStudio.physical.orders.stepPrinting"),
      at: order.printingAt ?? null,
      done: Boolean(order.printingAt) || current >= 4,
    },
    {
      id: "shipped",
      label: t("business.qrStudio.physical.orders.stepShipped"),
      at: order.shippedAt ?? null,
      done: Boolean(order.shippedAt) || current >= 5,
    },
    {
      id: "delivered",
      label: t("business.qrStudio.physical.orders.stepDelivered"),
      at: order.deliveredAt ?? null,
      done: Boolean(order.deliveredAt) || current >= 6,
    },
  ];
}

export function physicalQrCutoffLabel(processingClass: string | null | undefined, t: TFunction): string {
  if (processingClass === "SAME_DAY") return t("business.qrStudio.physical.orders.cutoffSameDay");
  return t("business.qrStudio.physical.orders.cutoffAfterNoon");
}

export function physicalQrEstimatedFulfillmentLabel(
  processingClass: string | null | undefined,
  t: TFunction,
): string {
  if (processingClass === "SAME_DAY") return t("business.qrStudio.physical.orders.estimatedSameDay");
  return t("business.qrStudio.physical.orders.estimatedNextWindow");
}
