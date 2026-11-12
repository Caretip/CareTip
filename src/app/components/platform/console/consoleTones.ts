import type { ConsoleTone } from "./AdminConsole";
import { isPhysicalQrFulfillable } from "../../../lib/physicalQrOrderUi";

/** Status → tone maps shared by admin console pages (colour is never the only signal: pills carry text). */

export function qrPaymentTone(status: string): ConsoleTone {
  switch (status) {
    case "PAID":
      return "success";
    case "PENDING":
      return "info";
    case "IN_REVIEW":
    case "PARTIALLY_REFUNDED":
      return "attention";
    case "DISPUTED":
      return "dispute";
    case "FAILED":
      return "failure";
    default:
      return "neutral";
  }
}

export function qrFulfillmentTone(status: string): ConsoleTone {
  switch (status) {
    case "PAID":
      return "attention";
    case "PROCESSING":
    case "PRINTING":
    case "SHIPPED":
      return "info";
    case "DELIVERED":
      return "success";
    case "PAYMENT_FAILED":
      return "failure";
    default:
      return "neutral";
  }
}

/** True when an order sits in a fulfilment stage but payment state forbids printing/shipping. */
export function qrOrderIsHeld(order: { paymentStatus: string; fulfillmentStatus: string; holdReleasedAt?: string | null }): boolean {
  if (order.paymentStatus === "IN_REVIEW") return true;
  return (
    ["PAID", "PROCESSING", "PRINTING"].includes(order.fulfillmentStatus) &&
    !isPhysicalQrFulfillable(order.paymentStatus, order.holdReleasedAt)
  );
}

export function genericStatusTone(status: string | null | undefined): ConsoleTone {
  const s = (status ?? "").toLowerCase();
  if (["succeeded", "success", "paid", "active", "approved", "verified", "won", "online", "completed", "delivered", "resolved", "enabled"].includes(s))
    return "success";
  if (["pending", "processing", "trialing", "submitted", "in_transit", "scheduled", "queued", "open", "running"].includes(s)) return "info";
  if (["needs_response", "warning_needs_response", "under_review", "in_review", "past_due", "requires_action", "warning", "draft", "partially_refunded"].includes(s))
    return "attention";
  if (["failed", "rejected", "lost", "offline", "canceled_failed", "error", "unpaid", "blocked", "suspended", "payment_failed"].includes(s)) return "failure";
  if (["dispute", "disputed", "charge_refunded"].includes(s)) return "dispute";
  return "neutral";
}
