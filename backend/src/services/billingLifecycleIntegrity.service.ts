import { SubscriptionStatus, type SubscriptionPlanKey } from "@prisma/client";
import type Stripe from "stripe";
import { BILLING_CHECKOUT_METADATA_KEYS } from "../lib/subscription/subscriptionAuditTypes.js";
import { isSubscriptionBillingEnabled } from "../config/featureFlags.js";
import { prisma } from "../prisma.js";
import { writeAuditLog } from "./audit.service.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { isInternalBasicSubscription } from "./subscription.service.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";

/** Stripe API `subscription.status` values that mean a live subscription object still exists (checkout/delete guards). */
export const STRIPE_BILLING_BLOCK_STATUSES = new Set<string>([
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "unpaid",
  "paused",
]);

/** CareTip mirror statuses that block starting a second self-serve checkout (includes non-entitled `paused`). */
export const MIRROR_SUBSCRIPTION_CHECKOUT_BLOCK_STATUSES = new Set<SubscriptionStatus>([
  SubscriptionStatus.active,
  SubscriptionStatus.trialing,
  SubscriptionStatus.past_due,
  SubscriptionStatus.incomplete,
  SubscriptionStatus.unpaid,
  SubscriptionStatus.paused,
]);

export type BillingLinkageSnapshot = {
  businessId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  planKey: SubscriptionPlanKey | null;
  status: SubscriptionStatus | null;
  isInternalBasic: boolean;
};

export type ActiveStripeSubscriptionSummary = {
  id: string;
  status: string;
  planKey: string | null;
};

export type BusinessBillingGuardResult = {
  blocked: boolean;
  reason?: string;
  snapshot: BillingLinkageSnapshot;
  activeStripeSubscriptions: ActiveStripeSubscriptionSummary[];
};

export type BusinessDeletionAuditInput = {
  actorUserId?: string | null;
  businessId: string;
  deletionType: "hard" | "soft";
  outcome: "blocked" | "succeeded" | "failed";
  reason?: string | null;
  snapshot?: BillingLinkageSnapshot | null;
  stripeCancellationResult?: string | null;
  errorMessage?: string | null;
};

export type StripeBillingOrphanKind = "missing_business" | "missing_mirror" | "mirror_drift";

export type StripeBillingOrphanRow = {
  kind: StripeBillingOrphanKind;
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  stripeStatus: string;
  caretipBusinessId: string | null;
  mirrorSubscriptionId: string | null;
  mirrorStripeSubscriptionId: string | null;
  detectedAt: string;
};

function metadataBusinessId(md: Stripe.Metadata | null | undefined): string | null {
  return md?.[BILLING_CHECKOUT_METADATA_KEYS.businessId]?.trim() ?? null;
}

function summarizeStripeSub(sub: Stripe.Subscription): ActiveStripeSubscriptionSummary {
  const planKey = sub.metadata?.caretipPlanKey?.trim() ?? null;
  return { id: sub.id, status: sub.status, planKey };
}

export async function loadBusinessBillingLinkageSnapshot(
  businessId: string,
): Promise<BillingLinkageSnapshot | null> {
  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      stripeCustomerId: true,
      subscription: {
        select: {
          planKey: true,
          status: true,
          stripeSubscriptionId: true,
          stripeCustomerId: true,
          isTrial: true,
        },
      },
    },
  });
  if (!row) return null;

  const sub = row.subscription;
  return {
    businessId: row.id,
    stripeCustomerId: row.stripeCustomerId ?? sub?.stripeCustomerId ?? null,
    stripeSubscriptionId: sub?.stripeSubscriptionId ?? null,
    planKey: sub?.planKey ?? null,
    status: sub?.status ?? null,
    isInternalBasic: sub ? isInternalBasicSubscription(sub) : false,
  };
}

export type OwnedStripeSubscriptionListOutcome =
  | { kind: "skipped_no_customer" }
  | { kind: "skipped_stripe_unavailable" }
  | { kind: "verified_empty" }
  | { kind: "verified"; subscriptions: ActiveStripeSubscriptionSummary[] }
  | { kind: "verification_failed" };

type ListStripeSubscriptionsFn = (params: {
  businessId: string;
  stripeCustomerId: string;
}) => Promise<Stripe.Subscription[]>;

let listStripeSubscriptionsForCustomerFn: ListStripeSubscriptionsFn | null = null;

export function __setListStripeSubscriptionsForCustomerForTests(
  fn: ListStripeSubscriptionsFn | null,
): void {
  listStripeSubscriptionsForCustomerFn = fn;
}

export function __resetListStripeSubscriptionsForCustomerForTests(): void {
  listStripeSubscriptionsForCustomerFn = null;
}

function filterOwnedEntitledSubscriptions(
  businessId: string,
  listData: Stripe.Subscription[],
): ActiveStripeSubscriptionSummary[] {
  return listData
    .filter((sub) => {
      const owner = metadataBusinessId(sub.metadata);
      return !owner || owner === businessId;
    })
    .filter((sub) => STRIPE_BILLING_BLOCK_STATUSES.has(sub.status))
    .map(summarizeStripeSub);
}

async function fetchStripeSubscriptionsForCustomer(params: {
  businessId: string;
  stripeCustomerId: string;
}): Promise<Stripe.Subscription[]> {
  if (listStripeSubscriptionsForCustomerFn) {
    return listStripeSubscriptionsForCustomerFn(params);
  }
  const stripe = getStripeClient();
  const list = await stripe.subscriptions.list({
    customer: params.stripeCustomerId,
    status: "all",
    limit: 20,
  });
  return list.data;
}

/** Checkout guard — fail closed when Stripe cannot be queried. */
export async function resolveOwnedEntitledStripeSubscriptionsForBusiness(
  businessId: string,
  stripeCustomerId: string | null,
): Promise<OwnedStripeSubscriptionListOutcome> {
  if (!isSubscriptionBillingEnabled() || !isStripeConfigured()) {
    return { kind: "skipped_stripe_unavailable" };
  }
  if (!stripeCustomerId) {
    return { kind: "skipped_no_customer" };
  }

  try {
    const listData = await fetchStripeSubscriptionsForCustomer({
      businessId,
      stripeCustomerId,
    });
    const entitled = filterOwnedEntitledSubscriptions(businessId, listData);
    if (entitled.length === 0) {
      return { kind: "verified_empty" };
    }
    return { kind: "verified", subscriptions: entitled };
  } catch (err) {
    logTrialSync("billing_checkout_guard.stripe_list_failed", {
      businessId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: "verification_failed" };
  }
}

/** Delete guard — best-effort list; empty on Stripe errors (conservative block elsewhere). */
export async function listOwnedEntitledStripeSubscriptionsForBusiness(
  businessId: string,
): Promise<ActiveStripeSubscriptionSummary[]> {
  const snapshot = await loadBusinessBillingLinkageSnapshot(businessId);
  if (!snapshot) return [];
  return listOwnedEntitledStripeSubscriptions({
    businessId,
    stripeCustomerId: snapshot.stripeCustomerId,
  });
}

async function listOwnedEntitledStripeSubscriptions(params: {
  businessId: string;
  stripeCustomerId: string | null;
}): Promise<ActiveStripeSubscriptionSummary[]> {
  if (!isSubscriptionBillingEnabled() || !isStripeConfigured()) {
    return [];
  }
  if (!params.stripeCustomerId) {
    return [];
  }

  try {
    const listData = await fetchStripeSubscriptionsForCustomer({
      businessId: params.businessId,
      stripeCustomerId: params.stripeCustomerId,
    });
    return filterOwnedEntitledSubscriptions(params.businessId, listData);
  } catch (err) {
    logTrialSync("billing_delete_guard.stripe_list_failed", {
      businessId: params.businessId,
      stripeCustomerId: params.stripeCustomerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Business deletion vs Stripe subscription mirror (Sprint 1.2 policy):
 * - Mirror with stripeSubscriptionId + entitled status blocks delete (active/trialing/past_due/incomplete/unpaid).
 * - Internal complimentary Basic (no live Stripe link) does not block via mirror alone.
 * - canceled / incomplete_expired mirror with stale stripeSubscriptionId: not locally entitled; Stripe list confirms.
 * - Missing stripeSubscriptionId but stripeCustomerId: Stripe list must succeed (fail closed on verification_failed).
 * - Stripe `paused` blocks delete (subscription still exists) but does not grant product entitlements.
 */
const MIRROR_DELETE_BLOCK_STATUSES = new Set<SubscriptionStatus>([
  SubscriptionStatus.active,
  SubscriptionStatus.trialing,
  SubscriptionStatus.past_due,
  SubscriptionStatus.incomplete,
  SubscriptionStatus.unpaid,
  SubscriptionStatus.paused,
]);

export async function assessBusinessBillingDeleteGuard(
  businessId: string,
): Promise<BusinessBillingGuardResult> {
  const snapshot = await loadBusinessBillingLinkageSnapshot(businessId);
  if (!snapshot) {
    return {
      blocked: true,
      reason: "Business not found",
      snapshot: {
        businessId,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        planKey: null,
        status: null,
        isInternalBasic: false,
      },
      activeStripeSubscriptions: [],
    };
  }

  const localBlocks =
    Boolean(snapshot.stripeSubscriptionId) &&
    !snapshot.isInternalBasic &&
    snapshot.status != null &&
    MIRROR_DELETE_BLOCK_STATUSES.has(snapshot.status);

  if (localBlocks) {
    return {
      blocked: true,
      reason:
        "Cannot delete a business while an active Stripe platform subscription exists. Cancel the subscription in billing or use soft-close instead.",
      snapshot,
      activeStripeSubscriptions: [],
    };
  }

  const stripeOutcome = await resolveOwnedEntitledStripeSubscriptionsForBusiness(
    businessId,
    snapshot.stripeCustomerId,
  );

  if (stripeOutcome.kind === "verification_failed") {
    return {
      blocked: true,
      reason:
        "Cannot delete this business because Stripe subscription status could not be verified. Try again later or contact support.",
      snapshot,
      activeStripeSubscriptions: [],
    };
  }

  const activeStripeSubscriptions =
    stripeOutcome.kind === "verified" ? stripeOutcome.subscriptions : [];

  if (activeStripeSubscriptions.length > 0) {
    return {
      blocked: true,
      reason:
        "Cannot delete a business while an active Stripe platform subscription exists. Cancel the subscription in billing or use soft-close instead.",
      snapshot,
      activeStripeSubscriptions,
    };
  }

  return { blocked: false, snapshot, activeStripeSubscriptions: [] };
}

export async function recordBusinessDeletionAudit(input: BusinessDeletionAuditInput): Promise<void> {
  await writeAuditLog({
    userId: input.actorUserId ?? null,
    action:
      input.outcome === "blocked"
        ? "business.deletion.blocked"
        : input.outcome === "succeeded"
          ? "business.deletion.succeeded"
          : "business.deletion.failed",
    metadata: JSON.stringify({
      businessId: input.businessId,
      deletionType: input.deletionType,
      outcome: input.outcome,
      reason: input.reason ?? null,
      stripeCustomerId: input.snapshot?.stripeCustomerId ?? null,
      stripeSubscriptionId: input.snapshot?.stripeSubscriptionId ?? null,
      planKey: input.snapshot?.planKey ?? null,
      status: input.snapshot?.status ?? null,
      stripeCancellationResult: input.stripeCancellationResult ?? null,
      errorMessage: input.errorMessage ?? null,
      recordedAt: new Date().toISOString(),
    }),
  });
}

export async function detectStripeBillingOrphans(limit = 50): Promise<StripeBillingOrphanRow[]> {
  const orphans: StripeBillingOrphanRow[] = [];
  const detectedAt = new Date().toISOString();

  if (!isSubscriptionBillingEnabled() || !isStripeConfigured()) {
    return orphans;
  }

  const orphanMirrorRows = await prisma.$queryRaw<
    Array<{ id: string; business_id: string; stripe_subscription_id: string | null }>
  >`
    SELECT s.id, s.business_id, s.stripe_subscription_id
    FROM subscriptions s
    LEFT JOIN businesses b ON b.id = s.business_id
    WHERE b.id IS NULL
    LIMIT ${limit}
  `;

  for (const row of orphanMirrorRows) {
    orphans.push({
      kind: "missing_business",
      stripeSubscriptionId: row.stripe_subscription_id ?? "unknown",
      stripeCustomerId: null,
      stripeStatus: "unknown",
      caretipBusinessId: row.business_id,
      mirrorSubscriptionId: row.id,
      mirrorStripeSubscriptionId: row.stripe_subscription_id,
      detectedAt,
    });
  }

  const businesses = await prisma.business.findMany({
    where: { stripeCustomerId: { not: null } },
    select: {
      id: true,
      stripeCustomerId: true,
      subscription: {
        select: { id: true, stripeSubscriptionId: true, planKey: true, status: true },
      },
    },
    take: limit,
    orderBy: { createdAt: "desc" },
  });

  const stripe = getStripeClient();

  for (const business of businesses) {
    const customerId = business.stripeCustomerId;
    if (!customerId) continue;

    let subs: Stripe.Subscription[] = [];
    try {
      const page = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 10,
      });
      subs = page.data;
    } catch (err) {
      logTrialSync("billing_orphan.scan.customer_failed", {
        businessId: business.id,
        stripeCustomerId: customerId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    for (const sub of subs) {
      if (!STRIPE_BILLING_BLOCK_STATUSES.has(sub.status)) continue;

      const metaBusinessId = metadataBusinessId(sub.metadata);
      if (metaBusinessId && metaBusinessId !== business.id) {
        const exists = await prisma.business.findUnique({
          where: { id: metaBusinessId },
          select: { id: true },
        });
        if (!exists) {
          orphans.push({
            kind: "missing_business",
            stripeSubscriptionId: sub.id,
            stripeCustomerId: customerId,
            stripeStatus: sub.status,
            caretipBusinessId: metaBusinessId,
            mirrorSubscriptionId: null,
            mirrorStripeSubscriptionId: null,
            detectedAt,
          });
        }
        continue;
      }

      const mirror = business.subscription;
      if (!mirror?.stripeSubscriptionId) {
        orphans.push({
          kind: "missing_mirror",
          stripeSubscriptionId: sub.id,
          stripeCustomerId: customerId,
          stripeStatus: sub.status,
          caretipBusinessId: business.id,
          mirrorSubscriptionId: mirror?.id ?? null,
          mirrorStripeSubscriptionId: null,
          detectedAt,
        });
        continue;
      }

      if (mirror.stripeSubscriptionId !== sub.id) {
        orphans.push({
          kind: "mirror_drift",
          stripeSubscriptionId: sub.id,
          stripeCustomerId: customerId,
          stripeStatus: sub.status,
          caretipBusinessId: business.id,
          mirrorSubscriptionId: mirror.id,
          mirrorStripeSubscriptionId: mirror.stripeSubscriptionId,
          detectedAt,
        });
      }
    }
  }

  if (orphans.length > 0) {
    logTrialSync("billing_orphan.detected", {
      count: orphans.length,
      kinds: orphans.map((o) => o.kind),
    });
  }

  return orphans.slice(0, limit);
}
