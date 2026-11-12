/**
 * Subscription payment integrity (audit H3, H4, M5, L1 — 2026-11-11).
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:payment-integrity-subscription
 *
 * Disposable loopback Postgres only. Stripe is never contacted: every Stripe call is stubbed.
 */
import assert from "node:assert/strict";
import type Stripe from "stripe";

process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
process.env.STRIPE_PRICE_PREMIUM_MONTHLY = "price_int_premium_monthly";
process.env.STRIPE_PRICE_PREMIUM_YEARLY = "price_int_premium_yearly";

const { prisma } = await import("../src/prisma.js");
const { __setCheckoutSessionsCreateFnForTests, getStripeClient } = await import("../src/services/stripe.service.js");
const { __setSubscriptionRetrieveFnForTests } = await import("../src/services/subscriptionStripeSync.js");
const { __setListStripeSubscriptionsForCustomerForTests } = await import("../src/services/billingLifecycleIntegrity.service.js");
const {
  handleStripeBillingWebhookEvent,
  replayDeferredBillingEvents,
  __setRetrieveStripeEventFnForTests,
} = await import("../src/services/stripeBillingWebhook.service.js");
const { activateSubscriptionMirrorFromStripeSubscription } = await import("../src/services/subscriptionActivation.service.js");
const {
  createPlatformSubscriptionCheckoutSession,
  ensureStripeCustomerForBusiness,
  billingCheckoutIdempotencyKey,
} = await import("../src/services/stripeBilling.service.js");
const { BillingCheckoutBlockedError } = await import("../src/services/billingCheckoutGuard.service.js");

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${err instanceof Error ? (err.stack ?? err.message).split("\n").slice(0, 3).join(" | ") : String(err)}`);
  }
}

const sfx = Date.now().toString(36);
const now = Math.floor(Date.now() / 1000);

// ── Stripe: subscription state (what subscriptions.retrieve returns "now") ──
const stripeSubs = new Map<string, Stripe.Subscription | "missing">();
let retrieveHook: ((id: string) => Promise<void>) | null = null;
__setSubscriptionRetrieveFnForTests(async (id) => {
  if (retrieveHook) await retrieveHook(id);
  const s = stripeSubs.get(id);
  if (!s || s === "missing") throw Object.assign(new Error("No such subscription"), { code: "resource_missing", statusCode: 404 });
  return structuredClone(s);
});
function sub(id: string, businessId: string, status: string, extra: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id,
    object: "subscription",
    status,
    customer: `cus_${businessId}`,
    cancel_at_period_end: false,
    current_period_start: now - 86_400,
    current_period_end: now + 29 * 86_400,
    canceled_at: status === "canceled" ? now : null,
    ended_at: status === "canceled" ? now : null,
    trial_start: null,
    trial_end: null,
    created: now - 86_400,
    metadata: { caretipBusinessId: businessId, caretipPlanKey: "premium" },
    items: { data: [{ price: { id: "price_int_premium_monthly", recurring: { interval: "month" }, metadata: {} } }] },
    ...extra,
  } as unknown as Stripe.Subscription;
}
let evtSeq = 0;
function event(type: string, object: unknown): Stripe.Event {
  evtSeq += 1;
  return { id: `evt_int_${sfx}_${evtSeq}`, type, created: now, livemode: false, data: { object } } as unknown as Stripe.Event;
}

async function newBusiness(tag: string) {
  const user = await prisma.user.create({
    data: { email: `sub-int-${tag}-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true },
  });
  return prisma.business.create({ data: { name: `Sub ${tag}`, slug: `sub-${tag}-${sfx}`, userId: user.id } });
}
const mirror = (businessId: string) => prisma.subscription.findUnique({ where: { businessId } });
const tier = async (businessId: string) => (await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).subscriptionTier;

/** Active Premium mirror via a real subscription.created event. */
async function activePremium(tag: string) {
  const b = await newBusiness(tag);
  const s = sub(`sub_${tag}_${sfx}`, b.id, "active");
  stripeSubs.set(s.id, s);
  await handleStripeBillingWebhookEvent(event("customer.subscription.created", s));
  return { b, s };
}

// ── H3: authoritative, ordered synchronization ──
await check("S1 normal subscription.created → Premium mirror", async () => {
  const { b, s } = await activePremium("s1");
  const m = await mirror(b.id);
  assert.equal(m?.planKey, "premium");
  assert.equal(m?.status, "active");
  assert.equal(m?.stripeSubscriptionId, s.id);
  assert.equal(await tier(b.id), "premium");
});

await check("S2 late invoice.payment_succeeded after cancellation does not restore Premium", async () => {
  const { b, s } = await activePremium("s2");
  stripeSubs.set(s.id, sub(s.id, b.id, "canceled"));
  await handleStripeBillingWebhookEvent(event("customer.subscription.deleted", sub(s.id, b.id, "canceled")));
  assert.equal(await tier(b.id), "basic");
  await handleStripeBillingWebhookEvent(event("invoice.payment_succeeded", { id: `in_s2_${sfx}`, subscription: s.id, amount_paid: 2900 }));
  const m = await mirror(b.id);
  assert.equal(await tier(b.id), "basic", "tier stays basic");
  assert.notEqual(m?.planKey, "premium");
});

await check("S3 stale subscription.updated(active) after deleted does not re-entitle", async () => {
  const { b, s } = await activePremium("s3");
  stripeSubs.set(s.id, sub(s.id, b.id, "canceled"));
  await handleStripeBillingWebhookEvent(event("customer.subscription.deleted", sub(s.id, b.id, "canceled")));
  // The stale event snapshot still says "active"; Stripe now says canceled.
  await handleStripeBillingWebhookEvent(event("customer.subscription.updated", sub(s.id, b.id, "active")));
  const m = await mirror(b.id);
  assert.equal(await tier(b.id), "basic");
  assert.equal(m?.planKey, "basic");
  assert.equal(m?.stripeSubscriptionId, null);
});

await check("S4 successful renewal keeps Premium and records the invoice", async () => {
  const { b, s } = await activePremium("s4");
  stripeSubs.set(s.id, sub(s.id, b.id, "active", { current_period_end: now + 59 * 86_400 }));
  const e = event("invoice.payment_succeeded", { id: `in_s4_${sfx}`, subscription: s.id, amount_paid: 2900 });
  await handleStripeBillingWebhookEvent(e);
  const m = await mirror(b.id);
  assert.equal(m?.status, "active");
  assert.equal(await tier(b.id), "premium");
  const row = await prisma.subscriptionEvent.findUnique({ where: { stripeEventId: e.id } });
  assert.equal(row?.processingResult, "processed");
  assert.equal((row?.payload as { amountPaid?: number })?.amountPaid, 2900);
});

await check("S5 failed renewal: past_due keeps access (product rule); unpaid ends it", async () => {
  const { b, s } = await activePremium("s5");
  stripeSubs.set(s.id, sub(s.id, b.id, "past_due"));
  await handleStripeBillingWebhookEvent(event("invoice.payment_failed", { id: `in_s5_${sfx}`, subscription: s.id, attempt_count: 1 }));
  assert.equal((await mirror(b.id))?.status, "past_due");
  assert.equal(await tier(b.id), "premium");
  stripeSubs.set(s.id, sub(s.id, b.id, "unpaid"));
  await handleStripeBillingWebhookEvent(event("invoice.payment_failed", { id: `in_s5b_${sfx}`, subscription: s.id, attempt_count: 4 }));
  assert.equal(await tier(b.id), "basic");
});

await check("S6 failed initial invoice (incomplete) never grants Premium", async () => {
  const b = await newBusiness("s6");
  const s = sub(`sub_s6_${sfx}`, b.id, "incomplete");
  stripeSubs.set(s.id, s);
  await handleStripeBillingWebhookEvent(event("customer.subscription.created", s));
  // Even if a late success event carries an "active" snapshot, Stripe's current state wins.
  await handleStripeBillingWebhookEvent(event("customer.subscription.updated", sub(s.id, b.id, "active")));
  assert.notEqual(await tier(b.id), "premium");
});

await check("S7 cancel at period end keeps access until the period ends", async () => {
  const { b, s } = await activePremium("s7");
  stripeSubs.set(s.id, sub(s.id, b.id, "active", { cancel_at_period_end: true }));
  await handleStripeBillingWebhookEvent(event("customer.subscription.updated", sub(s.id, b.id, "active", { cancel_at_period_end: true })));
  const m = await mirror(b.id);
  assert.equal(m?.cancelAtPeriodEnd, true);
  assert.equal(await tier(b.id), "premium");
});

await check("S8 expiration (deleted, Stripe resource missing) ends access", async () => {
  const { b, s } = await activePremium("s8");
  stripeSubs.set(s.id, "missing");
  await handleStripeBillingWebhookEvent(event("customer.subscription.deleted", sub(s.id, b.id, "canceled")));
  assert.equal(await tier(b.id), "basic");
});

await check("S9 events for a replaced (older) subscription do not end the current one", async () => {
  const { b, s } = await activePremium("s9");
  const old = `sub_s9_old_${sfx}`;
  stripeSubs.set(old, sub(old, b.id, "canceled"));
  await handleStripeBillingWebhookEvent(event("customer.subscription.deleted", sub(old, b.id, "canceled")));
  const m = await mirror(b.id);
  assert.equal(m?.stripeSubscriptionId, s.id);
  assert.equal(await tier(b.id), "premium");
});

await check("S10 concurrent writers: a slower, older read cannot overwrite a newer state", async () => {
  const { b, s } = await activePremium("s10");
  let calls = 0;
  // The first retrieve is slow and returns the old "active" state; the second, later, returns canceled.
  retrieveHook = async () => {
    calls += 1;
    if (calls === 1) await new Promise((r) => setTimeout(r, 600));
  };
  const activeSnap = sub(s.id, b.id, "active");
  stripeSubs.set(s.id, activeSnap);
  const first = activateSubscriptionMirrorFromStripeSubscription({
    businessId: b.id, sub: activeSnap, auditType: "subscription_updated" as never, stripeEventId: `evt_s10a_${sfx}`, source: "webhook_subscription_updated",
  });
  await new Promise((r) => setTimeout(r, 100));
  setTimeout(() => stripeSubs.set(s.id, sub(s.id, b.id, "canceled")), 200);
  await new Promise((r) => setTimeout(r, 250));
  const second = activateSubscriptionMirrorFromStripeSubscription({
    businessId: b.id, sub: activeSnap, auditType: "subscription_deleted" as never, stripeEventId: `evt_s10b_${sfx}`, source: "webhook_subscription_deleted",
  });
  await Promise.all([first, second]);
  retrieveHook = null;
  assert.equal(await tier(b.id), "basic", "final state is Stripe's latest (canceled)");
});

// ── H4 / M5: checkout keys, single open session, customer creation ──
type Created = { key: string; paramsJson: string; session: Stripe.Checkout.Session };
const byKey = new Map<string, Created>();
const createLog: Array<{ key?: string; price?: string }> = [];
const checkoutSessions = new Map<string, Stripe.Checkout.Session>();
__setCheckoutSessionsCreateFnForTests(async (params, options) => {
  const key = options?.idempotencyKey ?? "";
  createLog.push({ key, price: (params.line_items?.[0] as { price?: string })?.price });
  await new Promise((r) => setTimeout(r, 60));
  const paramsJson = JSON.stringify(params);
  const cached = byKey.get(key);
  if (cached) {
    if (cached.paramsJson !== paramsJson) {
      // Stripe's documented behaviour for reusing a key with different parameters.
      throw Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters they were first used with."), { type: "StripeIdempotencyError", statusCode: 400 });
    }
    return checkoutSessions.get(cached.session.id)!;
  }
  const session = {
    id: `cs_bill_${sfx}_${checkoutSessions.size + 1}`,
    object: "checkout.session",
    mode: "subscription",
    status: "open",
    url: "https://checkout.stripe.test/bill",
    customer: params.customer,
    metadata: params.metadata,
  } as unknown as Stripe.Checkout.Session;
  checkoutSessions.set(session.id, session);
  byKey.set(key, { key, paramsJson, session });
  return session;
});
__setListStripeSubscriptionsForCustomerForTests(async () => []);
const stripe = getStripeClient() as unknown as { customers: Record<string, unknown>; checkout: { sessions: Record<string, unknown> } };
stripe.checkout.sessions.list = async (q: { customer?: string }) => ({
  data: [...checkoutSessions.values()].filter((s) => s.customer === q.customer && s.status === "open"),
});
const expired: string[] = [];
stripe.checkout.sessions.expire = async (id: string) => {
  expired.push(id);
  const s = checkoutSessions.get(id)!;
  (s as { status: string }).status = "expired";
  return s;
};
const customerKeys = new Map<string, string>();
let customerCreates = 0;
const customerMeta = new Map<string, Record<string, string>>();
stripe.customers.create = async (params: { metadata?: Record<string, string> }, options?: { idempotencyKey?: string }) => {
  customerCreates += 1;
  await new Promise((r) => setTimeout(r, 150));
  const key = options?.idempotencyKey ?? `none_${customerCreates}`;
  if (!customerKeys.has(key)) customerKeys.set(key, `cus_int_${sfx}_${customerKeys.size + 1}`);
  const id = customerKeys.get(key)!;
  customerMeta.set(id, params.metadata ?? {});
  return { id, object: "customer", metadata: params.metadata ?? {} };
};
// Customer search/retrieve (used before a first create and to re-bind after a lost write).
stripe.customers.search = async () => ({ data: [] });
stripe.customers.retrieve = async (id: string) => ({ id, object: "customer", metadata: customerMeta.get(id) ?? {} });

const checkoutFor = (businessId: string, billingCycle: "monthly" | "yearly") =>
  createPlatformSubscriptionCheckoutSession({
    businessId, managerEmail: `m-${businessId}@example.com`, businessName: "Biz", planKey: "premium", billingCycle,
  });

await check("K1 monthly then yearly within 24h both succeed (distinct keys, no Stripe idempotency error)", async () => {
  const b = await newBusiness("k1");
  createLog.length = 0;
  const monthly = await checkoutFor(b.id, "monthly");
  const yearly = await checkoutFor(b.id, "yearly");
  assert.notEqual(monthly.sessionId, yearly.sessionId);
  assert.equal(createLog.length, 2);
  assert.notEqual(createLog[0]!.key, createLog[1]!.key);
  assert.ok(createLog[0]!.key!.startsWith(`caretip_billing_checkout_${b.id}_`));
  assert.ok(expired.includes(monthly.sessionId), "the earlier session is expired: only one can be completed");
});

await check("K2 same request retried → same key → same session", async () => {
  const b = await newBusiness("k2");
  const a = await checkoutFor(b.id, "monthly");
  const again = await checkoutFor(b.id, "monthly");
  assert.equal(again.sessionId, a.sessionId);
});

await check("K3 new checkout after the cached session completed/expired → chained key, new session", async () => {
  const b = await newBusiness("k3");
  const a = await checkoutFor(b.id, "monthly");
  (checkoutSessions.get(a.sessionId)! as { status: string }).status = "expired";
  createLog.length = 0;
  const next = await checkoutFor(b.id, "monthly");
  assert.notEqual(next.sessionId, a.sessionId);
  const fp = createLog[0]!.key!.slice(`caretip_billing_checkout_${b.id}_`.length);
  assert.equal(createLog.at(-1)!.key, billingCheckoutIdempotencyKey(b.id, fp, a.sessionId));
});

await check("K4 concurrent requests (same and different cycles) never error and leave one open session", async () => {
  const b = await newBusiness("k4");
  const results = await Promise.allSettled([checkoutFor(b.id, "monthly"), checkoutFor(b.id, "monthly"), checkoutFor(b.id, "yearly")]);
  assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results.map((r) => (r.status === "rejected" ? String(r.reason) : "ok"))));
  const cust = (await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).stripeCustomerId;
  const open = [...checkoutSessions.values()].filter((s) => s.customer === cust && s.status === "open");
  assert.equal(open.length, 1, `open sessions: ${open.length}`);
});

await check("K5 existing entitled subscription still blocks a new checkout", async () => {
  const { b } = await activePremium("k5");
  await assert.rejects(checkoutFor(b.id, "monthly"), (err: unknown) => err instanceof BillingCheckoutBlockedError);
});

await check("M5 concurrent first-time customer creation → one Stripe customer, bound once", async () => {
  const b = await newBusiness("m5");
  customerCreates = 0;
  const ids = await Promise.all(
    Array.from({ length: 5 }, () => ensureStripeCustomerForBusiness({ businessId: b.id, email: "owner@example.com", businessName: "Biz" })),
  );
  assert.equal(new Set(ids).size, 1);
  assert.equal(customerCreates, 1, `customers.create calls: ${customerCreates}`);
  assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).stripeCustomerId, ids[0]);
});

await check("M5b DB write lost after Stripe created the customer → retry returns the same customer", async () => {
  const b = await newBusiness("m5b");
  const first = await ensureStripeCustomerForBusiness({ businessId: b.id, email: "o@example.com", businessName: "Biz" });
  await prisma.business.update({ where: { id: b.id }, data: { stripeCustomerId: null } }); // simulate the lost write
  const retry = await ensureStripeCustomerForBusiness({ businessId: b.id, email: "o@example.com", businessName: "Biz" });
  assert.equal(retry, first, "Stripe idempotency key returns the original customer");
});

// ── L1: billing disabled → deferred, replayed later, never duplicated ──
await check("L1 events while billing is disabled are kept and replayed once enabled", async () => {
  const b = await newBusiness("l1");
  const s = sub(`sub_l1_${sfx}`, b.id, "active");
  stripeSubs.set(s.id, s);
  const e = event("customer.subscription.created", s);
  process.env.SUBSCRIPTION_BILLING_ENABLED = "false";
  const r1 = await handleStripeBillingWebhookEvent(e);
  const r2 = await handleStripeBillingWebhookEvent(e); // Stripe redelivery while still disabled
  assert.equal(r1.billingDisabled, true);
  assert.equal(r2.billingDisabled, true);
  assert.equal(await prisma.subscriptionEvent.count({ where: { stripeEventId: e.id } }), 1);
  assert.equal(await mirror(b.id), null, "nothing applied while disabled");
  process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
  __setRetrieveStripeEventFnForTests(async (id) => {
    assert.equal(id, e.id);
    return e;
  });
  const replay = await replayDeferredBillingEvents();
  assert.ok(replay.replayed >= 1);
  assert.equal(await tier(b.id), "premium");
  const row = await prisma.subscriptionEvent.findUnique({ where: { stripeEventId: e.id } });
  assert.equal(row?.processingResult, "processed");
  const again = await replayDeferredBillingEvents();
  assert.equal(again.replayed, 0, "processed events are not replayed again");
  __setRetrieveStripeEventFnForTests(null);
});

__setSubscriptionRetrieveFnForTests(null);
__setCheckoutSessionsCreateFnForTests(null);
__setListStripeSubscriptionsForCustomerForTests(null);
await prisma.$disconnect();
console.log(`\npayment-integrity-subscription: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
