/**
 * Tip refund ledger integrity and durable automatic refunds (audit M1, M2 — 2026-11-11).
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:payment-integrity-refunds
 *
 * Disposable loopback Postgres only. Stripe is never contacted: every Stripe call is stubbed.
 */
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import {
  __setPaymentIntentsRetrieveFnForTests,
  __setRefundsCreateFnForTests,
  __setRefundsListFnForTests,
  handleSuccessfulTipPayment,
} from "../src/services/stripe.service.js";
import { upsertStripeRefundEvent, isAllowedRefundTransition } from "../src/services/finance/tipRefunds.service.js";
import {
  classifyStripeRefundError,
  executeRefundOperation,
  requestRefundOperation,
  retryDueRefundOperations,
  REFUND_OPERATION_MAX_ATTEMPTS,
} from "../src/services/payments/refundOperations.service.js";

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
const user = await prisma.user.create({
  data: { email: `ref-int-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true },
});
const business = await prisma.business.create({ data: { name: `Ref ${sfx}`, slug: `ref-${sfx}`, userId: user.id } });
const employee = await prisma.employee.create({ data: { name: "Ref Emp", jobTitle: "Server", businessId: business.id } });

let tipSeq = 0;
async function tipWithPayable(grossCents = 2000) {
  tipSeq += 1;
  const pi = `pi_ref_${sfx}_${tipSeq}`;
  const tip = await prisma.transaction.create({
    data: { amount: grossCents / 100, status: "success", businessId: business.id, employeeId: employee.id, stripePaymentIntentId: pi },
  });
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tip.id, businessId: business.id, employeeId: employee.id,
      routingMode: "business_distribution", chargeModel: "destination_business", status: "held_business",
      grossCents, platformFeeCents: 249, payableCents: grossCents - 249, stripePaymentIntentId: pi,
    },
  });
  return { tip, pi };
}
const payable = (tipId: string) => prisma.employeeTipPayable.findUniqueOrThrow({ where: { transactionId: tipId } });
const refundEvt = (pi: string, id: string, cents: number, status: string) =>
  upsertStripeRefundEvent({ stripeRefundId: id, stripePaymentIntentId: pi, amountCents: cents, currency: "eur", status, occurredAt: new Date() });

// ── M1: refund state machine and ledger totals ──
await check("T0 transition table", async () => {
  assert.equal(isAllowedRefundTransition("pending", "succeeded"), true);
  assert.equal(isAllowedRefundTransition("succeeded", "pending"), false);
  assert.equal(isAllowedRefundTransition("succeeded", "failed"), true);
  assert.equal(isAllowedRefundTransition("failed", "succeeded"), false);
  assert.equal(isAllowedRefundTransition("canceled", "pending"), false);
});

await check("T1 pending → succeeded applies the refund once", async () => {
  const { tip, pi } = await tipWithPayable();
  await refundEvt(pi, `re_t1_${sfx}`, 500, "pending");
  assert.equal((await payable(tip.id)).refundedCents, 0);
  await refundEvt(pi, `re_t1_${sfx}`, 500, "succeeded");
  assert.equal((await payable(tip.id)).refundedCents, 500);
});

await check("T2 succeeded → stale pending → succeeded again: still 500 (audit R1 reproduction)", async () => {
  const { tip, pi } = await tipWithPayable();
  await refundEvt(pi, `re_t2_${sfx}`, 500, "succeeded");
  await refundEvt(pi, `re_t2_${sfx}`, 500, "pending");
  const row = await prisma.tipRefund.findUnique({ where: { stripeRefundId: `re_t2_${sfx}` } });
  assert.equal(row?.status, "succeeded", "stale pending ignored");
  await refundEvt(pi, `re_t2_${sfx}`, 500, "succeeded");
  await refundEvt(pi, `re_t2_${sfx}`, 500, "succeeded");
  assert.equal((await payable(tip.id)).refundedCents, 500);
});

await check("T3 partial + multiple distinct refunds sum correctly", async () => {
  const { tip, pi } = await tipWithPayable();
  await refundEvt(pi, `re_t3a_${sfx}`, 500, "succeeded");
  await refundEvt(pi, `re_t3b_${sfx}`, 300, "succeeded");
  await refundEvt(pi, `re_t3a_${sfx}`, 500, "succeeded"); // replay
  assert.equal((await payable(tip.id)).refundedCents, 800);
});

await check("T4 refund failed after success corrects the ledger (audit R2 reproduction)", async () => {
  const { tip, pi } = await tipWithPayable();
  await refundEvt(pi, `re_t4a_${sfx}`, 500, "succeeded");
  await refundEvt(pi, `re_t4b_${sfx}`, 300, "succeeded");
  await refundEvt(pi, `re_t4a_${sfx}`, 500, "failed");
  assert.equal((await payable(tip.id)).refundedCents, 300);
  await refundEvt(pi, `re_t4a_${sfx}`, 500, "succeeded"); // stale: failed is final
  assert.equal((await payable(tip.id)).refundedCents, 300);
});

await check("T5 full refund marks payable refunded; a later failure restores its status", async () => {
  const { tip, pi } = await tipWithPayable(2000);
  await refundEvt(pi, `re_t5_${sfx}`, 2000, "succeeded");
  let p = await payable(tip.id);
  assert.equal(p.status, "refunded");
  assert.equal(p.refundedCents, p.payableCents, "capped at the payable amount");
  await refundEvt(pi, `re_t5_${sfx}`, 2000, "failed");
  p = await payable(tip.id);
  assert.equal(p.refundedCents, 0);
  assert.equal(p.status, "held_business");
});

await check("T6 concurrent duplicate deliveries of one refund apply once", async () => {
  const { tip, pi } = await tipWithPayable();
  await Promise.all(Array.from({ length: 8 }, () => refundEvt(pi, `re_t6_${sfx}`, 400, "succeeded")));
  assert.equal((await payable(tip.id)).refundedCents, 400);
  assert.equal(await prisma.tipRefund.count({ where: { stripeRefundId: `re_t6_${sfx}` } }), 1);
});

// ── M2: durable automatic refunds ──
type Behaviour = (call: number, params: Stripe.RefundCreateParams, key?: string) => Stripe.Refund;
let behaviour: Behaviour = () => ({ id: "re_default", status: "succeeded" }) as Stripe.Refund;
const calls: Array<{ key?: string; pi: string }> = [];
__setRefundsCreateFnForTests(async (params, options) => {
  calls.push({ key: options?.idempotencyKey, pi: String(params.payment_intent) });
  return behaviour(calls.length, params, options?.idempotencyKey);
});
let listed: Stripe.Refund[] = [];
__setRefundsListFnForTests(async () => listed);
__setPaymentIntentsRetrieveFnForTests(async (id) => ({
  id, object: "payment_intent", status: "succeeded", amount: 1000, amount_received: 1000, currency: "eur", metadata: {}, latest_charge: null,
}) as unknown as Stripe.PaymentIntent);

const stripeError = (type: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(type), { type, ...extra });
const makeDue = (id: string) => prisma.stripeRefundOperation.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });

await check("O0 error classification", async () => {
  assert.equal(classifyStripeRefundError(stripeError("StripeConnectionError")).kind, "ambiguous");
  assert.equal(classifyStripeRefundError(stripeError("StripeAPIError", { statusCode: 500 })).kind, "ambiguous");
  assert.equal(classifyStripeRefundError(stripeError("StripeRateLimitError")).kind, "transient");
  assert.equal(classifyStripeRefundError(stripeError("StripeInvalidRequestError", { code: "parameter_invalid" })).kind, "permanent");
  assert.equal(classifyStripeRefundError(stripeError("StripeInvalidRequestError", { code: "charge_already_refunded" })).kind, "already_refunded");
  assert.equal(classifyStripeRefundError(new Error("socket hang up")).kind, "ambiguous");
});

await check("O1 transient failure → retried later with the SAME idempotency key → succeeded", async () => {
  calls.length = 0;
  behaviour = (n) => {
    if (n === 1) throw stripeError("StripeRateLimitError", { statusCode: 429 });
    return { id: `re_o1_${sfx}`, status: "succeeded" } as Stripe.Refund;
  };
  const r = await requestRefundOperation({ operationKey: `eligibility_refund:pi_o1_${sfx}`, purpose: "tip_eligibility", paymentIntentId: `pi_o1_${sfx}` });
  assert.equal(r.status, "pending");
  const op = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: r.operationId } });
  assert.ok(op.nextAttemptAt && op.nextAttemptAt > new Date(), "backoff scheduled");
  assert.equal(op.lastErrorKind, "transient");
  await makeDue(op.id);
  await retryDueRefundOperations();
  const after = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: op.id } });
  assert.equal(after.status, "succeeded");
  assert.equal(after.stripeRefundId, `re_o1_${sfx}`);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.key, calls[1]!.key, "same key: Stripe deduplicates");
  assert.equal(calls[0]!.key, `eligibility_refund:pi_o1_${sfx}`, "historical key preserved");
});

await check("O2 ambiguous response (network) is retried with the same key, never a second refund", async () => {
  calls.length = 0;
  behaviour = (n) => {
    if (n === 1) throw stripeError("StripeConnectionError");
    return { id: `re_o2_${sfx}`, status: "succeeded" } as Stripe.Refund;
  };
  const r = await requestRefundOperation({ operationKey: `test_refund:pi_o2_${sfx}`, purpose: "qr_duplicate_payment", paymentIntentId: `pi_o2_${sfx}` });
  assert.equal(r.status, "pending");
  assert.equal((await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: r.operationId } })).lastErrorKind, "ambiguous");
  await makeDue(r.operationId);
  await executeRefundOperation(r.operationId);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.key, calls[1]!.key);
});

await check("O3 permanent failure → failed_permanent + discrepancy, not retried", async () => {
  calls.length = 0;
  behaviour = () => {
    throw stripeError("StripeInvalidRequestError", { code: "parameter_invalid", statusCode: 400 });
  };
  const r = await requestRefundOperation({ operationKey: `test_refund:pi_o3_${sfx}`, purpose: "qr_duplicate_payment", paymentIntentId: `pi_o3_${sfx}` });
  assert.equal(r.status, "failed_permanent");
  assert.ok(await prisma.paymentDiscrepancy.findFirst({ where: { kind: "refund_operation_failed", subjectKey: `refund_op:${r.operationId}` } }));
  await retryDueRefundOperations();
  assert.equal(calls.length, 1, "no further attempts");
});

await check("O4 'already refunded' resolves to the existing refund", async () => {
  behaviour = () => {
    throw stripeError("StripeInvalidRequestError", { code: "charge_already_refunded" });
  };
  listed = [{ id: `re_o4_${sfx}`, status: "succeeded", metadata: {} } as unknown as Stripe.Refund];
  const r = await requestRefundOperation({ operationKey: `test_refund:pi_o4_${sfx}`, purpose: "qr_duplicate_payment", paymentIntentId: `pi_o4_${sfx}` });
  assert.equal(r.status, "succeeded");
  assert.equal(r.stripeRefundId, `re_o4_${sfx}`);
  listed = [];
});

await check("O5 retries are bounded → failed_permanent (retries_exhausted)", async () => {
  behaviour = () => {
    throw stripeError("StripeRateLimitError", { statusCode: 429 });
  };
  const r = await requestRefundOperation({ operationKey: `test_refund:pi_o5_${sfx}`, purpose: "qr_duplicate_payment", paymentIntentId: `pi_o5_${sfx}` });
  for (let i = 1; i < REFUND_OPERATION_MAX_ATTEMPTS; i += 1) {
    await makeDue(r.operationId);
    await executeRefundOperation(r.operationId);
  }
  const op = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: r.operationId } });
  assert.equal(op.status, "failed_permanent");
  assert.equal(op.lastErrorKind, "retries_exhausted");
  assert.equal(op.attempts, REFUND_OPERATION_MAX_ATTEMPTS);
});

await check("O6 after the 24h key window: look the refund up before ever using a new key", async () => {
  calls.length = 0;
  behaviour = () => {
    throw stripeError("StripeConnectionError");
  };
  const r = await requestRefundOperation({ operationKey: `test_refund:pi_o6_${sfx}`, purpose: "qr_duplicate_payment", paymentIntentId: `pi_o6_${sfx}` });
  await prisma.stripeRefundOperation.update({ where: { id: r.operationId }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
  // The ambiguous first attempt did go through at Stripe:
  listed = [{ id: `re_o6_${sfx}`, status: "succeeded", metadata: { caretip_refund_operation_id: r.operationId } } as unknown as Stripe.Refund];
  await makeDue(r.operationId);
  await executeRefundOperation(r.operationId);
  let op = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: r.operationId } });
  assert.equal(op.status, "succeeded");
  assert.equal(op.stripeRefundId, `re_o6_${sfx}`);
  assert.equal(calls.length, 1, "no new create call once the refund was found");

  // Nothing found → a fresh key generation is used (safe: Stripe has no refund for this operation).
  calls.length = 0;
  listed = [];
  behaviour = (n) => {
    if (n === 1) throw stripeError("StripeConnectionError");
    return { id: `re_o6b_${sfx}`, status: "succeeded" } as Stripe.Refund;
  };
  const r2 = await requestRefundOperation({ operationKey: `test_refund:pi_o6b_${sfx}`, purpose: "qr_duplicate_payment", paymentIntentId: `pi_o6b_${sfx}` });
  await prisma.stripeRefundOperation.update({ where: { id: r2.operationId }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
  await makeDue(r2.operationId);
  await executeRefundOperation(r2.operationId);
  op = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: r2.operationId } });
  assert.equal(op.status, "succeeded");
  assert.equal(op.keyGeneration, 1);
  assert.equal(calls[1]!.key, `test_refund:pi_o6b_${sfx}:g1`);
});

// ── M2 end to end: ineligible tip after capture ──
const inactive = await prisma.employee.create({ data: { name: "Gone", jobTitle: "Server", businessId: business.id, isActive: false } });
function paidTipSession(pi: string) {
  return {
    id: `cs_tip_${pi}`, object: "checkout.session", payment_status: "paid", currency: "eur", amount_total: 1000,
    payment_intent: pi, metadata: { employeeId: inactive.id, businessId: business.id, source: "checkout_session" },
  } as unknown as Stripe.Checkout.Session;
}

await check("E1 ineligible tip: failed ledger row + durable refund; webhook replay adds nothing", async () => {
  calls.length = 0;
  behaviour = () => ({ id: `re_e1_${sfx}`, status: "succeeded", amount: 1000 }) as Stripe.Refund;
  const pi = `pi_e1_${sfx}`;
  await handleSuccessfulTipPayment(paidTipSession(pi));
  await handleSuccessfulTipPayment(paidTipSession(pi)); // Stripe redelivery
  const tip = await prisma.transaction.findUniqueOrThrow({ where: { stripePaymentIntentId: pi } });
  const op = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { operationKey: `eligibility_refund:${pi}` } });
  assert.equal(tip.status, "failed");
  assert.equal(op.status, "succeeded");
  assert.equal(op.transactionId, tip.id);
  assert.equal(calls.length, 1, "one refund call");
  const ledger = await prisma.tipRefund.findUnique({ where: { stripeRefundId: `re_e1_${sfx}` } });
  assert.equal(ledger?.status, "succeeded", "refund recorded in the tip refund ledger");
});

await check("E2 refund fails transiently at webhook time → pending operation, retried later", async () => {
  calls.length = 0;
  behaviour = (n) => {
    if (n === 1) throw stripeError("StripeAPIError", { statusCode: 503 });
    return { id: `re_e2_${sfx}`, status: "succeeded", amount: 1000 } as Stripe.Refund;
  };
  const pi = `pi_e2_${sfx}`;
  await handleSuccessfulTipPayment(paidTipSession(pi));
  let op = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { operationKey: `eligibility_refund:${pi}` } });
  assert.equal(op.status, "pending", "not abandoned: durable and scheduled");
  await makeDue(op.id);
  await retryDueRefundOperations();
  op = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: op.id } });
  assert.equal(op.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.key, calls[1]!.key);
});

await check("E3 crash between ledger row and refund request: webhook retry creates the refund operation", async () => {
  const pi = `pi_e3_${sfx}`;
  await prisma.transaction.create({ data: { amount: 10, status: "failed", businessId: business.id, employeeId: inactive.id, stripePaymentIntentId: pi } });
  behaviour = () => ({ id: `re_e3_${sfx}`, status: "succeeded" }) as Stripe.Refund;
  await handleSuccessfulTipPayment(paidTipSession(pi));
  const op = await prisma.stripeRefundOperation.findUnique({ where: { operationKey: `eligibility_refund:${pi}` } });
  assert.equal(op?.status, "succeeded");
});

__setRefundsCreateFnForTests(null);
__setRefundsListFnForTests(null);
__setPaymentIntentsRetrieveFnForTests(null);
await prisma.$disconnect();
console.log(`\npayment-integrity-refunds: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
