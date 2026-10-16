import { StripeWebhookEventProcessingResult } from "@prisma/client";
import { prisma } from "../prisma.js";

const RETENTION_DAYS = 30;

/** Stripe should retry — another delivery holds a non-expired processing claim. */
export class StripeWebhookConcurrentDeliveryError extends Error {
  constructor(stripeEventId: string) {
    super(`Stripe webhook event is already being processed: ${stripeEventId.slice(0, 12)}…`);
    this.name = "StripeWebhookConcurrentDeliveryError";
  }
}

/** Returns true when this Stripe event id was already processed successfully. */
export async function isStripeWebhookEventProcessed(eventId: string): Promise<boolean> {
  const row = await prisma.stripeWebhookEvent.findUnique({
    where: { id: eventId },
    select: { processingResult: true },
  });
  return row?.processingResult === StripeWebhookEventProcessingResult.processed;
}

/**
 * Legacy helper — prefer acquire/finalize claim APIs for new webhook paths.
 * Marks processed without an active claim (tests and one-off scripts only).
 */
export async function markStripeWebhookEventProcessed(
  eventId: string,
  eventType: string,
): Promise<void> {
  await prisma.stripeWebhookEvent.upsert({
    where: { id: eventId },
    create: {
      id: eventId,
      eventType,
      processingResult: StripeWebhookEventProcessingResult.processed,
      processedAt: new Date(),
    },
    update: {
      eventType,
      processingResult: StripeWebhookEventProcessingResult.processed,
      processingClaimToken: null,
      processingClaimExpiresAt: null,
      processingError: null,
      processedAt: new Date(),
    },
  });

  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await prisma.stripeWebhookEvent.deleteMany({
      where: {
        processedAt: { lt: cutoff },
        processingResult: StripeWebhookEventProcessingResult.processed,
      },
    });
  }
}
