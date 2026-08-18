import type { PhysicalQrFulfillmentStatus, PhysicalQrPaymentStatus } from "./types.js";

const FULFILLMENT_TRANSITIONS: Record<PhysicalQrFulfillmentStatus, PhysicalQrFulfillmentStatus[]> = {
  PENDING_PAYMENT: ["PAID", "PROCESSING", "CANCELLED", "PAYMENT_FAILED"],
  PAID: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PRINTING", "CANCELLED"],
  PRINTING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  PAYMENT_FAILED: ["PENDING_PAYMENT", "CANCELLED"],
};

export function canTransitionFulfillment(
  from: PhysicalQrFulfillmentStatus,
  to: PhysicalQrFulfillmentStatus,
): boolean {
  return FULFILLMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertFulfillmentTransition(
  from: PhysicalQrFulfillmentStatus,
  to: PhysicalQrFulfillmentStatus,
): void {
  if (!canTransitionFulfillment(from, to)) {
    throw new PhysicalQrStatusError(`Invalid fulfillment transition ${from} → ${to}`);
  }
}

export class PhysicalQrStatusError extends Error {
  readonly code = "INVALID_STATUS_TRANSITION";
  constructor(message: string) {
    super(message);
  }
}

export function paymentStatusAfterWebhook(paid: boolean): PhysicalQrPaymentStatus {
  return paid ? "PAID" : "FAILED";
}

export function orderCanPay(input: {
  paymentStatus: string;
  fulfillmentStatus: string;
}): boolean {
  return (
    (input.paymentStatus === "PENDING" && input.fulfillmentStatus === "PENDING_PAYMENT") ||
    (input.paymentStatus === "FAILED" && input.fulfillmentStatus === "PAYMENT_FAILED")
  );
}
