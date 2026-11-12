/**
 * Stripe webhook endpoints over HTTP (audit H5 + webhook-level H1/H2/M1 behaviour).
 * Platform endpoint and Connect endpoint each verify with their own signing secret; events are
 * claimed once across both; business-rule outcomes are acknowledged (no 500 retry loops).
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:stripe-webhook-endpoints
 *
 * Loopback HTTP server only; test-only signing secrets generated here; Stripe is never contacted.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import Stripe from "stripe";

const PLATFORM_SECRET = `whsec_test_platform_${randomBytes(12).toString("hex")}`;
const CONNECT_SECRET = `whsec_test_connect_${randomBytes(12).toString("hex")}`;
process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_SECRET;
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;

const { prisma } = await import("../src/prisma.js");
const { __setPaymentIntentsRetrieveFnForTests } = await import("../src/services/stripe.service.js");
const router = (await import("../src/webhooks/stripe.webhook.js")).default;

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

const app = express();
app.use("/api/webhooks", express.raw({ type: "application/json" }), router);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks`;
const signer = new Stripe("sk_test_signing_only_never_used");

async function post(path: "stripe" | "stripe-connect", event: Record<string, unknown>, secret: string, sigOverride?: string) {
  const payload = JSON.stringify(event);
  const sig = sigOverride ?? signer.webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sig },
    body: payload,
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { text };
  }
  return { status: res.status, body };
}
const sfx = Date.now().toString(36);
let seq = 0;
const evt = (type: string, object: unknown, extra: Record<string, unknown> = {}) => ({
  id: `evt_wh_${sfx}_${++seq}`, object: "event", type, created: Math.floor(Date.now() / 1000), livemode: false,
  api_version: "2024-06-20", data: { object }, ...extra,
});
const claim = (id: string) => prisma.stripeWebhookEvent.findUnique({ where: { id } });

// fixtures
const user = await prisma.user.create({ data: { email: `whe-endpoints-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true } });
const business = await prisma.business.create({ data: { name: `WHE ${sfx}`, slug: `whe-endpoints-${sfx}`, userId: user.id } });
const pis = new Map<string, Partial<Stripe.PaymentIntent>>();
__setPaymentIntentsRetrieveFnForTests(async (id) => ({ id, object: "payment_intent", metadata: {}, latest_charge: null, ...(pis.get(id) ?? {}) }) as Stripe.PaymentIntent);
async function qrOrder(total = 1500, session: string) {
  return prisma.physicalQrOrder.create({
    data: {
      businessId: business.id, userId: user.id, totalAmount: total, currency: "EUR", placedAt: new Date(),
      processingClass: "WITHIN_24_HOURS", processingDeadlineAt: new Date(Date.now() + 86_400_000),
      processingCopySnapshot: {}, businessNameSnapshot: "WH", stripeCheckoutSessionId: session,
    },
  });
}

await check("E1 invalid signature → 400 and nothing processed", async () => {
  const e = evt("refund.updated", { id: `re_e1_${sfx}`, object: "refund", amount: 1, currency: "eur", status: "succeeded", created: 1 });
  const r = await post("stripe", e, PLATFORM_SECRET, "t=1,v1=deadbeef");
  assert.equal(r.status, 400);
  assert.equal(await claim(e.id), null);
});

await check("E2 each endpoint accepts only its own secret (no secret fallback)", async () => {
  const e = evt("refund.updated", { id: `re_e2_${sfx}`, object: "refund", amount: 1, currency: "eur", status: "succeeded", created: 1 });
  assert.equal((await post("stripe", e, CONNECT_SECRET)).status, 400, "platform endpoint rejects the Connect secret");
  const c = evt("account.updated", { id: `acct_e2_${sfx}`, object: "account" }, { account: `acct_e2_${sfx}` });
  assert.equal((await post("stripe-connect", c, PLATFORM_SECRET)).status, 400, "Connect endpoint rejects the platform secret");
});

await check("E3 Connect endpoint ignores events that are not from a connected account", async () => {
  const e = evt("account.updated", { id: `acct_e3_${sfx}`, object: "account" });
  const r = await post("stripe-connect", e, CONNECT_SECRET);
  assert.equal(r.status, 200);
  assert.equal(r.body.ignored, "not_connected_account_event");
  assert.equal(await claim(e.id), null);
});

await check("E4 Connect endpoint processes connected-account events", async () => {
  const e = evt("account.updated", { id: `acct_e4_${sfx}`, object: "account", charges_enabled: false, payouts_enabled: false }, { account: `acct_e4_${sfx}` });
  const r = await post("stripe-connect", e, CONNECT_SECRET);
  assert.equal(r.status, 200);
  assert.equal((await claim(e.id))?.processingResult, "processed");
});

await check("E5 the same event delivered to both endpoints is processed once", async () => {
  const e = evt("account.updated", { id: `acct_e5_${sfx}`, object: "account" }, { account: `acct_e5_${sfx}` });
  const first = await post("stripe-connect", e, CONNECT_SECRET);
  const second = await post("stripe", e, PLATFORM_SECRET);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
});

await check("E6 live/test mode mismatch is ignored", async () => {
  const e = evt("refund.updated", { id: `re_e6_${sfx}`, object: "refund", amount: 1, currency: "eur", status: "succeeded", created: 1 }, { livemode: true });
  const r = await post("stripe", e, PLATFORM_SECRET);
  assert.equal(r.body.ignored, "mode_mismatch");
});

await check("E7 concurrent duplicate deliveries: exactly one processes", async () => {
  const e = evt("refund.updated", { id: `re_e7_${sfx}`, object: "refund", amount: 100, currency: "eur", status: "succeeded", created: 1, payment_intent: `pi_none_${sfx}` });
  const results = await Promise.all(Array.from({ length: 10 }, () => post("stripe", e, PLATFORM_SECRET)));
  const processed = results.filter((r) => r.status === 200 && r.body.received === true && !r.body.duplicate);
  const okOrRetry = results.every((r) => r.status === 200 || r.status === 503);
  assert.equal(processed.length, 1, JSON.stringify(results.map((r) => [r.status, r.body])));
  assert.ok(okOrRetry);
});

await check("E8 QR amount mismatch is acknowledged (200), held IN_REVIEW, not a 500 retry loop", async () => {
  const o = await qrOrder(1900, `cs_e8_${sfx}`);
  pis.set(`pi_e8_${sfx}`, { status: "succeeded", amount: 1500, amount_received: 1500, currency: "eur" });
  const session = { id: `cs_e8_${sfx}`, object: "checkout.session", amount_total: 1500, currency: "eur", payment_status: "paid", status: "complete", payment_intent: `pi_e8_${sfx}`, metadata: { source: "physical_qr_order", orderId: o.id, businessId: business.id } };
  const r = await post("stripe", evt("checkout.session.completed", session), PLATFORM_SECRET);
  assert.equal(r.status, 200);
  assert.equal((await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus, "IN_REVIEW");
});

await check("E9 QR delayed payment: completed(unpaid) then async_payment_succeeded → PAID", async () => {
  const o = await qrOrder(1500, `cs_e9_${sfx}`);
  const session = { id: `cs_e9_${sfx}`, object: "checkout.session", amount_total: 1500, currency: "eur", payment_status: "unpaid", status: "complete", payment_intent: `pi_e9_${sfx}`, metadata: { source: "physical_qr_order", orderId: o.id, businessId: business.id } };
  assert.equal((await post("stripe", evt("checkout.session.completed", session), PLATFORM_SECRET)).status, 200);
  assert.equal((await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus, "PENDING");
  pis.set(`pi_e9_${sfx}`, { status: "succeeded", amount: 1500, amount_received: 1500, currency: "eur" });
  const r = await post("stripe", evt("checkout.session.async_payment_succeeded", { ...session, payment_status: "paid" }), PLATFORM_SECRET);
  assert.equal(r.status, 200);
  assert.equal((await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus, "PAID");
});

await check("E10 QR verification unavailable → 503 retryable (Stripe redelivers), order unchanged", async () => {
  const o = await qrOrder(1500, `cs_e10_${sfx}`);
  __setPaymentIntentsRetrieveFnForTests(async () => {
    throw Object.assign(new Error("Stripe unreachable"), { type: "StripeConnectionError" });
  });
  const session = { id: `cs_e10_${sfx}`, object: "checkout.session", amount_total: 1500, currency: "eur", payment_status: "paid", status: "complete", payment_intent: `pi_e10_${sfx}`, metadata: { source: "physical_qr_order", orderId: o.id, businessId: business.id } };
  const e = evt("checkout.session.completed", session);
  const r = await post("stripe", e, PLATFORM_SECRET);
  assert.ok(r.status === 500 || r.status === 503, `status ${r.status}`);
  assert.equal((await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus, "PENDING");
  assert.equal((await claim(e.id))?.processingResult, "failed", "claim released for redelivery");
  __setPaymentIntentsRetrieveFnForTests(async (id) => ({ id, object: "payment_intent", metadata: {}, latest_charge: null, ...(pis.get(id) ?? {}) }) as Stripe.PaymentIntent);
  pis.set(`pi_e10_${sfx}`, { status: "succeeded", amount: 1500, amount_received: 1500, currency: "eur" });
  const retry = await post("stripe", e, PLATFORM_SECRET);
  assert.equal(retry.status, 200);
  assert.equal((await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus, "PAID");
});

await check("E11 refund.failed for a tip corrects the payable ledger", async () => {
  const pi = `pi_e11_${sfx}`;
  const emp = await prisma.employee.create({ data: { name: "E", jobTitle: "S", businessId: business.id } });
  const tip = await prisma.transaction.create({ data: { amount: 20, status: "success", businessId: business.id, employeeId: emp.id, stripePaymentIntentId: pi } });
  await prisma.employeeTipPayable.create({
    data: { transactionId: tip.id, businessId: business.id, employeeId: emp.id, routingMode: "business_distribution", chargeModel: "destination_business", status: "held_business", grossCents: 2000, platformFeeCents: 249, payableCents: 1751, stripePaymentIntentId: pi },
  });
  const refund = { id: `re_e11_${sfx}`, object: "refund", amount: 500, currency: "eur", created: 1, payment_intent: pi, charge: "ch_e11" };
  await post("stripe", evt("refund.created", { ...refund, status: "succeeded" }), PLATFORM_SECRET);
  assert.equal((await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: tip.id } })).refundedCents, 500);
  await post("stripe", evt("refund.failed", { ...refund, status: "failed" }), PLATFORM_SECRET);
  assert.equal((await prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: tip.id } })).refundedCents, 0);
});

await check("E12 Connect endpoint is closed when its secret is not configured", async () => {
  const saved = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const e = evt("account.updated", { id: `acct_e12_${sfx}`, object: "account" }, { account: `acct_e12_${sfx}` });
  const r = await post("stripe-connect", e, CONNECT_SECRET);
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = saved;
  assert.equal(r.status, 400);
});

__setPaymentIntentsRetrieveFnForTests(null);
server.close();
await prisma.$disconnect();
console.log(`\nstripe-webhook-endpoints: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
