import { SubscriptionEventProcessingResult } from "@prisma/client";

export type BillingWebhookDeliveryDecision =
  | { action: "process" }
  | { action: "duplicate"; processingResult: "processed" | "ignored" };

/** Stripe should retry — another delivery holds a non-expired processing claim. */
export class BillingWebhookConcurrentDeliveryError extends Error {
  constructor(stripeEventId: string) {
    super(`Billing webhook event is already being processed: ${stripeEventId.slice(0, 12)}…`);
    this.name = "BillingWebhookConcurrentDeliveryError";
  }
}

/** Pure classifier for terminal subscription_events rows (not in-flight processing). */
export function classifyBillingWebhookEventRow(
  row: {
    processingResult: SubscriptionEventProcessingResult;
    payload: unknown;
  } | null,
): BillingWebhookDeliveryDecision | { action: "clear_and_process" } {
  if (!row) {
    return { action: "process" };
  }

  if (row.processingResult === SubscriptionEventProcessingResult.processed) {
    return { action: "duplicate", processingResult: "processed" };
  }

  if (row.processingResult === SubscriptionEventProcessingResult.processing) {
    return { action: "duplicate", processingResult: "ignored" };
  }

  if (row.processingResult === SubscriptionEventProcessingResult.failed) {
    return { action: "clear_and_process" };
  }

  if (row.processingResult === SubscriptionEventProcessingResult.ignored) {
    const payload = row.payload as { reason?: string } | null;
    if (payload?.reason === "subscription_row_not_found") {
      return { action: "clear_and_process" };
    }
    return { action: "duplicate", processingResult: "ignored" };
  }

  return { action: "duplicate", processingResult: "ignored" };
}
