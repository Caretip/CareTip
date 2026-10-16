import { randomUUID } from "node:crypto";
import { StripeWebhookEventProcessingResult } from "@prisma/client";
import { prisma } from "../prisma.js";
import { StripeWebhookConcurrentDeliveryError } from "./stripeWebhookIdempotency.service.js";

export const STRIPE_WEBHOOK_PROCESSING_CLAIM_TTL_MS = 5 * 60 * 1000;

const WEBHOOK_LOCK_PREFIX = "caretip_stripe_wh:";

export type StripeWebhookClaimAcquireResult =
  | { action: "duplicate" }
  | { action: "acquired"; claimToken: string };

function claimExpired(expiresAt: Date | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now;
}

/**
 * Atomic claim for non-billing Stripe webhook events (tips, Connect account, payouts, refunds).
 */
export async function acquireStripeWebhookProcessingClaim(
  stripeEventId: string,
  eventType: string,
): Promise<StripeWebhookClaimAcquireResult> {
  const now = new Date();
  const claimToken = randomUUID();
  const claimExpiresAt = new Date(now.getTime() + STRIPE_WEBHOOK_PROCESSING_CLAIM_TTL_MS);
  const webhookLockKey = `${WEBHOOK_LOCK_PREFIX}${stripeEventId}`;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${webhookLockKey}))`;

    const row = await tx.stripeWebhookEvent.findUnique({
      where: { id: stripeEventId },
      select: {
        processingResult: true,
        processingClaimToken: true,
        processingClaimExpiresAt: true,
      },
    });

    if (row) {
      if (row.processingResult === StripeWebhookEventProcessingResult.processed) {
        return { action: "duplicate" };
      }

      if (row.processingResult === StripeWebhookEventProcessingResult.processing) {
        if (!claimExpired(row.processingClaimExpiresAt, now.getTime())) {
          throw new StripeWebhookConcurrentDeliveryError(stripeEventId);
        }
        await tx.stripeWebhookEvent.update({
          where: { id: stripeEventId },
          data: {
            eventType,
            processingClaimToken: claimToken,
            processingClaimExpiresAt: claimExpiresAt,
            processingError: null,
          },
        });
        return { action: "acquired", claimToken };
      }

      if (row.processingResult === StripeWebhookEventProcessingResult.failed) {
        await tx.stripeWebhookEvent.update({
          where: { id: stripeEventId },
          data: {
            eventType,
            processingResult: StripeWebhookEventProcessingResult.processing,
            processingClaimToken: claimToken,
            processingClaimExpiresAt: claimExpiresAt,
            processingError: null,
            processedAt: null,
          },
        });
        return { action: "acquired", claimToken };
      }

      return { action: "duplicate" };
    }

    await tx.stripeWebhookEvent.create({
      data: {
        id: stripeEventId,
        eventType,
        processingResult: StripeWebhookEventProcessingResult.processing,
        processingClaimToken: claimToken,
        processingClaimExpiresAt: claimExpiresAt,
        processedAt: null,
      },
    });

    return { action: "acquired", claimToken };
  });
}

export async function finalizeStripeWebhookClaimProcessed(params: {
  stripeEventId: string;
  claimToken: string;
  eventType: string;
}): Promise<boolean> {
  const now = new Date();
  const updated = await prisma.stripeWebhookEvent.updateMany({
    where: {
      id: params.stripeEventId,
      processingClaimToken: params.claimToken,
      processingResult: StripeWebhookEventProcessingResult.processing,
    },
    data: {
      eventType: params.eventType,
      processingResult: StripeWebhookEventProcessingResult.processed,
      processingClaimToken: null,
      processingClaimExpiresAt: null,
      processingError: null,
      processedAt: now,
    },
  });
  return updated.count === 1;
}

export async function finalizeStripeWebhookClaimFailed(params: {
  stripeEventId: string;
  claimToken: string;
  eventType: string;
  error: unknown;
}): Promise<boolean> {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  const now = new Date();
  const updated = await prisma.stripeWebhookEvent.updateMany({
    where: {
      id: params.stripeEventId,
      processingClaimToken: params.claimToken,
      processingResult: StripeWebhookEventProcessingResult.processing,
    },
    data: {
      eventType: params.eventType,
      processingResult: StripeWebhookEventProcessingResult.failed,
      processingClaimToken: null,
      processingClaimExpiresAt: null,
      processingError: message.slice(0, 500),
      processedAt: now,
    },
  });
  return updated.count === 1;
}
