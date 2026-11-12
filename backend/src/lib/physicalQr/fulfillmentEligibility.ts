/**
 * Single source of truth: may a QR print order be printed or move forward in fulfillment?
 *
 * Only a fully paid order (paymentStatus === "PAID") is eligible. Every held state stops printing
 * and forward fulfillment until an authorized decision resolves it (there is no automatic release):
 *   IN_REVIEW           money received but it did not match the order (amount/currency/state)
 *   PARTIALLY_REFUNDED  part of the payment was refunded
 *   REFUNDED            the payment was refunded
 *   DISPUTED            an open or lost card dispute
 * Unpaid states (PENDING, FAILED, CANCELLED) are "payment required".
 *
 * One exception, by explicit decision only: a PARTIALLY_REFUNDED order that a platform admin released
 * (physicalQrHoldResolution.service.ts) is eligible while `holdReleasedAt` is set. Any later refund or
 * dispute clears the release (physicalQrPayments.service.ts), so the order is held again.
 *
 * Used by every print and fulfillment entry point (customer print, admin print, admin bulk print,
 * admin processing/printing/ship transitions). Recording delivery of an order that already shipped
 * is not a fulfillment start and stays allowed.
 */
export const PHYSICAL_QR_HELD_PAYMENT_STATUSES = ["IN_REVIEW", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"] as const;
export type PhysicalQrHeldPaymentStatus = (typeof PHYSICAL_QR_HELD_PAYMENT_STATUSES)[number];

export function isPhysicalQrPaymentFulfillable(paymentStatus: string): boolean {
  return paymentStatus === "PAID";
}

export function isPhysicalQrPaymentHeld(paymentStatus: string): paymentStatus is PhysicalQrHeldPaymentStatus {
  return (PHYSICAL_QR_HELD_PAYMENT_STATUSES as readonly string[]).includes(paymentStatus);
}

const HELD_MESSAGES: Record<PhysicalQrHeldPaymentStatus, string> = {
  IN_REVIEW: "This order's payment is under review. It cannot be printed or fulfilled until the review is resolved.",
  PARTIALLY_REFUNDED: "Part of this order's payment was refunded. It is on hold until an authorized decision about fulfillment.",
  REFUNDED: "This order's payment was refunded. It cannot be printed or fulfilled.",
  DISPUTED: "This order's payment is disputed. It cannot be printed or fulfilled while the dispute is unresolved.",
};

/** null when eligible; otherwise the HTTP 409 error to return. */
export function physicalQrFulfillmentBlock(paymentStatus: string): { code: string; message: string } | null {
  if (isPhysicalQrPaymentFulfillable(paymentStatus)) return null;
  if (isPhysicalQrPaymentHeld(paymentStatus)) {
    return { code: "FULFILLMENT_ON_HOLD", message: HELD_MESSAGES[paymentStatus] };
  }
  return { code: "PAYMENT_REQUIRED", message: "Print files are available after payment is confirmed." };
}

export type PhysicalQrFulfillmentState = { paymentStatus: string; holdReleasedAt?: Date | string | null };

/** Order-level eligibility (includes an explicit admin release of a partially refunded order). */
export function isPhysicalQrOrderFulfillable(order: PhysicalQrFulfillmentState): boolean {
  return (
    isPhysicalQrPaymentFulfillable(order.paymentStatus) ||
    (order.paymentStatus === "PARTIALLY_REFUNDED" && Boolean(order.holdReleasedAt))
  );
}

/** Order-level block; null when the order may be printed or advanced. */
export function physicalQrOrderFulfillmentBlock(order: PhysicalQrFulfillmentState): { code: string; message: string } | null {
  return isPhysicalQrOrderFulfillable(order) ? null : physicalQrFulfillmentBlock(order.paymentStatus);
}
