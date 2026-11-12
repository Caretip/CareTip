/**
 * QR print order payment integrity (audit H1, H2, M3, M4 — 2026-11-11).
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:payment-integrity-qr
 *
 * Disposable loopback Postgres only. Stripe is never contacted: every Stripe call is stubbed.
 */
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import {
  __setPaymentIntentsRetrieveFnForTests,
  __setRefundsCreateFnForTests,
  getStripeClient,
} from "../src/services/stripe.service.js";
import { handlePhysicalQrCheckoutSessionCompleted, handlePhysicalQrAsyncPaymentFailed } from "../src/services/physicalQr/physicalQrWebhook.service.js";
import {
  createPhysicalQrBatchCheckoutSession,
  physicalQrCheckoutIdempotencyKey,
} from "../src/services/physicalQr/physicalQrBatch.service.js";
import { upsertStripeDisputeEvent, upsertStripeRefundEvent } from "../src/services/finance/tipRefunds.service.js";

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

const sfx = Date.now().toString(36);
const SRC = "physical_qr_order";
const PRODUCT = "caretip-a5-flyer-no-address";

// ── Stripe stubs ──
const paymentIntents = new Map<string, Partial<Stripe.PaymentIntent>>();
__setPaymentIntentsRetrieveFnForTests(async (id) => {
  const pi = paymentIntents.get(id);
  if (!pi) throw Object.assign(new Error("No such payment_intent"), { type: "StripeInvalidRequestError", code: "resource_missing" });
  return { id, object: "payment_intent", latest_charge: null, ...pi } as Stripe.PaymentIntent;
});
const refundCalls: Array<{ params: Stripe.RefundCreateParams; key?: string }> = [];
__setRefundsCreateFnForTests(async (params, options) => {
  refundCalls.push({ params, key: options?.idempotencyKey });
  const prior = refundCalls.findIndex((c) => c.key === options?.idempotencyKey);
  return { id: `re_qr_${sfx}_${prior}`, status: "succeeded", amount: 0, metadata: params.metadata } as unknown as Stripe.Refund;
});

type FakeSession = { id: string; status: "open" | "complete" | "expired"; payment_status: string; amount_total: number; currency: string; url: string | null; expires_at: number };
const sessions = new Map<string, FakeSession>();
const createdByKey = new Map<string, string>();
const createCalls: Array<{ key?: string }> = [];
const expireCalls: string[] = [];
let createDelayMs = 0;
const stripe = getStripeClient() as unknown as { checkout: { sessions: Record<string, unknown> } };
stripe.checkout.sessions.create = async (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
  createCalls.push({ key: options?.idempotencyKey });
  if (createDelayMs) await new Promise((r) => setTimeout(r, createDelayMs));
  const key = options?.idempotencyKey ?? `nokey_${createCalls.length}`;
  const cachedId = createdByKey.get(key);
  if (cachedId) return sessions.get(cachedId);
  const id = `cs_qr_${sfx}_${sessions.size + 1}`;
  const amount = (params.line_items?.[0] as { price_data?: { unit_amount?: number } })?.price_data?.unit_amount ?? 0;
  const s: FakeSession = { id, status: "open", payment_status: "unpaid", amount_total: amount, currency: "eur", url: `https://checkout.stripe.test/${id}`, expires_at: Math.floor(Date.now() / 1000) + 86_400 };
  sessions.set(id, s);
  createdByKey.set(key, id);
  return s;
};
stripe.checkout.sessions.retrieve = async (id: string) => {
  const s = sessions.get(id);
  if (!s) throw Object.assign(new Error("No such checkout session"), { code: "resource_missing", statusCode: 404 });
  return s;
};
stripe.checkout.sessions.expire = async (id: string) => {
  expireCalls.push(id);
  const s = sessions.get(id);
  if (!s) throw Object.assign(new Error("missing"), { statusCode: 404 });
  if (s.status === "complete") throw Object.assign(new Error("Session is complete"), { type: "StripeInvalidRequestError" });
  s.status = "expired";
  return s;
};

// ── fixtures ──
await prisma.physicalQrProduct.update({ where: { id: PRODUCT }, data: { priceCents: 990, orderable: true } });
const user = await prisma.user.create({
  data: { email: `qr-int-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true },
});
const business = await prisma.business.create({ data: { name: `QR Int ${sfx}`, slug: `qr-int-${sfx}`, userId: user.id } });

let orderSeq = 0;
async function order(opts: { sessionId?: string | null; totalAmount?: number; paymentStatus?: "PENDING" | "PAID" | "FAILED"; pi?: string | null; fulfillment?: "PENDING_PAYMENT" | "PROCESSING" | "PAYMENT_FAILED" } = {}) {
  orderSeq += 1;
  return prisma.physicalQrOrder.create({
    data: {
      businessId: business.id,
      userId: user.id,
      productId: PRODUCT,
      qrContextType: "storefront",
      qrTargetUrlSnapshot: `https://example.test/qr/${sfx}/${orderSeq}`,
      quantity: 10,
      totalAmount: opts.totalAmount ?? 1500,
      currency: "EUR",
      placedAt: new Date(),
      processingClass: "WITHIN_24_HOURS",
      processingDeadlineAt: new Date(Date.now() + 86_400_000),
      processingCopySnapshot: {},
      businessNameSnapshot: "QR Int",
      stripeCheckoutSessionId: opts.sessionId ?? null,
      paymentStatus: opts.paymentStatus ?? "PENDING",
      fulfillmentStatus: opts.fulfillment ?? (opts.paymentStatus === "PAID" ? "PROCESSING" : "PENDING_PAYMENT"),
      stripePaymentIntentId: opts.pi ?? null,
      paidAt: opts.paymentStatus === "PAID" ? new Date() : null,
    },
  });
}

function paidSession(o: { id: string }, id: string, pi: string, amount = 1500, extra: Partial<Stripe.Checkout.Session> = {}) {
  return {
    id,
    object: "checkout.session",
    amount_total: amount,
    currency: "eur",
    payment_status: "paid",
    status: "complete",
    payment_intent: pi,
    metadata: { source: SRC, orderId: o.id, businessId: business.id },
    ...extra,
  } as unknown as Stripe.Checkout.Session;
}
function succeededPi(id: string, amount = 1500, extra: Partial<Stripe.PaymentIntent> = {}) {
  paymentIntents.set(id, { status: "succeeded", amount, amount_received: amount, currency: "eur", metadata: {}, ...extra });
}
const reload = (id: string) => prisma.physicalQrOrder.findUniqueOrThrow({ where: { id } });
const discrepancy = (kind: string, orderId: string) =>
  prisma.paymentDiscrepancy.findFirst({ where: { kind, physicalQrOrderId: orderId } });

// ── H1/H2: webhook outcomes ──
await check("W1 correct paid session → PAID/PROCESSING", async () => {
  const o = await order({ sessionId: `cs_w1_${sfx}` });
  succeededPi(`pi_w1_${sfx}`);
  const r = await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w1_${sfx}`, `pi_w1_${sfx}`));
  const after = await reload(o.id);
  assert.equal(r.ok, true);
  assert.equal(after.paymentStatus, "PAID");
  assert.equal(after.fulfillmentStatus, "PROCESSING");
  assert.equal(after.stripePaymentIntentId, `pi_w1_${sfx}`);
  const replay = await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w1_${sfx}`, `pi_w1_${sfx}`));
  assert.equal(replay.duplicate, true, "replay is a no-op");
});

await check("W2 old but legitimately paid session is accepted; newer session expired", async () => {
  const newer = `cs_w2_new_${sfx}`;
  sessions.set(newer, { id: newer, status: "open", payment_status: "unpaid", amount_total: 1500, currency: "eur", url: "u", expires_at: 0 });
  const o = await order({ sessionId: newer });
  succeededPi(`pi_w2_${sfx}`);
  const r = await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w2_old_${sfx}`, `pi_w2_${sfx}`));
  const after = await reload(o.id);
  assert.equal(r.ok, true);
  assert.equal(after.paymentStatus, "PAID");
  assert.equal(after.stripeCheckoutSessionId, `cs_w2_old_${sfx}`);
  assert.ok(expireCalls.includes(newer), "the superseded session is expired so it cannot be paid too");
});

await check("W3 amount mismatch → IN_REVIEW, not fulfilled, no webhook failure", async () => {
  const o = await order({ sessionId: `cs_w3_${sfx}`, totalAmount: 1900 });
  succeededPi(`pi_w3_${sfx}`);
  const r = await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w3_${sfx}`, `pi_w3_${sfx}`));
  const after = await reload(o.id);
  assert.equal(r.ok, true, "acknowledged (no 500 retry loop)");
  assert.equal(r.review, true);
  assert.equal(after.paymentStatus, "IN_REVIEW");
  assert.equal(after.fulfillmentStatus, "PENDING_PAYMENT");
  assert.equal(after.stripePaymentIntentId, `pi_w3_${sfx}`, "payment reference kept for refunds/reconciliation");
  assert.ok(await discrepancy("payment_needs_review", o.id));
});

await check("W4 currency mismatch → IN_REVIEW", async () => {
  const o = await order({ sessionId: `cs_w4_${sfx}` });
  succeededPi(`pi_w4_${sfx}`, 1500, { currency: "usd" });
  await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w4_${sfx}`, `pi_w4_${sfx}`, 1500, { currency: "usd" }));
  assert.equal((await reload(o.id)).paymentStatus, "IN_REVIEW");
});

await check("W5 unpaid session (delayed method) is never marked PAID", async () => {
  const o = await order({ sessionId: `cs_w5_${sfx}` });
  const r = await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w5_${sfx}`, `pi_w5_${sfx}`, 1500, { payment_status: "unpaid" }));
  const after = await reload(o.id);
  assert.equal(r.awaitingPayment, true);
  assert.equal(after.paymentStatus, "PENDING");
  assert.equal(after.fulfillmentStatus, "PENDING_PAYMENT");
});

await check("W6 delayed payment success (async_payment_succeeded) → PAID", async () => {
  const o = await order({ sessionId: `cs_w6_${sfx}` });
  await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w6_${sfx}`, `pi_w6_${sfx}`, 1500, { payment_status: "unpaid" }));
  succeededPi(`pi_w6_${sfx}`);
  await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w6_${sfx}`, `pi_w6_${sfx}`));
  assert.equal((await reload(o.id)).paymentStatus, "PAID");
});

await check("W7 delayed payment failure (async_payment_failed) → FAILED / PAYMENT_FAILED", async () => {
  const o = await order({ sessionId: `cs_w7_${sfx}` });
  const r = await handlePhysicalQrAsyncPaymentFailed(paidSession(o, `cs_w7_${sfx}`, `pi_w7_${sfx}`, 1500, { payment_status: "unpaid" }));
  const after = await reload(o.id);
  assert.equal(r.updated, true);
  assert.equal(after.paymentStatus, "FAILED");
  assert.equal(after.fulfillmentStatus, "PAYMENT_FAILED");
});

await check("W8 PaymentIntent not succeeded → IN_REVIEW (never fulfilled)", async () => {
  const o = await order({ sessionId: `cs_w8_${sfx}` });
  paymentIntents.set(`pi_w8_${sfx}`, { status: "canceled", amount: 1500, amount_received: 0, currency: "eur" });
  await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w8_${sfx}`, `pi_w8_${sfx}`));
  const after = await reload(o.id);
  assert.equal(after.paymentStatus, "IN_REVIEW");
  assert.equal(after.fulfillmentStatus, "PENDING_PAYMENT");
});

await check("W9 Stripe unreachable during verification → retryable, order unchanged", async () => {
  const o = await order({ sessionId: `cs_w9_${sfx}` });
  const r = await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w9_${sfx}`, `pi_w9_unknown_${sfx}`));
  assert.equal(r.ok, false);
  assert.equal(r.retryable, true);
  assert.equal((await reload(o.id)).paymentStatus, "PENDING");
});

await check("W10 no_payment_required is not accepted as payment", async () => {
  const o = await order({ sessionId: `cs_w10_${sfx}` });
  const r = await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w10_${sfx}`, `pi_w10_${sfx}`, 0, { payment_status: "no_payment_required" }));
  assert.equal(r.review, true);
  assert.equal((await reload(o.id)).paymentStatus, "PENDING");
  assert.ok(await discrepancy("unexpected_payment_status", o.id));
});

await check("W11 second payment for an already paid order → discrepancy + one idempotent refund", async () => {
  const o = await order({ sessionId: `cs_w11a_${sfx}`, paymentStatus: "PAID", pi: `pi_w11a_${sfx}` });
  succeededPi(`pi_w11b_${sfx}`);
  const before = refundCalls.length;
  const r = await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w11b_${sfx}`, `pi_w11b_${sfx}`));
  await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_w11b_${sfx}`, `pi_w11b_${sfx}`)); // webhook replay
  const after = await reload(o.id);
  assert.equal(r.reason, "duplicate_payment_refunded");
  assert.equal(after.stripePaymentIntentId, `pi_w11a_${sfx}`, "the original payment stays attached");
  assert.equal(refundCalls.length - before, 1, "exactly one refund call across replays");
  assert.equal(refundCalls.at(-1)?.params.payment_intent, `pi_w11b_${sfx}`);
  assert.equal(refundCalls.at(-1)?.key, `qr_duplicate_payment_refund:pi_w11b_${sfx}`);
  const op = await prisma.stripeRefundOperation.findUnique({ where: { operationKey: `qr_duplicate_payment_refund:pi_w11b_${sfx}` } });
  assert.equal(op?.status, "succeeded");
});

// ── M3: checkout concurrency, reuse, expiry recovery ──
await check("C1 checkout creates one session with a deterministic idempotency key", async () => {
  const o = await order({ totalAmount: 0 });
  createCalls.length = 0;
  const r = await createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id });
  const after = await reload(o.id);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0]!.key, physicalQrCheckoutIdempotencyKey(o.id, after.totalAmount, null));
  assert.equal(after.stripeCheckoutSessionId, r.sessionId);
  assert.ok(after.totalAmount > 0, "paid quote for a Basic business");

  const again = await createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id });
  assert.equal(again.sessionId, r.sessionId, "open session for the same amount is reused");
  assert.equal(again.reused, true);
  assert.equal(createCalls.length, 1, "no second Stripe session");
});

await check("C2 concurrent checkout requests for one order → one Stripe session", async () => {
  const o = await order();
  createCalls.length = 0;
  createDelayMs = 300;
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id })),
  );
  createDelayMs = 0;
  const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ sessionId: string | null }>[];
  const ids = new Set(ok.map((r) => r.value.sessionId));
  const busy = results.filter((r) => r.status === "rejected" && (r.reason as { code?: string }).code === "CHECKOUT_IN_PROGRESS");
  assert.equal(createCalls.length, 1, `Stripe create calls: ${createCalls.length}`);
  assert.equal(ids.size, 1, "every successful caller got the same session");
  assert.equal(ok.length + busy.length, 6, "others were told checkout is in progress");
});

await check("C3 expired session → a new checkout attempt succeeds with a new key", async () => {
  const o = await order();
  const first = await createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id });
  sessions.get(first.sessionId!)!.status = "expired";
  createCalls.length = 0;
  const second = await createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id });
  const after = await reload(o.id);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(createCalls[0]!.key, physicalQrCheckoutIdempotencyKey(o.id, after.totalAmount, first.sessionId));
  assert.equal(after.stripeCheckoutSessionId, second.sessionId);
});

await check("C4 session about to expire is expired before a replacement is created", async () => {
  const o = await order();
  const first = await createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id });
  sessions.get(first.sessionId!)!.expires_at = Math.floor(Date.now() / 1000) + 60;
  const second = await createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id });
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(sessions.get(first.sessionId!)!.status, "expired", "only one payable session at a time");
});

await check("C5 stored session already paid → 409, no new session", async () => {
  const o = await order();
  const first = await createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id });
  const s = sessions.get(first.sessionId!)!;
  s.status = "complete";
  s.payment_status = "paid";
  createCalls.length = 0;
  await assert.rejects(
    createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id }),
    (err: { code?: string }) => err.code === "ORDER_PAYMENT_PROCESSING",
  );
  assert.equal(createCalls.length, 0);
});

await check("C6 failed payment can be retried (PAYMENT_FAILED → PENDING_PAYMENT)", async () => {
  const o = await order({ paymentStatus: "FAILED", fulfillment: "PAYMENT_FAILED" });
  const r = await createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id });
  const after = await reload(o.id);
  assert.ok(r.sessionId);
  assert.equal(after.paymentStatus, "PENDING");
  assert.equal(after.fulfillmentStatus, "PENDING_PAYMENT");
});

await check("C7 paid order cannot be checked out again", async () => {
  const o = await order({ paymentStatus: "PAID", pi: `pi_c7_${sfx}` });
  await assert.rejects(
    createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id }),
    (err: { code?: string }) => err.code === "ORDER_NOT_CHECKOUTABLE",
  );
});

await check("Z1 zero-cost (included Pro order) skips Stripe and transitions exactly once", async () => {
  const proUser = await prisma.user.create({
    data: { email: `qr-pro-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true },
  });
  const pro = await prisma.business.create({
    data: { name: `QR Pro ${sfx}`, slug: `qr-pro-${sfx}`, userId: proUser.id, subscriptionTier: "premium" },
  });
  await prisma.subscription.create({
    data: { businessId: pro.id, planKey: "premium", status: "active", stripeSubscriptionId: `sub_qr_pro_${sfx}`, stripeCustomerId: `cus_qr_pro_${sfx}` },
  });
  const o = await prisma.physicalQrOrder.create({
    data: {
      businessId: pro.id, userId: proUser.id, productId: PRODUCT, qrContextType: "storefront",
      qrTargetUrlSnapshot: `https://example.test/qr/${sfx}/pro`, quantity: 1, totalAmount: 0, currency: "EUR",
      placedAt: new Date(), processingClass: "WITHIN_24_HOURS", processingDeadlineAt: new Date(Date.now() + 86_400_000),
      processingCopySnapshot: {}, businessNameSnapshot: "QR Pro",
    },
  });
  createCalls.length = 0;
  const results = await Promise.allSettled([
    createPhysicalQrBatchCheckoutSession({ businessId: pro.id, userId: proUser.id, orderId: o.id }),
    createPhysicalQrBatchCheckoutSession({ businessId: pro.id, userId: proUser.id, orderId: o.id }),
  ]);
  const zero = results.filter((r) => r.status === "fulfilled" && (r.value as { zeroCost?: boolean }).zeroCost);
  const after = await reload(o.id);
  assert.equal(createCalls.length, 0, "no Stripe session for a zero-cost order");
  assert.equal(zero.length, 1, `exactly one request completed the zero-cost order (${JSON.stringify(results.map((r) => r.status))})`);
  assert.equal(after.paymentStatus, "PAID");
  assert.equal(after.fulfillmentStatus, "PROCESSING");
});

// ── M4: refunds and disputes ──
const refundOrder = await order({ sessionId: `cs_r_${sfx}`, paymentStatus: "PAID", pi: `pi_r_${sfx}`, totalAmount: 2000 });
const refundEvent = (id: string, amount: number, status: string) =>
  upsertStripeRefundEvent({ stripeRefundId: id, stripePaymentIntentId: `pi_r_${sfx}`, amountCents: amount, currency: "eur", status, occurredAt: new Date() });

await check("R1 partial refund → PARTIALLY_REFUNDED (not printable as PAID)", async () => {
  await refundEvent(`re_r1_${sfx}`, 500, "succeeded");
  const after = await reload(refundOrder.id);
  assert.equal(after.paymentStatus, "PARTIALLY_REFUNDED");
  assert.equal(after.fulfillmentStatus, "PROCESSING", "order history is not rewritten");
});

await check("R2 replayed and stale refund events do not double count", async () => {
  await refundEvent(`re_r1_${sfx}`, 500, "succeeded");
  await refundEvent(`re_r1_${sfx}`, 500, "pending");
  const rows = await prisma.physicalQrPaymentAdjustment.findMany({ where: { orderId: refundOrder.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "succeeded");
  assert.equal((await reload(refundOrder.id)).paymentStatus, "PARTIALLY_REFUNDED");
});

await check("R3 second refund covering the rest → REFUNDED", async () => {
  await refundEvent(`re_r3_${sfx}`, 1500, "succeeded");
  assert.equal((await reload(refundOrder.id)).paymentStatus, "REFUNDED");
});

await check("R4 refund reported failed after success → status recomputed", async () => {
  await refundEvent(`re_r3_${sfx}`, 1500, "failed");
  assert.equal((await reload(refundOrder.id)).paymentStatus, "PARTIALLY_REFUNDED");
  await refundEvent(`re_r3_${sfx}`, 1500, "succeeded"); // stale: failed is final
  assert.equal((await reload(refundOrder.id)).paymentStatus, "PARTIALLY_REFUNDED");
});

const disputeOrder = await order({ sessionId: `cs_d_${sfx}`, paymentStatus: "PAID", pi: `pi_d_${sfx}` });
const disputeEvent = (status: string) =>
  upsertStripeDisputeEvent({ stripeDisputeId: `dp_${sfx}`, stripePaymentIntentId: `pi_d_${sfx}`, amountCents: 1500, currency: "eur", status, occurredAt: new Date() });

await check("D1 dispute opened → DISPUTED + discrepancy", async () => {
  await disputeEvent("needs_response");
  assert.equal((await reload(disputeOrder.id)).paymentStatus, "DISPUTED");
  assert.ok(await discrepancy("order_disputed", disputeOrder.id));
});

await check("D2 dispute won → held for re-verification (IN_REVIEW); a late needs_response cannot reopen it", async () => {
  // Policy (2026-11): a won dispute is not an automatic release; a platform admin re-verifies first.
  await disputeEvent("won");
  assert.equal((await reload(disputeOrder.id)).paymentStatus, "IN_REVIEW");
  assert.ok(await discrepancy("dispute_won_needs_review", disputeOrder.id));
  await disputeEvent("needs_response");
  assert.equal((await reload(disputeOrder.id)).paymentStatus, "IN_REVIEW", "terminal 'won' is not regressed");
});

await check("D3 dispute lost → DISPUTED (stays out of fulfillment)", async () => {
  const o = await order({ sessionId: `cs_d3_${sfx}`, paymentStatus: "PAID", pi: `pi_d3_${sfx}` });
  await upsertStripeDisputeEvent({ stripeDisputeId: `dp3_${sfx}`, stripePaymentIntentId: `pi_d3_${sfx}`, amountCents: 1500, currency: "eur", status: "lost", occurredAt: new Date() });
  assert.equal((await reload(o.id)).paymentStatus, "DISPUTED");
});

await check("R5 refund on an IN_REVIEW order keeps it out of fulfillment", async () => {
  const o = await order({ sessionId: `cs_r5_${sfx}`, totalAmount: 1900 });
  succeededPi(`pi_r5_${sfx}`);
  await handlePhysicalQrCheckoutSessionCompleted(paidSession(o, `cs_r5_${sfx}`, `pi_r5_${sfx}`));
  await upsertStripeRefundEvent({ stripeRefundId: `re_r5_${sfx}`, stripePaymentIntentId: `pi_r5_${sfx}`, amountCents: 1500, currency: "eur", status: "succeeded", occurredAt: new Date() });
  const after = await reload(o.id);
  assert.equal(after.paymentStatus, "PARTIALLY_REFUNDED");
  assert.equal(after.fulfillmentStatus, "PENDING_PAYMENT");
});

__setPaymentIntentsRetrieveFnForTests(null);
__setRefundsCreateFnForTests(null);
await prisma.$disconnect();
console.log(`\npayment-integrity-qr: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
