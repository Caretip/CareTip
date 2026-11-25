/**
 * Invoice webhooks in every Stripe payload version, through the real webhook route.
 * Old payloads carry `invoice.subscription`; since 2025-03-31.basil (and 2026-03-25.dahlia, CareTip's
 * account default) it is `invoice.parent.subscription_details.subscription`. Both must reach the same logic.
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:stripe-invoice-webhook-versions
 *
 * Disposable loopback Postgres only. Stripe is never contacted: signatures are local, retrieval is stubbed.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import Stripe from "stripe";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}
const SIGNING = `whsec_test_${randomBytes(16).toString("hex")}`;
process.env.STRIPE_WEBHOOK_SECRET = SIGNING;
process.env.SUBSCRIPTION_BILLING_ENABLED = "true";
process.env.STRIPE_PRICE_PREMIUM_MONTHLY = "price_inv_premium_monthly";
process.env.STRIPE_PRICE_PREMIUM_YEARLY = "price_inv_premium_yearly";

const { prisma } = await import("../src/prisma.js");
const { subscriptionIdFromInvoice } = await import("../src/lib/subscription/invoiceSubscriptionId.js");
const { __setSubscriptionRetrieveFnForTests } = await import("../src/services/subscriptionStripeSync.js");
const router = (await import("../src/webhooks/stripe.webhook.js")).default;

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${err instanceof Error ? err.message.split("\n").slice(0, 4).join(" | ") : String(err)}`);
  }
}

const app = express();
app.use("/api/webhooks", express.raw({ type: "application/json" }), router);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/stripe`;
const signer = new Stripe("sk_test_signing_only_never_used");

const sfx = Date.now().toString(36);
const now = Math.floor(Date.now() / 1000);
let seq = 0;
type Event = { id: string; type: string; [k: string]: unknown };
const evt = (type: string, object: unknown, apiVersion = "2026-03-25.dahlia"): Event => ({
  id: `evt_inv_${sfx}_${++seq}`,
  object: "event",
  type,
  created: now,
  livemode: false,
  api_version: apiVersion,
  data: { object },
});
async function post(event: Event) {
  const payload = JSON.stringify(event);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signer.webhooks.generateTestHeaderString({ payload, secret: SIGNING }),
    },
    body: payload,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

// What Stripe answers "now" for a subscription, and how often it was asked.
const stripeSubs = new Map<string, Stripe.Subscription>();
let retrieveError: Error | null = null;
const retrieved: string[] = [];
__setSubscriptionRetrieveFnForTests(async (id) => {
  retrieved.push(id);
  if (retrieveError) throw retrieveError;
  const s = stripeSubs.get(id);
  if (!s) throw Object.assign(new Error("No such subscription"), { code: "resource_missing", statusCode: 404 });
  return structuredClone(s);
});
const sub = (id: string, businessId: string | null, status: string, extra: object = {}) =>
  ({
    id,
    object: "subscription",
    status,
    customer: `cus_${businessId ?? id}`,
    cancel_at_period_end: false,
    current_period_start: now - 86_400,
    current_period_end: now + 29 * 86_400,
    canceled_at: status === "canceled" ? now : null,
    ended_at: status === "canceled" ? now : null,
    trial_start: null,
    trial_end: null,
    created: now - 86_400,
    metadata: businessId ? { caretipBusinessId: businessId, caretipPlanKey: "premium" } : {},
    items: { data: [{ price: { id: "price_inv_premium_monthly", recurring: { interval: "month" }, metadata: {} } }] },
    ...extra,
  }) as unknown as Stripe.Subscription;

async function premium(tag: string) {
  const user = await prisma.user.create({
    data: { email: `inv-${tag}-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true },
  });
  const b = await prisma.business.create({ data: { name: `Inv ${tag}`, slug: `inv-${tag}-${sfx}`, userId: user.id } });
  const s = sub(`sub_${tag}_${sfx}`, b.id, "active");
  stripeSubs.set(s.id, s);
  const r = await post(evt("customer.subscription.created", s));
  assert.equal(r.status, 200);
  return { b, s };
}
const mirror = (businessId: string) => prisma.subscription.findUniqueOrThrow({ where: { businessId } });
const tier = async (id: string) => (await prisma.business.findUniqueOrThrow({ where: { id } })).subscriptionTier;
const row = (e: Event) => prisma.subscriptionEvent.findUnique({ where: { stripeEventId: e.id } });
const reason = async (e: Event) => ((await row(e))?.payload as { reason?: string } | null)?.reason;
const notices = (invoiceId: string) => prisma.subscriptionBillingNotification.findMany({ where: { stripeInvoiceId: invoiceId } });

const FORMATS: Record<string, { version: string; ref: (id: string) => object }> = {
  "legacy id": { version: "2025-02-24.acacia", ref: (id) => ({ subscription: id }) },
  "legacy expanded": { version: "2025-02-24.acacia", ref: (id) => ({ subscription: { id, object: "subscription" } }) },
  "parent id": {
    version: "2026-03-25.dahlia",
    ref: (id) => ({
      parent: { type: "subscription_details", quote_details: null, subscription_details: { metadata: {}, subscription: id } },
    }),
  },
  "parent expanded": {
    version: "2026-03-25.dahlia",
    ref: (id) => ({
      parent: { type: "subscription_details", subscription_details: { subscription: { id, object: "subscription" } } },
    }),
  },
};
const NO_REFERENCE: Record<string, object> = {
  "no field at all": {},
  "legacy null": { subscription: null },
  "empty string": { subscription: "  " },
  "parent null": { parent: null },
  "parent empty": { parent: {} },
  "subscription_details null": { parent: { type: "subscription_details", subscription_details: null } },
  "subscription_details empty": { parent: { type: "subscription_details", subscription_details: {} } },
  "nested subscription null": { parent: { type: "subscription_details", subscription_details: { subscription: null } } },
  "quote invoice": { parent: { type: "quote_details", quote_details: { quote: "qt_1" }, subscription_details: null } },
  "expanded object without id": { subscription: {} },
  "wrong types": { subscription: 42, parent: "x" },
};

await check("extraction: null-like and non-object input", () => {
  for (const v of [null, undefined, "in_1", 7, []]) assert.equal(subscriptionIdFromInvoice(v), null);
});
await check("extraction: legacy field null falls through to parent", () => {
  assert.equal(subscriptionIdFromInvoice({ subscription: null, ...FORMATS["parent id"]!.ref("sub_x") }), "sub_x");
});

for (const [name, { version, ref }] of Object.entries(FORMATS)) {
  const tag = name.replace(" ", "");
  await check(`${name}: payment_succeeded syncs the renewal`, async () => {
    const { b, s } = await premium(`ok-${tag}`);
    const before = await mirror(b.id);
    stripeSubs.set(s.id, sub(s.id, b.id, "active", { current_period_end: now + 59 * 86_400 }));
    const e = evt("invoice.payment_succeeded", { id: `in_ok_${tag}_${sfx}`, amount_paid: 2900, ...ref(s.id) }, version);
    assert.equal((await post(e)).status, 200);
    const after = await mirror(b.id);
    assert.equal((await row(e))?.processingResult, "processed");
    assert.ok(after.currentPeriodEnd! > before.currentPeriodEnd!, "period moved forward");
    assert.equal(after.status, "active");
    assert.equal(await tier(b.id), "premium");
  });

  await check(`${name}: payment_failed records the failure and one notice; payment clears it`, async () => {
    const { b, s } = await premium(`fail-${tag}`);
    stripeSubs.set(s.id, sub(s.id, b.id, "past_due"));
    const invoice = { id: `in_fail_${tag}_${sfx}`, attempt_count: 1, ...ref(s.id) };
    const e = evt("invoice.payment_failed", invoice, version);
    assert.equal((await post(e)).status, 200);
    assert.equal((await row(e))?.processingResult, "processed");
    assert.equal((await mirror(b.id)).status, "past_due");
    const [n, ...more] = await notices(invoice.id);
    assert.ok(n && more.length === 0, "exactly one notice");
    assert.equal(n.businessId, b.id);
    assert.equal(n.stripeSubscriptionId, s.id);

    // Same event redelivered, then Stripe's next attempt on the same invoice: still one notice.
    const dup = await post(e);
    assert.deepEqual([dup.status, dup.body.duplicate], [200, true]);
    assert.equal((await post(evt("invoice.payment_failed", { ...invoice, attempt_count: 2 }, version))).status, 200);
    assert.equal((await notices(invoice.id)).length, 1);

    await prisma.subscriptionBillingNotification.updateMany({ where: { id: n.id }, data: { status: "failed" } });
    stripeSubs.set(s.id, sub(s.id, b.id, "active"));
    const paid = evt("invoice.payment_succeeded", { id: invoice.id, amount_paid: 2900, ...ref(s.id) }, version);
    assert.equal((await post(paid)).status, 200);
    assert.equal((await mirror(b.id)).status, "active");
    assert.equal((await notices(invoice.id))[0]!.status, "superseded");
  });

  await check(`${name}: final payment failure downgrades to Basic`, async () => {
    const { b, s } = await premium(`final-${tag}`);
    stripeSubs.set(s.id, sub(s.id, b.id, "unpaid"));
    const e = evt("invoice.payment_failed", { id: `in_final_${tag}_${sfx}`, attempt_count: 4, ...ref(s.id) }, version);
    assert.equal((await post(e)).status, 200);
    assert.equal((await row(e))?.processingResult, "processed");
    assert.equal(await tier(b.id), "basic");
  });

  await check(`${name}: duplicate delivery is processed once, also when concurrent`, async () => {
    const { s } = await premium(`dup-${tag}`);
    const e = evt("invoice.payment_succeeded", { id: `in_dup_${tag}_${sfx}`, amount_paid: 2900, ...ref(s.id) }, version);
    const out = await Promise.all([post(e), post(e), post(e)]);
    assert.ok(out.every((r) => r.status === 200 || r.status === 503), out.map((r) => r.status).join());
    assert.equal(out.filter((r) => r.status === 200 && !r.body.duplicate).length, 1);
    assert.equal(await prisma.subscriptionEvent.count({ where: { stripeEventId: e.id } }), 1);
    const again = await post(e);
    assert.deepEqual([again.status, again.body.duplicate], [200, true]);
  });

  await check(`${name}: processing failure is not acknowledged and the retry succeeds`, async () => {
    const { s } = await premium(`retry-${tag}`);
    const e = evt("invoice.payment_succeeded", { id: `in_retry_${tag}_${sfx}`, amount_paid: 2900, ...ref(s.id) }, version);
    retrieveError = Object.assign(new Error("stripe unavailable"), { statusCode: 500, type: "StripeAPIError" });
    const first = await post(e);
    retrieveError = null;
    assert.ok(first.status >= 500, `status ${first.status}`);
    assert.equal((await row(e))?.processingResult, "failed");
    assert.equal((await post(e)).status, 200);
    assert.equal((await row(e))?.processingResult, "processed");
  });

  await check(`${name}: ownership — only the invoice's business changes`, async () => {
    const a = await premium(`own-a-${tag}`);
    const other = await premium(`own-b-${tag}`);
    const before = await mirror(other.b.id);
    stripeSubs.set(a.s.id, sub(a.s.id, a.b.id, "past_due"));
    const invoiceId = `in_own_${tag}_${sfx}`;
    await post(evt("invoice.payment_failed", { id: invoiceId, attempt_count: 1, customer: `cus_${other.b.id}`, ...ref(a.s.id) }, version));
    assert.equal((await mirror(a.b.id)).status, "past_due");
    const after = await mirror(other.b.id);
    assert.deepEqual([after.status, after.stripeSubscriptionId], [before.status, before.stripeSubscriptionId]);
    assert.ok((await notices(invoiceId)).every((n) => n.businessId === a.b.id));
  });

  for (const type of ["invoice.payment_succeeded", "invoice.payment_failed"]) {
    await check(`${name}: ${type} for an unknown subscription changes nothing`, async () => {
      const missing = evt(type, { id: `in_miss_${tag}_${sfx}_${type}`, ...ref(`sub_missing_${tag}_${sfx}`) }, version);
      assert.equal((await post(missing)).status, 200);
      assert.equal(await reason(missing), "stripe_subscription_missing");

      const foreign = sub(`sub_foreign_${tag}_${sfx}`, null, "active");
      stripeSubs.set(foreign.id, foreign);
      const e = evt(type, { id: `in_foreign_${tag}_${sfx}_${type}`, ...ref(foreign.id) }, version);
      assert.equal((await post(e)).status, 200);
      assert.equal(await reason(e), "subscription_row_not_found");
      assert.equal((await row(e))?.processingResult, "ignored");
    });
  }

  await check(`${name}: payment_failed of a replaced subscription is ignored`, async () => {
    const { b, s } = await premium(`super-${tag}`);
    const old = sub(`sub_old_${tag}_${sfx}`, b.id, "past_due");
    stripeSubs.set(old.id, old);
    const e = evt("invoice.payment_failed", { id: `in_super_${tag}_${sfx}`, attempt_count: 1, ...ref(old.id) }, version);
    assert.equal((await post(e)).status, 200);
    assert.equal(await reason(e), "superseded_subscription");
    assert.deepEqual([(await mirror(b.id)).status, (await mirror(b.id)).stripeSubscriptionId], ["active", s.id]);
  });
}

for (const [name, shape] of Object.entries(NO_REFERENCE)) {
  await check(`no subscription (${name}): both events acknowledged and ignored, Stripe not asked`, async () => {
    assert.equal(subscriptionIdFromInvoice({ id: "in_x", ...shape }), null);
    const asked = retrieved.length;
    for (const type of ["invoice.payment_succeeded", "invoice.payment_failed"]) {
      const e = evt(type, { id: `in_none_${sfx}_${seq}`, ...shape });
      assert.equal((await post(e)).status, 200);
      assert.equal(await reason(e), "no_subscription_on_invoice");
      assert.equal((await row(e))?.processingResult, "ignored");
    }
    assert.equal(retrieved.length, asked);
  });
}

await check("unrelated invoice events are acknowledged without any processing", async () => {
  const { b, s } = await premium("unrelated");
  stripeSubs.set(s.id, sub(s.id, b.id, "canceled"));
  const asked = retrieved.length;
  for (const type of ["invoice.created", "invoice.finalized", "invoice.paid", "invoice.upcoming", "invoice.voided"]) {
    const e = evt(type, { id: `in_unrel_${sfx}`, ...FORMATS["parent id"]!.ref(s.id) });
    const r = await post(e);
    assert.deepEqual([r.status, r.body.ignored], [200, true], type);
    assert.equal(await row(e), null);
  }
  assert.equal(retrieved.length, asked);
  assert.equal((await mirror(b.id)).status, "active");
});

await check("an invalid signature is refused in both formats", async () => {
  for (const name of ["legacy id", "parent id"]) {
    const e = evt("invoice.payment_failed", { id: `in_sig_${sfx}`, ...FORMATS[name]!.ref("sub_x") });
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=00" },
      body: JSON.stringify(e),
    });
    assert.equal(res.status, 400);
    assert.equal(await row(e), null);
  }
});

server.close();
await prisma.$disconnect();
console.log(`\nstripe-invoice-webhook-versions: ${passed}/${passed + failures.length} passed`);
process.exit(failures.length ? 1 : 0);
