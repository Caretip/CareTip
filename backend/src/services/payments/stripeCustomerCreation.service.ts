/**
 * Creating a business's Stripe customer at most once, with recovery from every interruption.
 *
 * State lives in `stripe_customer_creations` (one row per business), written BEFORE Stripe is called:
 *
 *   creating  the request was (or is about to be) sent; Stripe may or may not have created it
 *   created   Stripe returned the customer id; binding it to the business may not have happened yet
 *   bound     businesses.stripe_customer_id holds it
 *
 * Recovery, under the per-business database lease (all instances serialize):
 * - "created": re-bind the recorded id (after checking it is ours and not deleted). No Stripe create.
 * - "creating", younger than Stripe's idempotency window: repeat the identical request with the same
 *   idempotency key; Stripe returns the customer it already created, if any.
 * - "creating", older than the window (key expired): search Stripe for a customer carrying this
 *   business id in metadata; bind it if found; only if none exists, create with a new key generation.
 * - no row (first creation, or a business from before this change): the same metadata search runs
 *   before the first create, so an orphan from an earlier lost write is adopted instead of duplicated.
 *
 * A customer is adopted only if its metadata names this business and it is not deleted, so another
 * business's customer can never be attached. When several match, the oldest is bound and the others are
 * recorded as discrepancies (never deleted).
 */
import type Stripe from "stripe";
import { createHash } from "node:crypto";
import { prisma } from "../../prisma.js";
import { getStripeClient } from "../stripe.service.js";
import { BILLING_CHECKOUT_METADATA_KEYS } from "../../lib/subscription/subscriptionAuditTypes.js";
import { PaymentOperationBusyError, withPaymentOperationLease } from "../../lib/payments/operationLease.js";
import { recordPaymentDiscrepancy } from "./paymentDiscrepancy.service.js";

const LEASE_TTL_MS = 60_000;
const LEASE_WAIT_MS = 10_000;
/** Stripe retains idempotency keys for 24h; stay inside that with a margin. */
export const STRIPE_CUSTOMER_IDEMPOTENCY_SAFE_MS = 23 * 60 * 60_000;

export class StripeCustomerSetupBusyError extends Error {
  constructor() {
    super("Billing is being set up for this business. Please try again in a moment.");
  }
}

/** Deterministic key for the first creation attempt of a business (generation 0). */
export function stripeCustomerIdempotencyKey(businessId: string, email: string, name: string): string {
  const digest = createHash("sha256").update(JSON.stringify([email.trim().toLowerCase(), name.trim()])).digest("hex");
  return `caretip_customer_${businessId}_${digest.slice(0, 16)}`;
}

function keyFor(op: { idempotencyKey: string; keyGeneration: number }): string {
  return op.keyGeneration === 0 ? op.idempotencyKey : `${op.idempotencyKey}:g${op.keyGeneration}`;
}

function belongsTo(customer: Stripe.Customer | Stripe.DeletedCustomer, businessId: string): customer is Stripe.Customer {
  return !("deleted" in customer && customer.deleted) && (customer as Stripe.Customer).metadata?.[BILLING_CHECKOUT_METADATA_KEYS.businessId] === businessId;
}

/** Customers whose metadata names this business (search API; email listing as a fallback). Oldest first. */
async function findCustomersForBusiness(businessId: string, email: string): Promise<Stripe.Customer[]> {
  const stripe = getStripeClient();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(businessId)) return [];
  let found: Stripe.Customer[] = [];
  try {
    const res = await stripe.customers.search({
      query: `metadata['${BILLING_CHECKOUT_METADATA_KEYS.businessId}']:'${businessId}'`,
      limit: 20,
    });
    found = res.data;
  } catch (err) {
    // Search is not available on every account/region. Fall back to the customers with this email.
    const e = err as { type?: string; statusCode?: number };
    if (e?.type !== "StripeInvalidRequestError" && e?.statusCode !== 400 && e?.statusCode !== 404) throw err;
    const res = await stripe.customers.list({ email, limit: 100 });
    found = res.data;
  }
  return found.filter((c) => belongsTo(c, businessId)).sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
}

async function readStoredCustomerId(businessId: string): Promise<string | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { stripeCustomerId: true, subscription: { select: { stripeCustomerId: true } } },
  });
  const existing = business?.stripeCustomerId ?? business?.subscription?.stripeCustomerId ?? null;
  if (existing && !business?.stripeCustomerId) {
    await prisma.business.updateMany({ where: { id: businessId, stripeCustomerId: null }, data: { stripeCustomerId: existing } });
  }
  return existing;
}

/** Compare-and-set bind; returns the id the business ends up with. */
async function bind(businessId: string, customerId: string): Promise<string> {
  const bound = await prisma.business.updateMany({ where: { id: businessId, stripeCustomerId: null }, data: { stripeCustomerId: customerId } });
  let finalId = customerId;
  if (bound.count !== 1) {
    const winner = await readStoredCustomerId(businessId);
    if (winner && winner !== customerId) {
      await recordPaymentDiscrepancy({
        workflow: "subscription",
        kind: "orphan_stripe_customer",
        subjectKey: `stripe_customer:${customerId}`,
        businessId,
        details: { boundCustomerId: winner, orphanCustomerId: customerId },
      });
      finalId = winner;
    }
  }
  await prisma.subscription.updateMany({ where: { businessId, stripeCustomerId: null }, data: { stripeCustomerId: finalId } });
  await prisma.stripeCustomerCreation.updateMany({ where: { businessId }, data: { status: "bound", stripeCustomerId: finalId } });
  return finalId;
}

async function adopt(businessId: string, matches: Stripe.Customer[]): Promise<string> {
  const [keep, ...extra] = matches;
  for (const orphan of extra) {
    await recordPaymentDiscrepancy({
      workflow: "subscription",
      kind: "orphan_stripe_customer",
      subjectKey: `stripe_customer:${orphan.id}`,
      businessId,
      details: { boundCustomerId: keep!.id, orphanCustomerId: orphan.id, source: "metadata_search" },
    });
  }
  await prisma.stripeCustomerCreation.updateMany({ where: { businessId }, data: { status: "created", stripeCustomerId: keep!.id } });
  return bind(businessId, keep!.id);
}

export async function ensureStripeCustomerCreated(params: { businessId: string; email: string; businessName: string }): Promise<string> {
  const fast = await readStoredCustomerId(params.businessId);
  if (fast) return fast;
  try {
    return await withPaymentOperationLease(`stripe_customer:${params.businessId}`, { ttlMs: LEASE_TTL_MS, waitMs: LEASE_WAIT_MS }, () =>
      ensureLocked(params),
    );
  } catch (err) {
    if (err instanceof PaymentOperationBusyError) throw new StripeCustomerSetupBusyError();
    throw err;
  }
}

async function ensureLocked(params: { businessId: string; email: string; businessName: string }): Promise<string> {
  const { businessId } = params;
  const inside = await readStoredCustomerId(businessId);
  if (inside) return inside;
  const stripe = getStripeClient();

  let op = await prisma.stripeCustomerCreation.findUnique({ where: { businessId } });

  // Stripe answered earlier but the bind was lost: bind what Stripe returned (if it is still ours).
  if (op?.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(op.stripeCustomerId);
      if (belongsTo(existing, businessId)) return bind(businessId, existing.id);
    } catch (err) {
      if ((err as { code?: string }).code !== "resource_missing") throw err;
    }
    await prisma.stripeCustomerCreation.update({ where: { businessId }, data: { stripeCustomerId: null, status: "creating" } });
    op = await prisma.stripeCustomerCreation.findUniqueOrThrow({ where: { businessId } });
  }

  // startedAt = when the current key generation was first used (Stripe's 24h window runs from there).
  const keyStillDeduplicated = op ? Date.now() - op.startedAt.getTime() < STRIPE_CUSTOMER_IDEMPOTENCY_SAFE_MS : false;
  if (!op || !keyStillDeduplicated) {
    // First creation, or an interruption older than Stripe's idempotency window: look before creating.
    const matches = await findCustomersForBusiness(businessId, op?.email ?? params.email);
    if (matches.length) {
      if (!op) {
        await prisma.stripeCustomerCreation.create({
          data: {
            businessId, status: "created", idempotencyKey: stripeCustomerIdempotencyKey(businessId, params.email, params.businessName),
            email: params.email, name: params.businessName, stripeCustomerId: matches[0]!.id,
          },
        });
      }
      return adopt(businessId, matches);
    }
    if (op) {
      // Nothing exists at Stripe for this business: a fresh key is safe now.
      op = await prisma.stripeCustomerCreation.update({
        where: { businessId },
        data: { keyGeneration: { increment: 1 }, startedAt: new Date() },
      });
    }
  }

  if (!op) {
    op = await prisma.stripeCustomerCreation.create({
      data: {
        businessId,
        status: "creating",
        idempotencyKey: stripeCustomerIdempotencyKey(businessId, params.email, params.businessName),
        email: params.email,
        name: params.businessName,
      },
    });
  }

  await prisma.stripeCustomerCreation.update({ where: { businessId }, data: { attempts: { increment: 1 }, status: "creating" } });
  let customer: Stripe.Customer;
  try {
    // Same parameters as the first attempt (stored), so a retry matches Stripe's idempotent request.
    customer = await stripe.customers.create(
      { email: op.email, name: op.name, metadata: { [BILLING_CHECKOUT_METADATA_KEYS.businessId]: businessId } },
      { idempotencyKey: keyFor(op) },
    );
  } catch (err) {
    await prisma.stripeCustomerCreation.update({
      where: { businessId },
      data: { lastErrorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
    });
    throw err;
  }
  await prisma.stripeCustomerCreation.update({ where: { businessId }, data: { status: "created", stripeCustomerId: customer.id, lastErrorMessage: null } });
  return bind(businessId, customer.id);
}
