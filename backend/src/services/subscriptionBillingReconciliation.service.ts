/**
 * SUB-008 — Scheduled Stripe ↔ CareTip subscription mirror reconciliation (detection + bounded repair).
 * Does not create/cancel Stripe subscriptions or collect payments.
 */
import {
  Prisma,
  SubscriptionBillingDriftKind,
  SubscriptionBillingDriftStatus,
  SubscriptionEventProcessingResult,
} from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { isSubscriptionBillingEnabled } from "../config/featureFlags.js";
import { BILLING_CHECKOUT_METADATA_KEYS, STRIPE_BILLING_AUDIT_TYPES } from "../lib/subscription/subscriptionAuditTypes.js";
import { mapStripeSubscriptionStatus } from "../lib/subscription/mapStripeSubscriptionStatus.js";
import {
  applyStripeMirrorTransactional,
  buildMirrorSnapshotFromStripeSubscription,
  resolveBusinessTierDualWrite,
} from "./subscription.service.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { STRIPE_BILLING_BLOCK_STATUSES } from "./billingLifecycleIntegrity.service.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";
import { resolveBillingReconciliationBatchSize } from "../config/billingReconciliationConfig.js";
import {
  buildEligibleBusinessesWhere,
  resolveNextReconciliationCursor,
} from "../lib/subscription/billingReconciliationKeyset.js";
import {
  compareAndSwapBillingReconciliationCursor,
  loadBillingReconciliationCursorWithExpected,
  logBillingReconciliationCursorCasStale,
} from "./subscriptionBillingReconciliationCursor.service.js";

export const BILLING_RECONCILIATION_BATCH_SIZE = resolveBillingReconciliationBatchSize();
export const BILLING_RECONCILIATION_MAX_SUBS_PER_CUSTOMER = 10;

const RECON_LOCK_KEY = "caretip_billing_reconciliation";
/** An unfinished run older than this is treated as crashed and no longer blocks new runs. */
export const BILLING_RECONCILIATION_RUN_LEASE_MS = 15 * 60_000;

/**
 * Starts a run unless another instance holds an unfinished, unexpired run. Session advisory locks
 * do not survive the transaction pooler, so the open run row is the lease and the check+insert is
 * serialized with a transaction-scoped advisory lock.
 */
export async function acquireBillingReconciliationRun(startedAt: Date): Promise<{ id: string } | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${RECON_LOCK_KEY}))`;
    const active = await tx.subscriptionBillingReconciliationRun.findFirst({
      where: {
        finishedAt: null,
        startedAt: { gt: new Date(startedAt.getTime() - BILLING_RECONCILIATION_RUN_LEASE_MS) },
      },
      select: { id: true },
    });
    if (active) return null;
    return tx.subscriptionBillingReconciliationRun.create({ data: { startedAt }, select: { id: true } });
  });
}

type ListSubscriptionsFn = (params: {
  stripeCustomerId: string;
  limit: number;
}) => Promise<Stripe.Subscription[]>;

type RetrieveSubscriptionFn = (stripeSubscriptionId: string) => Promise<Stripe.Subscription>;

let listSubscriptionsForCustomerFn: ListSubscriptionsFn | null = null;
let retrieveSubscriptionFn: RetrieveSubscriptionFn | null = null;

export function __setListSubscriptionsForCustomerForReconciliationTests(fn: ListSubscriptionsFn | null): void {
  listSubscriptionsForCustomerFn = fn;
}

export function __setRetrieveSubscriptionForReconciliationTests(fn: RetrieveSubscriptionFn | null): void {
  retrieveSubscriptionFn = fn;
}

export function __resetSubscriptionBillingReconciliationTestSeams(): void {
  listSubscriptionsForCustomerFn = null;
  retrieveSubscriptionFn = null;
}

export type BillingReconciliationSummary = {
  runId: string;
  examined: number;
  matched: number;
  repaired: number;
  skipped: number;
  failed: number;
  incidentsOpened: number;
};

function metadataBusinessId(md: Stripe.Metadata | null | undefined): string | null {
  return md?.[BILLING_CHECKOUT_METADATA_KEYS.businessId]?.trim() ?? null;
}

function driftFingerprint(kind: SubscriptionBillingDriftKind, parts: string[]): string {
  return `${kind}:${parts.filter(Boolean).join(":")}`.slice(0, 180);
}

async function upsertDriftFinding(params: {
  runId: string;
  kind: SubscriptionBillingDriftKind;
  fingerprint: string;
  businessId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  mirrorSubscriptionId?: string | null;
  details?: Record<string, unknown>;
  status?: SubscriptionBillingDriftStatus;
}): Promise<boolean> {
  const now = new Date();
  const existing = await prisma.subscriptionBillingDriftFinding.findUnique({
    where: { fingerprint: params.fingerprint },
    select: { id: true, status: true },
  });

  if (existing?.status === SubscriptionBillingDriftStatus.suppressed) {
    return false;
  }

  if (existing) {
    await prisma.subscriptionBillingDriftFinding.update({
      where: { fingerprint: params.fingerprint },
      data: {
        lastSeenAt: now,
        runId: params.runId,
        details: (params.details ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return false;
  }

  await prisma.subscriptionBillingDriftFinding.create({
    data: {
      fingerprint: params.fingerprint,
      runId: params.runId,
      kind: params.kind,
      status: params.status ?? SubscriptionBillingDriftStatus.open,
      businessId: params.businessId ?? null,
      stripeCustomerId: params.stripeCustomerId ?? null,
      stripeSubscriptionId: params.stripeSubscriptionId ?? null,
      mirrorSubscriptionId: params.mirrorSubscriptionId ?? null,
      details: (params.details ?? undefined) as Prisma.InputJsonValue | undefined,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });
  return true;
}

async function listStripeSubscriptions(customerId: string): Promise<Stripe.Subscription[] | "api_failed"> {
  try {
    if (listSubscriptionsForCustomerFn) {
      return await listSubscriptionsForCustomerFn({
        stripeCustomerId: customerId,
        limit: BILLING_RECONCILIATION_MAX_SUBS_PER_CUSTOMER,
      });
    }
    const stripe = getStripeClient();
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: BILLING_RECONCILIATION_MAX_SUBS_PER_CUSTOMER,
    });
    return page.data;
  } catch (err) {
    logTrialSync("billing_reconciliation.stripe_list_failed", {
      stripeCustomerId: customerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "api_failed";
  }
}

async function retrieveStripeSubscription(id: string): Promise<Stripe.Subscription | "missing" | "api_failed"> {
  try {
    if (retrieveSubscriptionFn) {
      return await retrieveSubscriptionFn(id);
    }
    const stripe = getStripeClient();
    return await stripe.subscriptions.retrieve(id);
  } catch (err) {
    const code = (err as { code?: string; statusCode?: number })?.code;
    if (code === "resource_missing" || (err as { statusCode?: number }).statusCode === 404) {
      return "missing";
    }
    logTrialSync("billing_reconciliation.stripe_retrieve_failed", {
      stripeSubscriptionId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return "api_failed";
  }
}

async function safeRepairMirrorFromStripe(params: {
  runId: string;
  businessId: string;
  subscriptionRowId: string;
  sub: Stripe.Subscription;
}): Promise<boolean> {
  const metaBusinessId = metadataBusinessId(params.sub.metadata);
  if (metaBusinessId && metaBusinessId !== params.businessId) {
    return false;
  }

  const inFlight = await prisma.subscriptionEvent.findFirst({
    where: {
      subscriptionId: params.subscriptionRowId,
      processingResult: SubscriptionEventProcessingResult.processing,
    },
    select: { id: true },
  });
  if (inFlight) {
    return false;
  }

  const snapshot = buildMirrorSnapshotFromStripeSubscription(params.sub);
  const stripeEventId = `recon_${params.runId}_${params.sub.id}`.slice(0, 120);

  await applyStripeMirrorTransactional({
    subscriptionRowId: params.subscriptionRowId,
    businessId: params.businessId,
    snapshot,
    auditType: STRIPE_BILLING_AUDIT_TYPES.reconciliationRepair,
    stripeEventId,
    auditPayload: {
      source: "billing_reconciliation",
      runId: params.runId,
      stripeSubscriptionId: params.sub.id,
      stripeStatus: params.sub.status,
    },
  });
  return true;
}

export async function runSubscriptionBillingReconciliation(): Promise<BillingReconciliationSummary> {
  if (!isSubscriptionBillingEnabled() || !isStripeConfigured()) {
    return {
      runId: "",
      examined: 0,
      matched: 0,
      repaired: 0,
      skipped: 0,
      failed: 0,
      incidentsOpened: 0,
    };
  }

  const startedAt = new Date();
  const run = await acquireBillingReconciliationRun(startedAt);

  let examined = 0;
  let matched = 0;
  let repaired = 0;
  let skipped = 0;
  let failed = 0;
  let incidentsOpened = 0;

  if (!run) {
    const skippedRun = await prisma.subscriptionBillingReconciliationRun.create({
      data: {
        startedAt,
        finishedAt: new Date(),
        skipped: 1,
        summary: { reason: "concurrent_run_in_progress" },
      },
    });
    return {
      runId: skippedRun.id,
      examined: 0,
      matched: 0,
      repaired: 0,
      skipped: 1,
      failed: 0,
      incidentsOpened: 0,
    };
  }

  const batchSize = resolveBillingReconciliationBatchSize();
  const { cursor: loadedCursor, expected: cursorExpected } =
    await loadBillingReconciliationCursorWithExpected();

  try {
    const businesses = await prisma.business.findMany({
      where: buildEligibleBusinessesWhere(loadedCursor),
      select: {
        id: true,
        createdAt: true,
        stripeCustomerId: true,
        subscriptionTier: true,
        subscription: {
          select: {
            id: true,
            stripeSubscriptionId: true,
            status: true,
            planKey: true,
          },
        },
      },
      take: batchSize,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    for (const business of businesses) {
      examined += 1;
      const customerId = business.stripeCustomerId!;
      const mirror = business.subscription;

      const subs = await listStripeSubscriptions(customerId);
      if (subs === "api_failed") {
        skipped += 1;
        if (
          await upsertDriftFinding({
            runId: run.id,
            kind: SubscriptionBillingDriftKind.stripe_customer_list_failed,
            fingerprint: driftFingerprint(SubscriptionBillingDriftKind.stripe_customer_list_failed, [
              business.id,
            ]),
            businessId: business.id,
            stripeCustomerId: customerId,
            details: { reason: "stripe_list_failed" },
          })
        ) {
          incidentsOpened += 1;
        }
        continue;
      }

      const entitledSubs = subs.filter((s) => STRIPE_BILLING_BLOCK_STATUSES.has(s.status));

      if (mirror?.stripeSubscriptionId) {
        const retrieved = await retrieveStripeSubscription(mirror.stripeSubscriptionId);
        if (retrieved === "api_failed") {
          skipped += 1;
          continue;
        }
        if (retrieved === "missing") {
          if (
            await upsertDriftFinding({
              runId: run.id,
              kind: SubscriptionBillingDriftKind.missing_stripe_subscription,
              fingerprint: driftFingerprint(SubscriptionBillingDriftKind.missing_stripe_subscription, [
                business.id,
                mirror.stripeSubscriptionId,
              ]),
              businessId: business.id,
              stripeCustomerId: customerId,
              stripeSubscriptionId: mirror.stripeSubscriptionId,
              mirrorSubscriptionId: mirror.id,
              details: { mirrorStatus: mirror.status },
            })
          ) {
            incidentsOpened += 1;
          }
          continue;
        }

        const mapped = mapStripeSubscriptionStatus(retrieved.status);
        if (mirror.status !== mapped.status) {
          const fp = driftFingerprint(SubscriptionBillingDriftKind.status_mismatch, [
            business.id,
            mirror.stripeSubscriptionId,
            mirror.status,
            mapped.status,
          ]);
          const opened = await upsertDriftFinding({
            runId: run.id,
            kind: SubscriptionBillingDriftKind.status_mismatch,
            fingerprint: fp,
            businessId: business.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: mirror.stripeSubscriptionId,
            mirrorSubscriptionId: mirror.id,
            details: {
              mirrorStatus: mirror.status,
              stripeStatus: retrieved.status,
              mappedStatus: mapped.status,
            },
          });
          if (opened) incidentsOpened += 1;

          try {
            const didRepair = await safeRepairMirrorFromStripe({
              runId: run.id,
              businessId: business.id,
              subscriptionRowId: mirror.id,
              sub: retrieved,
            });
            if (didRepair) {
              repaired += 1;
              await prisma.subscriptionBillingDriftFinding.updateMany({
                where: { fingerprint: fp },
                data: { status: SubscriptionBillingDriftStatus.auto_repaired },
              });
            }
          } catch {
            failed += 1;
          }
        } else {
          matched += 1;
        }

        const snapshot = buildMirrorSnapshotFromStripeSubscription(retrieved);
        const tierExpect = resolveBusinessTierDualWrite(snapshot);
        if (tierExpect != null && business.subscriptionTier !== tierExpect) {
          const fp = driftFingerprint(SubscriptionBillingDriftKind.tier_mismatch, [
            business.id,
            business.subscriptionTier ?? "null",
            tierExpect,
          ]);
          if (
            await upsertDriftFinding({
              runId: run.id,
              kind: SubscriptionBillingDriftKind.tier_mismatch,
              fingerprint: fp,
              businessId: business.id,
              stripeSubscriptionId: mirror.stripeSubscriptionId,
              mirrorSubscriptionId: mirror.id,
              details: {
                businessTier: business.subscriptionTier,
                expectedTier: tierExpect,
              },
            })
          ) {
            incidentsOpened += 1;
          }
          try {
            const didRepair = await safeRepairMirrorFromStripe({
              runId: run.id,
              businessId: business.id,
              subscriptionRowId: mirror.id,
              sub: retrieved,
            });
            if (didRepair) repaired += 1;
          } catch {
            failed += 1;
          }
        }
      }

      for (const sub of entitledSubs) {
        const owner = metadataBusinessId(sub.metadata);
        if (owner && owner !== business.id) {
          const exists = await prisma.business.findUnique({ where: { id: owner }, select: { id: true } });
          if (!exists) {
            if (
              await upsertDriftFinding({
                runId: run.id,
                kind: SubscriptionBillingDriftKind.missing_business,
                fingerprint: driftFingerprint(SubscriptionBillingDriftKind.missing_business, [sub.id, owner]),
                stripeCustomerId: customerId,
                stripeSubscriptionId: sub.id,
                details: { metadataBusinessId: owner },
              })
            ) {
              incidentsOpened += 1;
            }
          } else {
            if (
              await upsertDriftFinding({
                runId: run.id,
                kind: SubscriptionBillingDriftKind.ambiguous_mapping,
                fingerprint: driftFingerprint(SubscriptionBillingDriftKind.ambiguous_mapping, [
                  sub.id,
                  business.id,
                  owner,
                ]),
                businessId: business.id,
                stripeSubscriptionId: sub.id,
                details: { metadataBusinessId: owner },
              })
            ) {
              incidentsOpened += 1;
            }
          }
          continue;
        }

        if (!mirror?.stripeSubscriptionId) {
          if (
            await upsertDriftFinding({
              runId: run.id,
              kind: SubscriptionBillingDriftKind.missing_mirror,
              fingerprint: driftFingerprint(SubscriptionBillingDriftKind.missing_mirror, [
                business.id,
                sub.id,
              ]),
              businessId: business.id,
              stripeCustomerId: customerId,
              stripeSubscriptionId: sub.id,
              details: { stripeStatus: sub.status },
            })
          ) {
            incidentsOpened += 1;
          }
          continue;
        }

        if (mirror.stripeSubscriptionId !== sub.id) {
          if (
            await upsertDriftFinding({
              runId: run.id,
              kind: SubscriptionBillingDriftKind.mirror_drift,
              fingerprint: driftFingerprint(SubscriptionBillingDriftKind.mirror_drift, [
                business.id,
                mirror.stripeSubscriptionId,
                sub.id,
              ]),
              businessId: business.id,
              stripeCustomerId: customerId,
              stripeSubscriptionId: sub.id,
              mirrorSubscriptionId: mirror.id,
              details: {
                mirrorStripeSubscriptionId: mirror.stripeSubscriptionId,
              },
            })
          ) {
            incidentsOpened += 1;
          }
        }
      }
    }

    const nextCursor = resolveNextReconciliationCursor(
      businesses.map((b) => ({ id: b.id, createdAt: b.createdAt })),
      batchSize,
    );
    const cas = await compareAndSwapBillingReconciliationCursor(cursorExpected, nextCursor);
    if (cas.status === "stale_rejected") {
      logBillingReconciliationCursorCasStale();
    }
  } catch (err) {
    await prisma.subscriptionBillingReconciliationRun
      .update({
        where: { id: run.id },
        data: { finishedAt: new Date(), failed: failed + 1, summary: { reason: "run_failed" } },
      })
      .catch(() => undefined);
    throw err;
  }

  await prisma.subscriptionBillingReconciliationRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      examined,
      matched,
      repaired,
      skipped,
      failed,
      incidentsOpened,
      summary: {
        batchSize: resolveBillingReconciliationBatchSize(),
        cursorAdvanced: true,
      },
    },
  });

  logTrialSync("billing_reconciliation.run_complete", {
    runId: run.id,
    examined,
    matched,
    repaired,
    skipped,
    failed,
    incidentsOpened,
  });

  return {
    runId: run.id,
    examined,
    matched,
    repaired,
    skipped,
    failed,
    incidentsOpened,
  };
}
