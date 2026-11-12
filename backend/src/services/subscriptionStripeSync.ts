/**
 * Authoritative Stripe → CareTip subscription mirror synchronization.
 *
 * Stripe does not deliver webhook events in order, and an event's `data.object` is a snapshot from
 * when the event was created. A mirror write must therefore never be based on that snapshot:
 *
 *   1. take the per-business sync lease (database row; serializes every instance), then
 *   2. retrieve the subscription from Stripe *inside* the lease, then
 *   3. write the mirror from that state.
 *
 * Because each writer reads Stripe after acquiring the lease, the last writer always applies state at
 * least as new as any earlier writer's. A stale `customer.subscription.updated` after `deleted`, or a
 * late `invoice.payment_succeeded` after cancellation, re-reads "canceled" and cannot restore access.
 */
import type Stripe from "stripe";
import { getStripeClient } from "./stripe.service.js";
import { withPaymentOperationLease } from "../lib/payments/operationLease.js";

export const SUBSCRIPTION_SYNC_LEASE_TTL_MS = 60_000;
export const SUBSCRIPTION_SYNC_LEASE_WAIT_MS = 12_000;

type RetrieveFn = (id: string) => Promise<Stripe.Subscription>;
let retrieveFnForTests: RetrieveFn | null = null;

/** Test seam — mocked subscriptions.retrieve for every mirror sync path. */
export function __setSubscriptionRetrieveFnForTests(fn: RetrieveFn | null): void {
  retrieveFnForTests = fn;
}

function isMissingResource(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number } | null;
  return e?.code === "resource_missing" || e?.statusCode === 404;
}

/** Current subscription from Stripe; "missing" when Stripe no longer has it. Other errors throw. */
export async function retrieveStripeSubscriptionAuthoritative(
  stripeSubscriptionId: string,
): Promise<Stripe.Subscription | "missing"> {
  try {
    if (retrieveFnForTests) return await retrieveFnForTests(stripeSubscriptionId);
    return await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
  } catch (err) {
    if (isMissingResource(err)) return "missing";
    throw err;
  }
}

/** Serializes mirror writes for one business across all instances. */
export async function withSubscriptionSyncLease<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  return withPaymentOperationLease(
    `subscription_sync:${businessId}`,
    { ttlMs: SUBSCRIPTION_SYNC_LEASE_TTL_MS, waitMs: SUBSCRIPTION_SYNC_LEASE_WAIT_MS },
    () => fn(),
  );
}
