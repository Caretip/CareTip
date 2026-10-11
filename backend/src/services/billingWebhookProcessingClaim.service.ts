import { randomUUID } from "node:crypto";
import { Prisma, SubscriptionEventProcessingResult } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";
import { BillingWebhookConcurrentDeliveryError } from "./billingWebhookIdempotency.service.js";

export const BILLING_WEBHOOK_PROCESSING_CLAIM_TTL_MS = 5 * 60 * 1000;

const WEBHOOK_LOCK_PREFIX = "caretip_billing_wh:";

export const BILLING_WEBHOOK_PROCESSING_AUDIT_TYPE = "billing_webhook_processing";

export type BillingWebhookClaimAcquireResult =
  | { action: "duplicate"; processingResult: "processed" | "ignored" }
  | { action: "acquired"; claimToken: string; eventRowId: string };

function isRetryableIgnoredPayload(payload: unknown): boolean {
  const reason = (payload as { reason?: string } | null)?.reason;
  return reason === "subscription_row_not_found";
}

function claimExpired(expiresAt: Date | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now;
}

/**
 * Acquire exclusive processing ownership for a Stripe billing webhook event id.
 * Creates or reclaims a subscription_events row in `processing` state.
 */
export async function acquireBillingWebhookProcessingClaim(
  stripeEventId: string,
): Promise<BillingWebhookClaimAcquireResult> {
  const now = new Date();
  const claimToken = randomUUID();
  const claimExpiresAt = new Date(now.getTime() + BILLING_WEBHOOK_PROCESSING_CLAIM_TTL_MS);
  const webhookLockKey = `${WEBHOOK_LOCK_PREFIX}${stripeEventId}`;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${webhookLockKey}))`;

    const row = await tx.subscriptionEvent.findUnique({
      where: { stripeEventId },
      select: {
        id: true,
        processingResult: true,
        payload: true,
        processingClaimToken: true,
        processingClaimExpiresAt: true,
      },
    });

    if (row) {
      if (row.processingResult === SubscriptionEventProcessingResult.processed) {
        return { action: "duplicate", processingResult: "processed" };
      }

      if (
        row.processingResult === SubscriptionEventProcessingResult.ignored &&
        !isRetryableIgnoredPayload(row.payload)
      ) {
        return { action: "duplicate", processingResult: "ignored" };
      }

      if (row.processingResult === SubscriptionEventProcessingResult.processing) {
        if (!claimExpired(row.processingClaimExpiresAt, now.getTime())) {
          throw new BillingWebhookConcurrentDeliveryError(stripeEventId);
        }
        await tx.subscriptionEvent.update({
          where: { id: row.id },
          data: {
            processingClaimToken: claimToken,
            processingClaimExpiresAt: claimExpiresAt,
            processingError: null,
          },
        });
        return { action: "acquired", claimToken, eventRowId: row.id };
      }

      if (
        row.processingResult === SubscriptionEventProcessingResult.failed ||
        (row.processingResult === SubscriptionEventProcessingResult.ignored &&
          isRetryableIgnoredPayload(row.payload))
      ) {
        await tx.subscriptionEvent.update({
          where: { id: row.id },
          data: {
            processingResult: SubscriptionEventProcessingResult.processing,
            processingClaimToken: claimToken,
            processingClaimExpiresAt: claimExpiresAt,
            processingError: null,
            processedAt: null,
            auditType: BILLING_WEBHOOK_PROCESSING_AUDIT_TYPE,
            type: BILLING_WEBHOOK_PROCESSING_AUDIT_TYPE,
          },
        });
        logTrialSync("activation.webhook_retry_cleared", {
          stripeEventId,
          reason:
            row.processingResult === SubscriptionEventProcessingResult.failed
              ? "failed_processing"
              : "subscription_row_not_found",
        });
        return { action: "acquired", claimToken, eventRowId: row.id };
      }

      return { action: "duplicate", processingResult: "ignored" };
    }

    const created = await tx.subscriptionEvent.create({
      data: {
        subscriptionId: null,
        auditType: BILLING_WEBHOOK_PROCESSING_AUDIT_TYPE,
        type: BILLING_WEBHOOK_PROCESSING_AUDIT_TYPE,
        stripeEventId,
        processingResult: SubscriptionEventProcessingResult.processing,
        processingClaimToken: claimToken,
        processingClaimExpiresAt: claimExpiresAt,
        payload: { phase: "claim_acquired" },
        occurredAt: now,
      },
      select: { id: true },
    });

    return { action: "acquired", claimToken, eventRowId: created.id };
  });
}

export async function finalizeBillingWebhookClaimIgnored(params: {
  stripeEventId: string;
  claimToken: string;
  auditType: string;
  payload: Record<string, unknown>;
  subscriptionId?: string | null;
}): Promise<boolean> {
  const now = new Date();
  const updated = await prisma.subscriptionEvent.updateMany({
    where: {
      stripeEventId: params.stripeEventId,
      processingClaimToken: params.claimToken,
      processingResult: SubscriptionEventProcessingResult.processing,
    },
    data: {
      subscriptionId: params.subscriptionId ?? null,
      auditType: params.auditType,
      type: params.auditType,
      processingResult: SubscriptionEventProcessingResult.ignored,
      processingClaimToken: null,
      processingClaimExpiresAt: null,
      processingError: null,
      payload: params.payload as Prisma.InputJsonValue,
      processedAt: now,
    },
  });
  return updated.count === 1;
}

export async function finalizeBillingWebhookClaimFailed(params: {
  stripeEventId: string;
  claimToken: string;
  auditType: string;
  payload: Record<string, unknown>;
  error: unknown;
  subscriptionId?: string | null;
}): Promise<boolean> {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  const now = new Date();
  const updated = await prisma.subscriptionEvent.updateMany({
    where: {
      stripeEventId: params.stripeEventId,
      processingClaimToken: params.claimToken,
      processingResult: SubscriptionEventProcessingResult.processing,
    },
    data: {
      subscriptionId: params.subscriptionId ?? null,
      auditType: params.auditType,
      type: params.auditType,
      processingResult: SubscriptionEventProcessingResult.failed,
      processingClaimToken: null,
      processingClaimExpiresAt: null,
      processingError: message,
      payload: { ...params.payload, error: message } as Prisma.InputJsonValue,
      processedAt: now,
    },
  });
  return updated.count === 1;
}

/** True when a stale worker must not overwrite a newer successful delivery. */
export async function finalizeBillingWebhookClaimProcessed(params: {
  stripeEventId: string;
  claimToken: string;
  subscriptionId: string | null;
  auditType: string;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  const now = new Date();
  const updated = await prisma.subscriptionEvent.updateMany({
    where: {
      stripeEventId: params.stripeEventId,
      processingClaimToken: params.claimToken,
      processingResult: SubscriptionEventProcessingResult.processing,
    },
    data: {
      subscriptionId: params.subscriptionId,
      auditType: params.auditType,
      type: params.auditType,
      processingResult: SubscriptionEventProcessingResult.processed,
      processingClaimToken: null,
      processingClaimExpiresAt: null,
      processingError: null,
      payload: params.payload as Prisma.InputJsonValue,
      processedAt: now,
    },
  });
  return updated.count === 1;
}

export async function isBillingWebhookClaimStillOwned(
  stripeEventId: string,
  claimToken: string,
): Promise<boolean> {
  const row = await prisma.subscriptionEvent.findUnique({
    where: { stripeEventId },
    select: { processingClaimToken: true, processingResult: true },
  });
  if (!row) return false;
  if (row.processingResult !== SubscriptionEventProcessingResult.processing) {
    return false;
  }
  return row.processingClaimToken === claimToken;
}
