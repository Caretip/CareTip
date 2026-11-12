/**
 * One "backend instance" for payment-integrity-multi-instance-runtime.ts. Runs a single payment
 * operation against the shared disposable database with Stripe stubbed in-process, then prints one
 * JSON line. Spawned only by the runtime (inherits its isolated environment).
 */
import { readFileSync } from "node:fs";
import type Stripe from "stripe";
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

await completeIsolatedPostgresBootstrap();
const spec = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as {
  action: "qr_checkout" | "customer" | "subscription_sync" | "refund_op";
  businessId: string;
  userId?: string;
  orderId?: string;
  operationId?: string;
  stripeSubscriptionId?: string;
  /** subscription_sync: what Stripe returns to this instance, and how slowly. */
  stripeStatus?: string;
  retrieveDelayMs?: number;
  startDelayMs?: number;
};
process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
process.env.STRIPE_PRICE_PREMIUM_MONTHLY = "price_mi_premium_monthly";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripeSvc = await import("../src/services/stripe.service.js");
const stripe = stripeSvc.getStripeClient() as unknown as {
  customers: Record<string, unknown>;
  checkout: { sessions: Record<string, unknown> };
};
let creates = 0;

async function run(): Promise<Record<string, unknown>> {
  if (spec.startDelayMs) await sleep(spec.startDelayMs);
  if (spec.action === "qr_checkout") {
    stripe.checkout.sessions.create = async () => {
      creates += 1;
      await sleep(400);
      return { id: `cs_mi_${process.pid}`, status: "open", url: "https://checkout.stripe.test/mi", amount_total: 0, currency: "eur", expires_at: Math.floor(Date.now() / 1000) + 86_400 };
    };
    // Another instance's session, as Stripe would return it: open, for the order's stored total.
    stripe.checkout.sessions.retrieve = async (id: string) => {
      const { prisma } = await import("../src/prisma.js");
      const o = await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: spec.orderId! }, select: { totalAmount: true } });
      return { id, status: "open", url: "https://checkout.stripe.test/mi", amount_total: o.totalAmount, currency: "eur", expires_at: Math.floor(Date.now() / 1000) + 86_400 };
    };
    stripe.checkout.sessions.expire = async (id: string) => ({ id, status: "expired" });
    const { createPhysicalQrBatchCheckoutSession } = await import("../src/services/physicalQr/physicalQrBatch.service.js");
    try {
      const r = await createPhysicalQrBatchCheckoutSession({ businessId: spec.businessId, userId: spec.userId!, orderId: spec.orderId! });
      return { ok: true, sessionId: r.sessionId, reused: r.reused ?? false };
    } catch (err) {
      return { ok: false, code: (err as { code?: string }).code ?? String(err) };
    }
  }
  if (spec.action === "customer") {
    stripe.customers.create = async () => {
      creates += 1;
      await sleep(400);
      return { id: `cus_mi_${process.pid}`, object: "customer", metadata: { caretipBusinessId: spec.businessId } };
    };
    stripe.customers.search = async () => ({ data: [] });
    const { ensureStripeCustomerForBusiness } = await import("../src/services/stripeBilling.service.js");
    try {
      const id = await ensureStripeCustomerForBusiness({ businessId: spec.businessId, email: "mi@example.com", businessName: "MI" });
      return { ok: true, customerId: id };
    } catch (err) {
      return { ok: false, code: (err as { code?: string }).code ?? String(err) };
    }
  }
  if (spec.action === "subscription_sync") {
    const now = Math.floor(Date.now() / 1000);
    const sub = {
      id: spec.stripeSubscriptionId!, object: "subscription", status: spec.stripeStatus!, customer: `cus_mi_${spec.businessId}`,
      cancel_at_period_end: false, current_period_start: now - 86_400, current_period_end: now + 29 * 86_400,
      canceled_at: spec.stripeStatus === "canceled" ? now : null, ended_at: null, trial_start: null, trial_end: null, created: now - 86_400,
      metadata: { caretipBusinessId: spec.businessId, caretipPlanKey: "premium" },
      items: { data: [{ price: { id: "price_mi_premium_monthly", recurring: { interval: "month" }, metadata: {} } }] },
    } as unknown as Stripe.Subscription;
    const { __setSubscriptionRetrieveFnForTests } = await import("../src/services/subscriptionStripeSync.js");
    __setSubscriptionRetrieveFnForTests(async () => {
      await sleep(spec.retrieveDelayMs ?? 0);
      return sub;
    });
    const { activateSubscriptionMirrorFromStripeSubscription } = await import("../src/services/subscriptionActivation.service.js");
    const outcome = await activateSubscriptionMirrorFromStripeSubscription({
      businessId: spec.businessId, sub, auditType: "subscription_updated" as never,
      stripeEventId: `evt_mi_${process.pid}_${Date.now()}`, source: "webhook_subscription_updated",
    });
    return { ok: true, outcome, appliedAt: Date.now() };
  }
  // refund_op
  stripeSvc.__setRefundsCreateFnForTests(async () => {
    creates += 1;
    await sleep(300);
    return { id: `re_mi_${process.pid}`, status: "succeeded" } as Stripe.Refund;
  });
  const { executeRefundOperation } = await import("../src/services/payments/refundOperations.service.js");
  await executeRefundOperation(spec.operationId!);
  return { ok: true };
}

const result = await run();
console.log(`MI_RESULT ${JSON.stringify({ pid: process.pid, creates, ...result })}`);
const { prisma } = await import("../src/prisma.js");
await prisma.$disconnect();
