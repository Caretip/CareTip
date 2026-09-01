import type { TFunction } from "i18next";

/** Matches backend `PHYSICAL_QR_QUANTITY_MIN/MAX` in physicalQr/types.ts */
export const PHYSICAL_QR_QUANTITY_MIN = 1;
export const PHYSICAL_QR_QUANTITY_MAX = 50;

export function clampPhysicalQrQuantity(raw: number): number {
  if (!Number.isFinite(raw)) return PHYSICAL_QR_QUANTITY_MIN;
  const n = Math.trunc(raw);
  return Math.min(PHYSICAL_QR_QUANTITY_MAX, Math.max(PHYSICAL_QR_QUANTITY_MIN, n));
}

export function groupPhysicalQrItemsByLocation<T extends { locationName?: string | null }>(
  items: T[],
  fallbackLabel = "Business",
): Array<{ locationName: string; items: T[] }> {
  const groups: Array<{ locationName: string; items: T[] }> = [];
  const indexByName = new Map<string, number>();
  for (const item of items) {
    const locationName = item.locationName?.trim() || fallbackLabel;
    const existing = indexByName.get(locationName);
    if (existing == null) {
      indexByName.set(locationName, groups.length);
      groups.push({ locationName, items: [item] });
    } else {
      groups[existing]!.items.push(item);
    }
  }
  return groups;
}

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

export const PHYSICAL_QR_SHIP_COUNTRY = "DE" as const;

export type PhysicalQrShippingSnapshot = {
  recipientName: string;
  streetLine: string;
  addressLine2?: string;
  postalCode: string;
  city: string;
  country: string;
};

export type PhysicalQrContactSnapshot = {
  name: string;
  email: string;
  phone: string;
};

export type PhysicalQrDeliveryForm = {
  recipientName: string;
  streetLine: string;
  addressLine2?: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function physicalQrDeliveryIsComplete(form: PhysicalQrDeliveryForm): boolean {
  const recipientName = form.recipientName.trim();
  const city = form.city.trim();
  const country = form.country.trim().toUpperCase();
  const email = form.email.trim();
  const phone = form.phone.trim();
  return (
    Boolean(recipientName) &&
    Boolean(city) &&
    country === PHYSICAL_QR_SHIP_COUNTRY &&
    EMAIL_RE.test(email) &&
    phone.replace(/\D/g, "").length >= 8
  );
}

export function physicalQrShippingFromUnknown(raw: unknown): PhysicalQrShippingSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const recipientName = String(value.recipientName ?? "").trim();
  const streetLine = String(value.streetLine ?? "").trim();
  const postalCode = String(value.postalCode ?? "").trim();
  const city = String(value.city ?? "").trim();
  const country = String(value.country ?? "").trim();
  if (!recipientName || !city || !country) return null;
  const addressLine2 = String(value.addressLine2 ?? "").trim();
  return {
    recipientName,
    streetLine,
    ...(addressLine2 ? { addressLine2 } : {}),
    postalCode,
    city,
    country,
  };
}

export function physicalQrContactFromUnknown(raw: unknown): PhysicalQrContactSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const name = String(value.name ?? "").trim();
  const email = String(value.email ?? "").trim();
  const phone = String(value.phone ?? "").trim();
  if (!name && !email && !phone) return null;
  return { name, email, phone };
}

export function physicalQrShippingLine(snapshot: unknown): string | null {
  const shipping = physicalQrShippingFromUnknown(snapshot);
  if (!shipping) return null;
  const street = shipping.streetLine.trim();
  const streetPart = street ? `, ${street}` : "";
  const line2 = shipping.addressLine2 ? `, ${shipping.addressLine2}` : "";
  return `${shipping.recipientName}${streetPart}${line2}${shipping.postalCode ? `, ${shipping.postalCode}` : ""} ${shipping.city}, ${shipping.country}`;
}

/** Pro / included printing: zero Stripe charge (totalAmount === 0). */
export function isPhysicalQrIncludedOrder(order: { totalAmount?: number | null }): boolean {
  return typeof order.totalAmount === "number" && order.totalAmount === 0;
}

export function physicalQrPaymentLabel(
  paymentStatus: string,
  t: TFunction,
  options?: { totalAmount?: number | null },
): string {
  if (paymentStatus === "PAID") {
    return isPhysicalQrIncludedOrder({ totalAmount: options?.totalAmount })
      ? t("business.qrStudio.physical.orders.orderReceived")
      : t("business.qrStudio.physical.orders.paymentReceived");
  }
  if (paymentStatus === "FAILED") return t("business.qrStudio.physical.orders.paymentFailed");
  if (paymentStatus === "CANCELLED") return t("business.qrStudio.physical.orders.cancelled");
  return t("business.qrStudio.physical.orders.paymentPending");
}

/** Distinct progress / payment indicator tones for physical QR order UI. */
export type PhysicalQrStatusTone =
  | "placed"
  | "pending"
  | "confirming"
  | "paid"
  | "processing"
  | "printing"
  | "shipped"
  | "delivered"
  | "failed"
  | "cancelled";

export function physicalQrPaymentStatusTone(paymentStatus: string): PhysicalQrStatusTone {
  switch (paymentStatus) {
    case "PAID":
      return "paid";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "pending";
  }
}

export function physicalQrFulfillmentStatusTone(fulfillmentStatus: string): PhysicalQrStatusTone {
  switch (fulfillmentStatus) {
    case "PENDING_PAYMENT":
      return "pending";
    case "PAID":
      return "paid";
    case "PROCESSING":
      return "processing";
    case "PRINTING":
      return "printing";
    case "SHIPPED":
      return "shipped";
    case "DELIVERED":
      return "delivered";
    case "CANCELLED":
      return "cancelled";
    case "PAYMENT_FAILED":
      return "failed";
    default:
      return "processing";
  }
}

export function physicalQrCustomerStatusTone(
  order: { paymentStatus: string; fulfillmentStatus: string },
  confirming?: boolean,
): PhysicalQrStatusTone {
  if (confirming) return "confirming";
  const { paymentStatus: payment, fulfillmentStatus: fulfillment } = order;
  if (payment === "FAILED" || fulfillment === "PAYMENT_FAILED") return "failed";
  if (payment === "CANCELLED" || fulfillment === "CANCELLED") return "cancelled";
  if (fulfillment === "PENDING_PAYMENT" || payment === "PENDING") return "pending";
  if (fulfillment === "DELIVERED") return "delivered";
  if (fulfillment === "SHIPPED") return "shipped";
  if (fulfillment === "PRINTING") return "printing";
  if (fulfillment === "PROCESSING") return "processing";
  if (payment === "PAID" || fulfillment === "PAID") return "paid";
  return "processing";
}

const PHYSICAL_QR_STATUS_BADGE: Record<PhysicalQrStatusTone, string> = {
  placed:
    "border-stone-200 bg-stone-100 text-stone-800 dark:border-stone-600/50 dark:bg-stone-900/45 dark:text-stone-200",
  pending:
    "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-700/55 dark:bg-amber-950/40 dark:text-amber-100",
  confirming:
    "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-700/55 dark:bg-sky-950/40 dark:text-sky-100",
  paid:
    "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-700/55 dark:bg-emerald-950/40 dark:text-emerald-100",
  processing:
    "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-700/55 dark:bg-blue-950/40 dark:text-blue-100",
  printing:
    "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-700/55 dark:bg-violet-950/40 dark:text-violet-100",
  shipped:
    "border-cyan-200 bg-cyan-50 text-cyan-950 dark:border-cyan-700/55 dark:bg-cyan-950/40 dark:text-cyan-100",
  delivered:
    "border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-600/55 dark:bg-emerald-950/55 dark:text-emerald-50",
  failed:
    "border-red-200 bg-red-50 text-red-950 dark:border-red-800/55 dark:bg-red-950/45 dark:text-red-100",
  cancelled: "border-border bg-muted/70 text-muted-foreground",
};

const PHYSICAL_QR_STATUS_DOT_DONE: Record<PhysicalQrStatusTone, string> = {
  placed: "border-stone-400 bg-stone-500 text-white dark:border-stone-500 dark:bg-stone-400",
  pending: "border-amber-500 bg-amber-500 text-white dark:border-amber-400 dark:bg-amber-500",
  confirming: "border-sky-500 bg-sky-500 text-white dark:border-sky-400 dark:bg-sky-500",
  paid: "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-500",
  processing: "border-blue-500 bg-blue-500 text-white dark:border-blue-400 dark:bg-blue-500",
  printing: "border-violet-500 bg-violet-500 text-white dark:border-violet-400 dark:bg-violet-500",
  shipped: "border-cyan-500 bg-cyan-500 text-white dark:border-cyan-400 dark:bg-cyan-500",
  delivered: "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-600",
  failed: "border-red-500 bg-red-500 text-white dark:border-red-400 dark:bg-red-500",
  cancelled: "border-muted-foreground/40 bg-muted text-muted-foreground",
};

const PHYSICAL_QR_STATUS_DOT_ACTIVE_RING: Record<PhysicalQrStatusTone, string> = {
  placed: "ring-stone-300/80 dark:ring-stone-500/50",
  pending: "ring-amber-300/90 dark:ring-amber-500/45",
  confirming: "ring-sky-300/90 dark:ring-sky-500/45",
  paid: "ring-emerald-300/90 dark:ring-emerald-500/45",
  processing: "ring-blue-300/90 dark:ring-blue-500/45",
  printing: "ring-violet-300/90 dark:ring-violet-500/45",
  shipped: "ring-cyan-300/90 dark:ring-cyan-500/45",
  delivered: "ring-emerald-400/90 dark:ring-emerald-500/45",
  failed: "ring-red-300/90 dark:ring-red-500/45",
  cancelled: "ring-border",
};

export function physicalQrStatusBadgeClasses(tone: PhysicalQrStatusTone): string {
  return PHYSICAL_QR_STATUS_BADGE[tone] ?? PHYSICAL_QR_STATUS_BADGE.processing;
}

export function physicalQrStatusDotClasses(
  tone: PhysicalQrStatusTone,
  options: { done: boolean; active?: boolean },
): string {
  if (options.done) {
    return PHYSICAL_QR_STATUS_DOT_DONE[tone] ?? PHYSICAL_QR_STATUS_DOT_DONE.processing;
  }
  if (options.active) {
    const ring = PHYSICAL_QR_STATUS_DOT_ACTIVE_RING[tone] ?? PHYSICAL_QR_STATUS_DOT_ACTIVE_RING.processing;
    return `border-border bg-background text-muted-foreground ring-2 ring-offset-2 ring-offset-background ${ring}`;
  }
  return "border-border bg-background text-muted-foreground";
}

export function physicalQrTimelineStepTone(stepId: PhysicalQrTimelineStepId): PhysicalQrStatusTone {
  switch (stepId) {
    case "placed":
      return "placed";
    case "paid":
      return "paid";
    case "processing":
      return "processing";
    case "printing":
      return "printing";
    case "shipped":
      return "shipped";
    case "delivered":
      return "delivered";
    default:
      return "processing";
  }
}

export function physicalQrFulfillmentLabel(
  fulfillmentStatus: string,
  t: TFunction,
  options?: { totalAmount?: number | null },
): string {
  switch (fulfillmentStatus) {
    case "PENDING_PAYMENT":
      return t("business.qrStudio.physical.orders.paymentPending");
    case "PAID":
      return isPhysicalQrIncludedOrder({ totalAmount: options?.totalAmount })
        ? t("business.qrStudio.physical.orders.orderReceived")
        : t("business.qrStudio.physical.orders.paymentReceived");
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
  order: { paymentStatus: string; fulfillmentStatus: string; totalAmount?: number | null },
  t: TFunction,
  confirming?: boolean,
): { title: string; detail: string | null; tone: PhysicalQrStatusTone } {
  const tone = physicalQrCustomerStatusTone(order, confirming);
  const included = isPhysicalQrIncludedOrder(order);
  if (confirming) {
    return {
      tone,
      title: included
        ? t("business.qrStudio.physical.orders.confirmingIncludedTitle")
        : t("business.qrStudio.physical.orders.confirmingTitle"),
      detail: t("business.qrStudio.physical.orders.statusConfirmingDetail"),
    };
  }
  const payment = order.paymentStatus;
  const fulfillment = order.fulfillmentStatus;
  if (payment === "FAILED" || fulfillment === "PAYMENT_FAILED") {
    return {
      tone,
      title: t("business.qrStudio.physical.orders.paymentFailed"),
      detail: t("business.qrStudio.physical.orders.statusFailedDetail"),
    };
  }
  if (payment === "CANCELLED" || fulfillment === "CANCELLED") {
    return { tone, title: t("business.qrStudio.physical.orders.cancelled"), detail: null };
  }
  if (fulfillment === "PENDING_PAYMENT" || payment === "PENDING") {
    return {
      tone,
      title: t("business.qrStudio.physical.orders.paymentPending"),
      detail: t("business.qrStudio.physical.orders.statusPendingDetail"),
    };
  }
  if (fulfillment === "DELIVERED") {
    return { tone, title: t("business.qrStudio.physical.orders.delivered"), detail: null };
  }
  if (fulfillment === "SHIPPED") {
    return {
      tone,
      title: t("business.qrStudio.physical.orders.shipped"),
      detail: t("business.qrStudio.physical.orders.statusShippedDetail"),
    };
  }
  if (fulfillment === "PRINTING") {
    return { tone, title: t("business.qrStudio.physical.orders.beingPrinted"), detail: null };
  }
  if (fulfillment === "PROCESSING") {
    return {
      tone,
      title: t("business.qrStudio.physical.orders.processing"),
      detail: t("business.qrStudio.physical.orders.statusProcessingDetail"),
    };
  }
  return {
    tone,
    title: included
      ? t("business.qrStudio.physical.orders.orderReceived")
      : t("business.qrStudio.physical.orders.paymentReceived"),
    detail: included
      ? t("business.qrStudio.physical.orders.orderReceivedProcessing")
      : t("business.qrStudio.physical.orders.statusProcessingDetail"),
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
    totalAmount?: number | null;
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
  const included = isPhysicalQrIncludedOrder(order);
  return [
    {
      id: "placed",
      label: t("business.qrStudio.physical.orders.stepPlaced"),
      at: order.placedAt,
      done: true,
    },
    {
      id: "paid",
      label: included
        ? t("business.qrStudio.physical.orders.stepOrderReceived")
        : t("business.qrStudio.physical.orders.stepPaid"),
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
