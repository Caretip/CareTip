import {
  BillingCycle,
  BusinessSubscriptionTier,
  SubscriptionEventProcessingResult,
  SubscriptionPlanKey,
  SubscriptionStatus,
  TrialSource,
  Prisma,
} from "@prisma/client";
import type Stripe from "stripe";
import {
  mapBusinessTierToPlanKey,
  mapPlanKeyToBusinessTier,
} from "../lib/subscription/mapSubscriptionPlanKey.js";
import { resolvePlanKeyForStripeSubscription } from "../lib/subscription/mapStripePriceToPlanKey.js";
import { mapStripeSubscriptionStatus } from "../lib/subscription/mapStripeSubscriptionStatus.js";
import {
  STRIPE_BILLING_AUDIT_TYPES,
  SUBSCRIPTION_AUDIT_TYPES,
  type SubscriptionMirrorSource,
} from "../lib/subscription/subscriptionAuditTypes.js";
import { prisma } from "../prisma.js";
import { isSubscriptionMirrorEntitled } from "../lib/subscription/subscriptionMirrorEntitlement.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";
import { isPrismaUniqueViolationOnStripeEventId } from "../lib/prismaUniqueViolation.js";

type DbClient = Prisma.TransactionClient | typeof prisma;

function dbClient(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma;
}

/** Internal Basic: free entitlement row with no Stripe billing linkage. */
export function isInternalBasicSubscription(sub: {
  planKey: SubscriptionPlanKey;
  status: SubscriptionStatus;
  stripeSubscriptionId: string | null;
  isTrial: boolean;
}): boolean {
  return (
    sub.planKey === SubscriptionPlanKey.basic &&
    sub.status === SubscriptionStatus.active &&
    sub.stripeSubscriptionId == null &&
    sub.isTrial === false
  );
}

const INTERNAL_BASIC_MIRROR_FIELDS = {
  planKey: SubscriptionPlanKey.basic,
  status: SubscriptionStatus.active,
  billingCycle: BillingCycle.monthly,
  stripeSubscriptionId: null,
  stripeCustomerId: null,
  stripePriceId: null,
  platformFeeCents: null,
  isTrial: false,
  trialSource: null,
  trialStartedAt: null,
  trialEndsAt: null,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  cancellationEffective: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  renewalDate: null,
} as const;

function internalBasicMirrorUpdateData(trialExpiredAt: Date | null): Prisma.SubscriptionUpdateInput {
  return {
    ...INTERNAL_BASIC_MIRROR_FIELDS,
    trialReminderSent: Prisma.DbNull,
    trialExpiredAt,
  };
}

/** Downgrade path — preserve Pro trial history on the mirror row. */
function internalBasicDowngradeUpdateData(params: {
  trialExpiredAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialSource: TrialSource | null;
}): Prisma.SubscriptionUpdateInput {
  return {
    planKey: SubscriptionPlanKey.basic,
    status: SubscriptionStatus.active,
    billingCycle: BillingCycle.monthly,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    stripePriceId: null,
    platformFeeCents: null,
    isTrial: false,
    trialSource: params.trialSource,
    trialStartedAt: params.trialStartedAt,
    trialEndsAt: params.trialEndsAt,
    trialReminderSent: Prisma.DbNull,
    trialExpiredAt: params.trialExpiredAt,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancellationEffective: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    renewalDate: null,
  };
}

function internalBasicMirrorCreateData(
  businessId: string,
  trialExpiredAt?: Date | null,
): Prisma.SubscriptionUncheckedCreateInput {
  return {
    businessId,
    ...INTERNAL_BASIC_MIRROR_FIELDS,
    trialExpiredAt: trialExpiredAt ?? null,
  };
}

export type InternalBasicProvisionResult = {
  subscriptionId: string;
  created: boolean;
  updated: boolean;
  skipped: boolean;
};

/**
 * Idempotent internal Basic mirror — creates or resets a Subscription row without Stripe.
 * Skips businesses that already have an entitled paid/trial mirror (Pro/Premium).
 */
export async function provisionInternalBasicSubscription(
  businessId: string,
  opts?: {
    source?: SubscriptionMirrorSource;
    tx?: Prisma.TransactionClient;
    preserveTrialExpiredAt?: boolean;
  },
): Promise<InternalBasicProvisionResult> {
  const client = dbClient(opts?.tx);
  const source = opts?.source ?? "email_signup";

  const business = await client.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      subscription: {
        select: {
          id: true,
          planKey: true,
          status: true,
          stripeSubscriptionId: true,
          isTrial: true,
          cancelAtPeriodEnd: true,
          cancellationEffective: true,
          currentPeriodEnd: true,
          canceledAt: true,
          trialExpiredAt: true,
        },
      },
    },
  });

  if (!business) {
    throw new Error(`Business not found: ${businessId}`);
  }

  const existing = business.subscription;
  if (existing) {
    if (isSubscriptionMirrorEntitled(existing)) {
      if (isInternalBasicSubscription(existing)) {
        return { subscriptionId: existing.id, created: false, updated: false, skipped: true };
      }
      return { subscriptionId: existing.id, created: false, updated: false, skipped: true };
    }
  }

  const now = new Date();
  const trialExpiredAt =
    opts?.preserveTrialExpiredAt && existing?.trialExpiredAt
      ? existing.trialExpiredAt
      : existing?.status === SubscriptionStatus.trialing
        ? now
        : existing?.trialExpiredAt ?? null;

  if (existing) {
    const eventData = createSubscriptionAuditEventData({
      auditType: SUBSCRIPTION_AUDIT_TYPES.downgradedToBasic,
      source,
      payload: {
        businessId,
        previousPlanKey: existing.planKey,
        previousStatus: existing.status,
        planKey: SubscriptionPlanKey.basic,
        status: SubscriptionStatus.active,
        reason: "provision_internal_basic",
      },
      occurredAt: now,
    });

    const applyUpdate = async (tx: DbClient) => {
      await tx.business.update({
        where: { id: businessId },
        data: { subscriptionTier: BusinessSubscriptionTier.basic },
      });
      await tx.subscription.update({
        where: { id: existing.id },
        data: internalBasicMirrorUpdateData(trialExpiredAt),
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: existing.id,
          ...eventData,
        },
      });
    };

    if (opts?.tx) {
      await applyUpdate(opts.tx);
    } else {
      await prisma.$transaction(async (tx) => {
        await applyUpdate(tx);
      });
    }

    return { subscriptionId: existing.id, created: false, updated: true, skipped: false };
  }

  const applyCreate = async (tx: DbClient) => {
    const row = await tx.subscription.create({
      data: {
        ...internalBasicMirrorCreateData(businessId, trialExpiredAt),
        events: {
          create: createSubscriptionAuditEventData({
            auditType: SUBSCRIPTION_AUDIT_TYPES.created,
            source,
            payload: {
              planKey: SubscriptionPlanKey.basic,
              subscriptionTier: BusinessSubscriptionTier.basic,
              status: SubscriptionStatus.active,
              internalBasic: true,
            },
            occurredAt: now,
          }),
        },
      },
      select: { id: true },
    });

    await tx.business.update({
      where: { id: businessId },
      data: { subscriptionTier: BusinessSubscriptionTier.basic },
    });

    return row;
  };

  const created = opts?.tx
    ? await applyCreate(opts.tx)
    : await prisma.$transaction(async (tx) => applyCreate(tx));

  return { subscriptionId: created.id, created: true, updated: false, skipped: false };
}

export type DowngradeToInternalBasicParams = {
  subscriptionRowId: string;
  businessId: string;
  auditType?: SubscriptionAuditType;
  stripeEventId?: string | null;
  auditPayload?: Record<string, unknown>;
  reason?: string;
  tx?: Prisma.TransactionClient;
  billingWebhookClaimToken?: string | null;
};

/**
 * Lifecycle downgrade — keeps business data, resets mirror to internal Basic active.
 * Replaces delete-mirror behavior for normal Pro/trial/Premium ends.
 */
export async function downgradeToInternalBasic(
  params: DowngradeToInternalBasicParams,
): Promise<void> {
  const client = dbClient(params.tx);
  const now = new Date();

  const existing = await client.subscription.findUnique({
    where: { id: params.subscriptionRowId },
    select: {
      id: true,
      businessId: true,
      planKey: true,
      status: true,
      isTrial: true,
      trialExpiredAt: true,
      trialStartedAt: true,
      trialEndsAt: true,
      trialSource: true,
    },
  });

  if (!existing || existing.businessId !== params.businessId) {
    throw new Error("Subscription row not found for downgrade");
  }

  const trialExpiredAt =
    existing.status === SubscriptionStatus.trialing && !existing.trialExpiredAt
      ? now
      : existing.trialExpiredAt;

  const auditType = params.auditType ?? SUBSCRIPTION_AUDIT_TYPES.downgradedToBasic;
  const eventData = createSubscriptionAuditEventData({
    auditType,
    payload: {
      businessId: params.businessId,
      previousPlanKey: existing.planKey,
      previousStatus: existing.status,
      planKey: SubscriptionPlanKey.basic,
      status: SubscriptionStatus.active,
      reason: params.reason ?? "lifecycle_downgrade",
      ...params.auditPayload,
    },
    stripeEventId: params.stripeEventId ?? null,
    processingResult: SubscriptionEventProcessingResult.processed,
    occurredAt: now,
  });

  const applyDowngrade = async (tx: DbClient) => {
    await tx.business.update({
      where: { id: params.businessId },
      data: { subscriptionTier: BusinessSubscriptionTier.basic },
    });
    await tx.subscription.update({
      where: { id: params.subscriptionRowId },
      data: internalBasicDowngradeUpdateData({
        trialExpiredAt,
        trialStartedAt: existing.trialStartedAt,
        trialEndsAt: existing.trialEndsAt,
        trialSource: existing.trialSource,
      }),
    });
    if (params.billingWebhookClaimToken && params.stripeEventId) {
      const finalized = await tx.subscriptionEvent.updateMany({
        where: {
          stripeEventId: params.stripeEventId,
          processingClaimToken: params.billingWebhookClaimToken,
          processingResult: SubscriptionEventProcessingResult.processing,
        },
        data: {
          subscriptionId: params.subscriptionRowId,
          auditType: eventData.auditType,
          type: eventData.type,
          processingResult: SubscriptionEventProcessingResult.processed,
          processingClaimToken: null,
          processingClaimExpiresAt: null,
          processingError: null,
          payload: eventData.payload as Prisma.InputJsonValue,
          processedAt: now,
        },
      });
      if (finalized.count !== 1) {
        throw new Error("Billing webhook claim was not finalized during downgrade");
      }
    } else {
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: params.subscriptionRowId,
          ...eventData,
        },
      });
    }
  };

  if (params.tx) {
    await applyDowngrade(params.tx);
  } else {
    await prisma.$transaction(async (tx) => {
      await applyDowngrade(tx);
    });
  }
}


export type { SubscriptionMirrorSource };

export type StripeMirrorSnapshot = {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripePriceId: string | null;
  planKey: SubscriptionPlanKey;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  renewalDate: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  cancellationEffective: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialSource: TrialSource | null;
  isTrial: boolean;
  trialExpiredAt: Date | null;
};

function unixToDate(seconds: number | null | undefined): Date | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}

function stripeCustomerId(customer: Stripe.Subscription["customer"]): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id ?? null;
}

function primaryStripePrice(sub: Stripe.Subscription): Stripe.Price | null {
  const item = sub.items?.data?.[0];
  if (!item?.price) return null;
  return typeof item.price === "string" ? null : item.price;
}

/** Build mirror fields from a Stripe Subscription object. */
export function buildMirrorSnapshotFromStripeSubscription(
  sub: Stripe.Subscription,
): StripeMirrorSnapshot {
  const price = primaryStripePrice(sub);
  const rawPrice = sub.items?.data?.[0]?.price;
  if (!rawPrice) {
    throw new Error("Stripe subscription missing price");
  }
  const rawPriceId = typeof rawPrice === "string" ? rawPrice : rawPrice.id;
  logTrialSync("mirror.build_snapshot.price_lookup", {
    stripeSubscriptionId: sub.id,
    stripeStatus: sub.status,
    priceId: rawPriceId,
    envPremiumMonthly: process.env.STRIPE_PRICE_PREMIUM_MONTHLY?.trim() ?? null,
  });
  let planKey: SubscriptionPlanKey;
  try {
    const resolved = resolvePlanKeyForStripeSubscription(sub, price ?? rawPrice);
    planKey = resolved.planKey;
    if (resolved.source === "subscription_metadata") {
      logTrialSync("mirror.build_snapshot.plan_key_from_subscription_metadata", {
        stripeSubscriptionId: sub.id,
        priceId: rawPriceId,
        planKey,
      });
    }
  } catch (err) {
    logTrialSync("mirror.build_snapshot.price_map_failed", {
      stripeSubscriptionId: sub.id,
      priceId: rawPriceId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  const { status } = mapStripeSubscriptionStatus(sub.status);
  const periodEnd = unixToDate(sub.current_period_end);
  const cancelAtPeriodEnd = sub.cancel_at_period_end === true;

  let cancellationEffective: Date | null = null;
  if (cancelAtPeriodEnd && periodEnd) {
    cancellationEffective = periodEnd;
  } else if (sub.canceled_at) {
    cancellationEffective = unixToDate(sub.canceled_at);
  }

  const interval = price?.recurring?.interval;
  const billingCycle = interval === "year" ? BillingCycle.yearly : BillingCycle.monthly;

  const customerId = stripeCustomerId(sub.customer);
  if (!customerId) {
    throw new Error("Stripe subscription missing customer id");
  }

  return {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    stripePriceId: price?.id ?? null,
    planKey,
    status,
    billingCycle,
    currentPeriodStart: unixToDate(sub.current_period_start),
    currentPeriodEnd: periodEnd,
    renewalDate: periodEnd,
    cancelAtPeriodEnd,
    canceledAt: unixToDate(sub.canceled_at),
    cancellationEffective,
    trialStartedAt: unixToDate(sub.trial_start),
    trialEndsAt: unixToDate(sub.trial_end),
    trialSource: sub.trial_end ? TrialSource.stripe : null,
    isTrial: status === SubscriptionStatus.trialing,
    trialExpiredAt: null,
  };
}

/**
 * Resolve Business.subscriptionTier dual-write from mirror state.
 * Returns null to clear the mirrored tier when access has fully ended.
 * Returns undefined when the mirror tier should remain unchanged (cancel grace).
 */
export function resolveBusinessTierDualWrite(
  snapshot: StripeMirrorSnapshot,
): BusinessSubscriptionTier | null | undefined {
  const entitled = isSubscriptionMirrorEntitled({
    status: snapshot.status,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    cancellationEffective: snapshot.cancellationEffective,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    canceledAt: snapshot.canceledAt,
  });

  if (!entitled) {
    return null;
  }

  if (
    snapshot.status === SubscriptionStatus.active ||
    snapshot.status === SubscriptionStatus.trialing ||
    snapshot.status === SubscriptionStatus.past_due ||
    snapshot.status === SubscriptionStatus.unpaid ||
    snapshot.status === SubscriptionStatus.incomplete
  ) {
    return mapPlanKeyToBusinessTier(snapshot.planKey);
  }

  if (snapshot.status === SubscriptionStatus.canceled) {
    return mapPlanKeyToBusinessTier(snapshot.planKey);
  }

  return undefined;
}

/** @deprecated Signup no longer creates mirror rows — kept for legacy test scripts only. */
export function buildNestedSubscriptionCreateData(params: {
  subscriptionTier: BusinessSubscriptionTier;
  source: SubscriptionMirrorSource;
}): Prisma.SubscriptionCreateWithoutBusinessInput {
  const planKey = mapBusinessTierToPlanKey(params.subscriptionTier);
  const now = new Date();

  return {
    planKey,
    status: SubscriptionStatus.active,
    billingCycle: BillingCycle.monthly,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    platformFeeCents: null,
    events: {
      create: createSubscriptionAuditEventData({
        auditType: SUBSCRIPTION_AUDIT_TYPES.created,
        source: params.source,
        payload: {
          planKey,
          subscriptionTier: params.subscriptionTier,
          status: SubscriptionStatus.active,
        },
        occurredAt: now,
      }),
    },
  };
}

export type SubscriptionAuditType =
  | typeof SUBSCRIPTION_AUDIT_TYPES.created
  | typeof SUBSCRIPTION_AUDIT_TYPES.planChanged
  | typeof SUBSCRIPTION_AUDIT_TYPES.downgradedToBasic
  | (typeof STRIPE_BILLING_AUDIT_TYPES)[keyof typeof STRIPE_BILLING_AUDIT_TYPES];

/** Shape for `subscriptionEvent.create` (nested or standalone). */
export function createSubscriptionAuditEventData(params: {
  auditType: SubscriptionAuditType;
  source?: SubscriptionMirrorSource;
  payload: Record<string, unknown>;
  occurredAt?: Date;
  processingResult?: SubscriptionEventProcessingResult;
  processingError?: string | null;
  stripeEventId?: string | null;
}): Prisma.SubscriptionEventCreateWithoutSubscriptionInput {
  const now = params.occurredAt ?? new Date();

  return {
    auditType: params.auditType,
    type: params.auditType,
    stripeEventId: params.stripeEventId ?? null,
    processingResult: params.processingResult ?? SubscriptionEventProcessingResult.processed,
    processingError: params.processingError ?? null,
    payload: {
      ...params.payload,
      ...(params.source ? { source: params.source } : {}),
    },
    occurredAt: now,
    processedAt: now,
  };
}

/** Apply Stripe snapshot to mirror + optional business tier dual-write + audit event. */
export async function applyStripeMirrorTransactional(params: {
  subscriptionRowId: string;
  businessId: string;
  snapshot: StripeMirrorSnapshot;
  auditType: SubscriptionAuditType;
  stripeEventId: string;
  auditPayload: Record<string, unknown>;
  /** When set, finalizes the in-flight billing webhook claim row instead of creating a new event. */
  billingWebhookClaimToken?: string | null;
}): Promise<void> {
  const tierUpdate = resolveBusinessTierDualWrite(params.snapshot);

  logTrialSync("mirror.apply_transaction.start", {
    businessId: params.businessId,
    subscriptionRowId: params.subscriptionRowId,
    auditType: params.auditType,
    snapshotStatus: params.snapshot.status,
    snapshotPlanKey: params.snapshot.planKey,
    tierDualWrite: tierUpdate,
    isTrial: params.snapshot.status === SubscriptionStatus.trialing,
  });

  const eventData = createSubscriptionAuditEventData({
    auditType: params.auditType,
    payload: params.auditPayload,
    stripeEventId: params.stripeEventId,
    processingResult: SubscriptionEventProcessingResult.processed,
  });

  const existing = await prisma.subscription.findUnique({
    where: { id: params.subscriptionRowId },
    select: { status: true, trialExpiredAt: true },
  });

  let trialExpiredAt = existing?.trialExpiredAt ?? params.snapshot.trialExpiredAt;
  if (
    existing?.status === SubscriptionStatus.trialing &&
    params.snapshot.status === SubscriptionStatus.active &&
    !trialExpiredAt
  ) {
    trialExpiredAt = new Date();
  }

  const isTrial = params.snapshot.status === SubscriptionStatus.trialing;

  const eventWrite: Prisma.PrismaPromise<unknown> = params.billingWebhookClaimToken
    ? prisma.subscriptionEvent.updateMany({
        where: {
          stripeEventId: params.stripeEventId,
          processingClaimToken: params.billingWebhookClaimToken,
          processingResult: SubscriptionEventProcessingResult.processing,
        },
        data: {
          subscriptionId: params.subscriptionRowId,
          auditType: params.auditType,
          type: params.auditType,
          processingResult: SubscriptionEventProcessingResult.processed,
          processingClaimToken: null,
          processingClaimExpiresAt: null,
          processingError: null,
          payload: eventData.payload as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      })
    : prisma.subscriptionEvent.create({
        data: {
          subscriptionId: params.subscriptionRowId,
          ...eventData,
        },
      });

  const updates: Prisma.PrismaPromise<unknown>[] = [
    prisma.subscription.update({
      where: { id: params.subscriptionRowId },
      data: {
        stripeSubscriptionId: params.snapshot.stripeSubscriptionId,
        stripeCustomerId: params.snapshot.stripeCustomerId,
        stripePriceId: params.snapshot.stripePriceId,
        planKey: params.snapshot.planKey,
        status: params.snapshot.status,
        billingCycle: params.snapshot.billingCycle,
        currentPeriodStart: params.snapshot.currentPeriodStart,
        currentPeriodEnd: params.snapshot.currentPeriodEnd,
        renewalDate: params.snapshot.renewalDate,
        cancelAtPeriodEnd: params.snapshot.cancelAtPeriodEnd,
        canceledAt: params.snapshot.canceledAt,
        cancellationEffective: params.snapshot.cancellationEffective,
        trialStartedAt: params.snapshot.trialStartedAt,
        trialEndsAt: params.snapshot.trialEndsAt,
        trialSource: params.snapshot.trialSource,
        isTrial,
        trialExpiredAt,
      },
    }),
    eventWrite,
  ];

  if (tierUpdate !== undefined) {
    updates.unshift(
      prisma.business.update({
        where: { id: params.businessId },
        data: {
          subscriptionTier: tierUpdate,
          ...(params.snapshot.stripeCustomerId
            ? { stripeCustomerId: params.snapshot.stripeCustomerId }
            : {}),
        },
      }),
    );
  } else if (params.snapshot.stripeCustomerId) {
    updates.unshift(
      prisma.business.update({
        where: { id: params.businessId },
        data: { stripeCustomerId: params.snapshot.stripeCustomerId },
      }),
    );
  }

  try {
    await prisma.$transaction(updates);
  } catch (err) {
    if (!params.billingWebhookClaimToken && isPrismaUniqueViolationOnStripeEventId(err)) {
      logTrialSync("mirror.apply_transaction.duplicate_stripe_event", {
        businessId: params.businessId,
        subscriptionRowId: params.subscriptionRowId,
        stripeEventId: params.stripeEventId,
      });
      return;
    }
    throw err;
  }

  if (params.billingWebhookClaimToken) {
    const owned = await prisma.subscriptionEvent.count({
      where: {
        stripeEventId: params.stripeEventId,
        processingResult: SubscriptionEventProcessingResult.processed,
      },
    });
    if (owned !== 1) {
      throw new Error("Billing webhook claim was not finalized to processed");
    }
  }

  logTrialSync("mirror.apply_transaction.done", {
    businessId: params.businessId,
    subscriptionRowId: params.subscriptionRowId,
    tierDualWrite: tierUpdate,
    mirrorStatus: params.snapshot.status,
    trialEndsAt: params.snapshot.trialEndsAt?.toISOString() ?? null,
  });
}

/** Platform admin tier change — atomic business tier, mirror planKey, and audit event. */
export async function updateSubscriptionMirrorPlanTransactional(params: {
  businessId: string;
  newTier: BusinessSubscriptionTier;
  previousTier: BusinessSubscriptionTier | null;
  actorUserId: string;
}): Promise<void> {
  let subscription = await prisma.subscription.findUnique({
    where: { businessId: params.businessId },
    select: { id: true },
  });

  const newPlanKey = mapBusinessTierToPlanKey(params.newTier);
  const eventData = createSubscriptionAuditEventData({
    auditType: SUBSCRIPTION_AUDIT_TYPES.planChanged,
    payload: {
      previousTier: params.previousTier,
      newTier: params.newTier,
      previousPlanKey: params.previousTier
        ? mapBusinessTierToPlanKey(params.previousTier)
        : null,
      newPlanKey,
      actorUserId: params.actorUserId,
    },
  });

  if (!subscription) {
    const created = await prisma.subscription.create({
      data: {
        businessId: params.businessId,
        planKey: newPlanKey,
        status: SubscriptionStatus.active,
        billingCycle: BillingCycle.monthly,
        events: {
          create: createSubscriptionAuditEventData({
            auditType: SUBSCRIPTION_AUDIT_TYPES.created,
            source: "platform_admin",
            payload: {
              planKey: newPlanKey,
              subscriptionTier: params.newTier,
              status: SubscriptionStatus.active,
            },
          }),
        },
      },
      select: { id: true },
    });
    subscription = created;
  }

  await prisma.$transaction([
    prisma.business.update({
      where: { id: params.businessId },
      data: { subscriptionTier: params.newTier },
    }),
    prisma.subscription.update({
      where: { businessId: params.businessId },
      data: { planKey: newPlanKey, status: SubscriptionStatus.active },
    }),
    prisma.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        ...eventData,
      },
    }),
  ]);
}

/** First Subscription row — created on trial start, checkout success, or enterprise activation. */
export async function createInitialSubscriptionMirrorFromStripe(params: {
  businessId: string;
  snapshot: StripeMirrorSnapshot;
  auditType: SubscriptionAuditType;
  stripeEventId: string;
  auditPayload: Record<string, unknown>;
  billingWebhookClaimToken?: string | null;
}): Promise<{ id: string; businessId: string }> {
  const tierUpdate = resolveBusinessTierDualWrite(params.snapshot);
  const eventData = createSubscriptionAuditEventData({
    auditType: params.auditType,
    payload: params.auditPayload,
    stripeEventId: params.stripeEventId,
    processingResult: SubscriptionEventProcessingResult.processed,
  });

  const isTrial = params.snapshot.status === SubscriptionStatus.trialing;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.subscription.create({
      data: {
        businessId: params.businessId,
        planKey: params.snapshot.planKey,
        status: params.snapshot.status,
        billingCycle: params.snapshot.billingCycle,
        stripeSubscriptionId: params.snapshot.stripeSubscriptionId,
        stripeCustomerId: params.snapshot.stripeCustomerId,
        stripePriceId: params.snapshot.stripePriceId,
        currentPeriodStart: params.snapshot.currentPeriodStart,
        currentPeriodEnd: params.snapshot.currentPeriodEnd,
        renewalDate: params.snapshot.renewalDate,
        cancelAtPeriodEnd: params.snapshot.cancelAtPeriodEnd,
        canceledAt: params.snapshot.canceledAt,
        cancellationEffective: params.snapshot.cancellationEffective,
        trialStartedAt: params.snapshot.trialStartedAt,
        trialEndsAt: params.snapshot.trialEndsAt,
        trialSource: params.snapshot.trialSource,
        isTrial,
        trialExpiredAt: params.snapshot.trialExpiredAt,
        events: {
          create: {
            ...createSubscriptionAuditEventData({
              auditType: SUBSCRIPTION_AUDIT_TYPES.created,
              source: "stripe_webhook",
              payload: {
                planKey: params.snapshot.planKey,
                status: params.snapshot.status,
                stripeSubscriptionId: params.snapshot.stripeSubscriptionId,
              },
            }),
          },
        },
      },
      select: { id: true },
    });

    if (params.billingWebhookClaimToken) {
      const finalized = await tx.subscriptionEvent.updateMany({
        where: {
          stripeEventId: params.stripeEventId,
          processingClaimToken: params.billingWebhookClaimToken,
          processingResult: SubscriptionEventProcessingResult.processing,
        },
        data: {
          subscriptionId: row.id,
          auditType: params.auditType,
          type: params.auditType,
          processingResult: SubscriptionEventProcessingResult.processed,
          processingClaimToken: null,
          processingClaimExpiresAt: null,
          processingError: null,
          payload: eventData.payload as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });
      if (finalized.count !== 1) {
        throw new Error("Billing webhook claim was not finalized on initial mirror create");
      }
    } else {
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: row.id,
          ...eventData,
        },
      });
    }

    if (tierUpdate !== undefined) {
      await tx.business.update({
        where: { id: params.businessId },
        data: {
          subscriptionTier: tierUpdate,
          stripeCustomerId: params.snapshot.stripeCustomerId,
        },
      });
    } else {
      await tx.business.update({
        where: { id: params.businessId },
        data: { stripeCustomerId: params.snapshot.stripeCustomerId },
      });
    }

    return row;
  });

  return { id: created.id, businessId: params.businessId };
}

/**
 * Idempotent first-mirror create for Option A (no pre-existing Subscription row).
 * Safe under concurrent checkout.session.completed + customer.subscription.* webhooks.
 */
export async function ensureInitialSubscriptionMirrorFromStripe(params: {
  businessId: string;
  snapshot: StripeMirrorSnapshot;
  auditType: SubscriptionAuditType;
  stripeEventId: string;
  auditPayload: Record<string, unknown>;
  billingWebhookClaimToken?: string | null;
}): Promise<{ id: string; businessId: string; created: boolean }> {
  const byBusiness = await prisma.subscription.findUnique({
    where: { businessId: params.businessId },
    select: { id: true, businessId: true },
  });
  if (byBusiness) {
    return { ...byBusiness, created: false };
  }

  if (params.snapshot.stripeSubscriptionId) {
    const byStripeSub = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: params.snapshot.stripeSubscriptionId },
      select: { id: true, businessId: true },
    });
    if (byStripeSub) {
      return { ...byStripeSub, created: false };
    }
  }

  try {
    const row = await createInitialSubscriptionMirrorFromStripe(params);
    return { ...row, created: true };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      const existing = await prisma.subscription.findFirst({
        where: {
          OR: [
            { businessId: params.businessId },
            ...(params.snapshot.stripeSubscriptionId
              ? [{ stripeSubscriptionId: params.snapshot.stripeSubscriptionId }]
              : []),
          ],
        },
        select: { id: true, businessId: true },
      });
      if (existing) {
        return { ...existing, created: false };
      }
    }
    throw err;
  }
}

/** Remove mirror when subscription access has fully ended (cancel / delete). */
export async function removeEndedSubscriptionMirror(params: {
  subscriptionRowId: string;
  businessId: string;
  auditType: SubscriptionAuditType;
  stripeEventId: string;
  auditPayload: Record<string, unknown>;
}): Promise<void> {
  const eventData = createSubscriptionAuditEventData({
    auditType: params.auditType,
    payload: params.auditPayload,
    stripeEventId: params.stripeEventId,
    processingResult: SubscriptionEventProcessingResult.processed,
  });

  await prisma.$transaction([
    prisma.subscriptionEvent.create({
      data: {
        subscriptionId: params.subscriptionRowId,
        ...eventData,
      },
    }),
    prisma.subscription.delete({ where: { id: params.subscriptionRowId } }),
    prisma.business.update({
      where: { id: params.businessId },
      data: { subscriptionTier: null },
    }),
  ]);
}

export async function findSubscriptionForStripeBilling(params: {
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  caretipBusinessId?: string | null;
  caretipSubscriptionId?: string | null;
}) {
  if (params.stripeSubscriptionId) {
    const bySub = await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: params.stripeSubscriptionId },
      select: { id: true, businessId: true },
    });
    if (bySub) return bySub;
  }

  if (params.stripeCustomerId) {
    const byCustomer = await prisma.subscription.findFirst({
      where: { stripeCustomerId: params.stripeCustomerId },
      select: { id: true, businessId: true },
    });
    if (byCustomer) return byCustomer;
  }

  if (params.caretipSubscriptionId) {
    const byId = await prisma.subscription.findUnique({
      where: { id: params.caretipSubscriptionId },
      select: { id: true, businessId: true },
    });
    if (byId) return byId;
  }

  if (params.caretipBusinessId) {
    const byBusiness = await prisma.subscription.findUnique({
      where: { businessId: params.caretipBusinessId },
      select: { id: true, businessId: true },
    });
    if (byBusiness) return byBusiness;
  }

  return null;
}
