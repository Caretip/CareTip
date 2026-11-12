/**
 * QR print order fulfilment policies (2026-11): held orders never print or advance; QR Checkout is
 * restricted to immediate-confirmation payment methods.
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:payment-qr-policy
 *
 * Disposable loopback Postgres only. Stripe is never contacted: every Stripe call is stubbed.
 */
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import { __setPaymentIntentsRetrieveFnForTests, __setRefundsCreateFnForTests, getStripeClient } from "../src/services/stripe.service.js";
import { handlePhysicalQrCheckoutSessionCompleted } from "../src/services/physicalQr/physicalQrWebhook.service.js";
import { createPhysicalQrBatchCheckoutSession } from "../src/services/physicalQr/physicalQrBatch.service.js";
import {
  getPhysicalQrOrderForAdmin,
  markPhysicalQrOrderPrinting,
  markPhysicalQrOrderProcessing,
  shipPhysicalQrOrder,
  deliverPhysicalQrOrder,
} from "../src/services/physicalQr/physicalQrFulfillment.service.js";
import { buildPhysicalQrOrderPdfForAdmin, buildPhysicalQrOrdersZipForAdmin } from "../src/services/physicalQr/physicalQrAdminPrint.service.js";
import { upsertStripeDisputeEvent, upsertStripeRefundEvent } from "../src/services/finance/tipRefunds.service.js";
import {
  __setReconciliationSessionsListFnForTests,
  runPaymentReconciliation,
} from "../src/services/payments/paymentReconciliation.service.js";
import {
  PHYSICAL_QR_HELD_PAYMENT_STATUSES,
  isPhysicalQrPaymentFulfillable,
  isPhysicalQrPaymentHeld,
  physicalQrFulfillmentBlock,
} from "../src/lib/physicalQr/fulfillmentEligibility.js";
import { PHYSICAL_QR_CHECKOUT_PAYMENT_METHOD_TYPES } from "../src/config/physicalQrCheckout.js";
// Frontend helper (type-only imports, safe to load here): must agree with the server rule.
import { isPhysicalQrFulfillable, physicalQrFulfillmentHoldKey } from "../../src/app/lib/physicalQrOrderUi.js";

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
const rejectsWith = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (err: { code?: string }) => {
    assert.equal(err.code, code);
    return true;
  });

const sfx = Date.now().toString(36);
const PRODUCT = "caretip-a5-flyer-no-address";
await prisma.physicalQrProduct.update({ where: { id: PRODUCT }, data: { priceCents: 990, orderable: true } });
const user = await prisma.user.create({ data: { email: `qrpol-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true } });
const business = await prisma.business.create({ data: { name: `QR Policy ${sfx}`, slug: `qrpol-${sfx}`, userId: user.id } });

const pis = new Map<string, Partial<Stripe.PaymentIntent>>();
__setPaymentIntentsRetrieveFnForTests(async (id) => {
  const p = pis.get(id);
  if (!p) throw Object.assign(new Error("No such payment_intent"), { type: "StripeInvalidRequestError", code: "resource_missing" });
  return { id, object: "payment_intent", metadata: {}, latest_charge: null, ...p } as Stripe.PaymentIntent;
});
const refundCalls: string[] = [];
__setRefundsCreateFnForTests(async (params) => {
  refundCalls.push(String(params.payment_intent));
  return { id: `re_pol_${refundCalls.length}`, status: "succeeded" } as Stripe.Refund;
});

let n = 0;
async function order(opts: { payment?: string; fulfillment?: string; total?: number; pi?: string | null; session?: string | null } = {}) {
  n += 1;
  return prisma.physicalQrOrder.create({
    data: {
      businessId: business.id, userId: user.id, productId: PRODUCT, qrContextType: "storefront",
      qrTargetUrlSnapshot: `https://example.test/pol/${sfx}/${n}`, quantity: 10, totalAmount: opts.total ?? 1500, currency: "EUR",
      placedAt: new Date(), processingClass: "WITHIN_24_HOURS", processingDeadlineAt: new Date(Date.now() + 86_400_000),
      processingCopySnapshot: {}, businessNameSnapshot: "QR Policy",
      paymentStatus: (opts.payment ?? "PENDING") as never,
      fulfillmentStatus: (opts.fulfillment ?? "PENDING_PAYMENT") as never,
      stripePaymentIntentId: opts.pi ?? null, stripeCheckoutSessionId: opts.session ?? null,
      paidAt: opts.payment && opts.payment !== "PENDING" ? new Date() : null,
    },
  });
}
const session = (o: { id: string }, id: string, pi: string, amount = 1500, extra: Record<string, unknown> = {}) =>
  ({ id, object: "checkout.session", amount_total: amount, currency: "eur", payment_status: "paid", status: "complete", payment_intent: pi, created: Math.floor(Date.now() / 1000) - 3600, metadata: { source: "physical_qr_order", orderId: o.id, businessId: business.id }, ...extra }) as unknown as Stripe.Checkout.Session;
const reload = (id: string) => prisma.physicalQrOrder.findUniqueOrThrow({ where: { id } });

/** An order whose payment did not match: IN_REVIEW, as produced by the real webhook path. */
async function inReviewOrder() {
  const o = await order({ total: 1900, session: `cs_rev_${sfx}_${n + 1}` });
  const pi = `pi_rev_${sfx}_${o.id.slice(-6)}`;
  pis.set(pi, { status: "succeeded", amount: 1500, amount_received: 1500, currency: "eur" });
  await handlePhysicalQrCheckoutSessionCompleted(session(o, o.stripeCheckoutSessionId!, pi));
  const after = await reload(o.id);
  assert.equal(after.paymentStatus, "IN_REVIEW");
  return { order: after, pi };
}

// ── Decision A: IN_REVIEW stays on hold everywhere ──
await check("A1 IN_REVIEW order cannot be printed (admin print + bulk print)", async () => {
  const { order: o } = await inReviewOrder();
  await rejectsWith(buildPhysicalQrOrderPdfForAdmin(await getPhysicalQrOrderForAdmin(o.id)), "FULFILLMENT_ON_HOLD");
  const zip = await buildPhysicalQrOrdersZipForAdmin([o.id]);
  assert.equal(zip.prepared, 0);
  assert.equal(zip.zip, null);
});

await check("A2 IN_REVIEW order cannot enter fulfillment through the admin transition routes", async () => {
  const { order: o } = await inReviewOrder();
  await rejectsWith(markPhysicalQrOrderProcessing(o.id), "FULFILLMENT_ON_HOLD");
  await rejectsWith(markPhysicalQrOrderPrinting(o.id), "FULFILLMENT_ON_HOLD");
  await rejectsWith(shipPhysicalQrOrder({ orderId: o.id, carrier: "DHL", trackingNumber: "1", trackingUrl: "" }), "FULFILLMENT_ON_HOLD");
  const after = await reload(o.id);
  assert.equal(after.fulfillmentStatus, "PENDING_PAYMENT");
  assert.equal(after.paymentStatus, "IN_REVIEW");
});

await check("A3 webhook redelivery and a later matching payment cannot release a review hold", async () => {
  const { order: o, pi } = await inReviewOrder();
  await handlePhysicalQrCheckoutSessionCompleted(session(o, o.stripeCheckoutSessionId!, pi)); // replay
  assert.equal((await reload(o.id)).paymentStatus, "IN_REVIEW");
  // A second, correctly sized payment: not used to fulfil; it is a duplicate charge and is refunded.
  const pi2 = `pi_rev2_${sfx}_${o.id.slice(-6)}`;
  pis.set(pi2, { status: "succeeded", amount: 1900, amount_received: 1900, currency: "eur" });
  const before = refundCalls.length;
  const r = await handlePhysicalQrCheckoutSessionCompleted(session(o, `cs_rev2_${sfx}`, pi2, 1900));
  const after = await reload(o.id);
  assert.equal(r.reason, "duplicate_payment_refunded");
  assert.equal(after.paymentStatus, "IN_REVIEW");
  assert.equal(after.stripePaymentIntentId, pi, "original payment reference preserved");
  assert.equal(refundCalls.length - before, 1);
});

await check("A4 reconciliation repair cannot fulfil an IN_REVIEW order", async () => {
  const { order: o, pi } = await inReviewOrder();
  __setReconciliationSessionsListFnForTests(async () => ({
    sessions: [session(o, o.stripeCheckoutSessionId!, pi, 1500, { payment_intent: { id: pi, object: "payment_intent", status: "succeeded", amount: 1500, amount_received: 1500, currency: "eur", latest_charge: { id: "ch_x", amount: 1500, amount_refunded: 0, refunded: false, disputed: false } } })],
    truncated: false,
  }));
  await runPaymentReconciliation({ repair: true });
  __setReconciliationSessionsListFnForTests(null);
  const after = await reload(o.id);
  assert.equal(after.paymentStatus, "IN_REVIEW");
  assert.equal(after.fulfillmentStatus, "PENDING_PAYMENT");
  assert.equal(await prisma.physicalQrOrder.count({ where: { stripePaymentIntentId: pi } }), 1, "no duplicate order");
});

await check("A5 an authorized resolution preserves payment history; refund records stay authoritative", async () => {
  // No admin release action exists (documented). Simulate the operator's recorded decision
  // (approve for fulfilment) as a direct status change, then verify history and later events.
  const { order: o, pi } = await inReviewOrder();
  assert.equal(o.paidAt, null, "a held payment is never recorded as an accepted payment");
  const discrepancy = await prisma.paymentDiscrepancy.findFirst({ where: { kind: "payment_needs_review", physicalQrOrderId: o.id } });
  assert.ok(discrepancy, "the review finding (amounts received vs. expected) is on record");
  assert.equal((discrepancy!.details as { amountReceived?: number }).amountReceived, 1500);
  const decidedAt = new Date();
  await prisma.physicalQrOrder.update({ where: { id: o.id }, data: { paymentStatus: "PAID", fulfillmentStatus: "PROCESSING", paidAt: decidedAt } });
  const resolved = await reload(o.id);
  assert.equal(resolved.stripePaymentIntentId, pi, "payment reference unchanged by the resolution");
  assert.equal(resolved.stripeCheckoutSessionId, o.stripeCheckoutSessionId);
  assert.equal(await prisma.paymentDiscrepancy.count({ where: { id: discrepancy!.id } }), 1, "finding is not deleted");
  await upsertStripeRefundEvent({ stripeRefundId: `re_res_${sfx}`, stripePaymentIntentId: pi, amountCents: 500, currency: "eur", status: "succeeded", occurredAt: new Date() });
  const after = await reload(o.id);
  assert.equal(after.paymentStatus, "PARTIALLY_REFUNDED", "a later refund still holds the order");
  assert.equal(await prisma.physicalQrPaymentAdjustment.count({ where: { orderId: o.id } }), 1);
});

// ── Decision B: partially refunded, refunded and disputed orders are held ──
for (const status of ["PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"] as const) {
  await check(`B ${status} order cannot be printed or advanced (customer state preserved)`, async () => {
    const o = await order({ payment: status, fulfillment: "PROCESSING", pi: `pi_b_${status}_${sfx}` });
    await rejectsWith(buildPhysicalQrOrderPdfForAdmin(await getPhysicalQrOrderForAdmin(o.id)), "FULFILLMENT_ON_HOLD");
    await rejectsWith(markPhysicalQrOrderPrinting(o.id), "FULFILLMENT_ON_HOLD");
    const after = await reload(o.id);
    assert.equal(after.fulfillmentStatus, "PROCESSING");
    assert.equal(after.paymentStatus, status);
  });
}

await check("B4 a refund that lands on a printing order stops shipping; delivery of a shipped order is still recordable", async () => {
  const pi = `pi_b4_${sfx}`;
  const printing = await order({ payment: "PAID", fulfillment: "PRINTING", pi });
  await upsertStripeRefundEvent({ stripeRefundId: `re_b4_${sfx}`, stripePaymentIntentId: pi, amountCents: 200, currency: "eur", status: "succeeded", occurredAt: new Date() });
  await rejectsWith(shipPhysicalQrOrder({ orderId: printing.id, carrier: "DHL", trackingNumber: "1", trackingUrl: "" }), "FULFILLMENT_ON_HOLD");
  const shipped = await order({ payment: "DISPUTED", fulfillment: "SHIPPED", pi: `pi_b4s_${sfx}` });
  const delivered = await deliverPhysicalQrOrder(shipped.id);
  assert.equal(delivered.fulfillmentStatus, "DELIVERED");
});

await check("B5 dispute won → still held until a platform admin re-verifies; history intact", async () => {
  const pi = `pi_b5_${sfx}`;
  const o = await order({ payment: "PAID", fulfillment: "PROCESSING", pi });
  await upsertStripeDisputeEvent({ stripeDisputeId: `dp_b5_${sfx}`, stripePaymentIntentId: pi, amountCents: 1500, currency: "eur", status: "needs_response", occurredAt: new Date() });
  await rejectsWith(markPhysicalQrOrderPrinting(o.id), "FULFILLMENT_ON_HOLD");
  await upsertStripeDisputeEvent({ stripeDisputeId: `dp_b5_${sfx}`, stripePaymentIntentId: pi, amountCents: 1500, currency: "eur", status: "won", occurredAt: new Date() });
  assert.equal((await reload(o.id)).paymentStatus, "IN_REVIEW");
  await rejectsWith(markPhysicalQrOrderPrinting(o.id), "FULFILLMENT_ON_HOLD");
  assert.equal((await prisma.physicalQrPaymentAdjustment.findFirst({ where: { stripeDisputeId: `dp_b5_${sfx}` } }))?.status, "won");
});

await check("B6 unpaid orders are 'payment required', never printable", async () => {
  for (const status of ["PENDING", "FAILED", "CANCELLED"]) {
    assert.equal(physicalQrFulfillmentBlock(status)?.code, "PAYMENT_REQUIRED");
  }
  const o = await order();
  await rejectsWith(buildPhysicalQrOrderPdfForAdmin(await getPhysicalQrOrderForAdmin(o.id)), "PAYMENT_REQUIRED");
  await rejectsWith(markPhysicalQrOrderProcessing(o.id), "PAYMENT_REQUIRED");
});

await check("B7 frontend and backend agree on every payment status", async () => {
  const all = ["PENDING", "PAID", "FAILED", "CANCELLED", ...PHYSICAL_QR_HELD_PAYMENT_STATUSES];
  for (const s of all) {
    assert.equal(isPhysicalQrFulfillable(s), isPhysicalQrPaymentFulfillable(s), `fulfillable mismatch for ${s}`);
    assert.equal(physicalQrFulfillmentHoldKey(s) !== null, isPhysicalQrPaymentHeld(s), `hold mismatch for ${s}`);
  }
});

// ── Decision C: immediate-confirmation payment methods only ──
const createParams: Stripe.Checkout.SessionCreateParams[] = [];
const stripe = getStripeClient() as unknown as { checkout: { sessions: Record<string, unknown> } };
stripe.checkout.sessions.create = async (params: Stripe.Checkout.SessionCreateParams) => {
  createParams.push(params);
  const amount = (params.line_items?.[0] as { price_data?: { unit_amount?: number } })?.price_data?.unit_amount ?? 0;
  return { id: `cs_pol_${createParams.length}_${sfx}`, status: "open", payment_status: "unpaid", url: "https://checkout.stripe.test/p", amount_total: amount, currency: "eur", expires_at: Math.floor(Date.now() / 1000) + 86_400 };
};

await check("C1 QR Checkout requests card only, never a Dashboard payment-method configuration", async () => {
  assert.deepEqual([...PHYSICAL_QR_CHECKOUT_PAYMENT_METHOD_TYPES], ["card"]);
  const o = await order();
  await createPhysicalQrBatchCheckoutSession({ businessId: business.id, userId: user.id, orderId: o.id });
  const p = createParams.at(-1)!;
  assert.deepEqual(p.payment_method_types, ["card"]);
  assert.equal((p as { payment_method_configuration?: unknown }).payment_method_configuration, undefined);
  assert.equal((p as { automatic_payment_methods?: unknown }).automatic_payment_methods, undefined);
  assert.ok(!JSON.stringify(p).includes("sepa_debit"));
});

await check("C2 a completed but unpaid session never permits fulfilment", async () => {
  const o = await order({ session: `cs_c2_${sfx}` });
  await handlePhysicalQrCheckoutSessionCompleted(session(o, `cs_c2_${sfx}`, `pi_c2_${sfx}`, 1500, { payment_status: "unpaid" }));
  await rejectsWith(markPhysicalQrOrderProcessing(o.id), "PAYMENT_REQUIRED");
  pis.set(`pi_c3_${sfx}`, { status: "processing", amount: 1500, amount_received: 0, currency: "eur" });
  const o2 = await order({ session: `cs_c3_${sfx}` });
  await handlePhysicalQrCheckoutSessionCompleted(session(o2, `cs_c3_${sfx}`, `pi_c3_${sfx}`));
  assert.equal((await reload(o2.id)).paymentStatus, "PENDING", "processing PaymentIntent is not paid");
});

await check("C3 a valid paid session completes the normal lifecycle (paid → printing → shipped → delivered)", async () => {
  const o = await order({ session: `cs_c4_${sfx}` });
  pis.set(`pi_c4_${sfx}`, { status: "succeeded", amount: 1500, amount_received: 1500, currency: "eur" });
  await handlePhysicalQrCheckoutSessionCompleted(session(o, `cs_c4_${sfx}`, `pi_c4_${sfx}`));
  assert.equal((await reload(o.id)).paymentStatus, "PAID");
  const pdfRow = await getPhysicalQrOrderForAdmin(o.id);
  assert.equal(physicalQrFulfillmentBlock(pdfRow.paymentStatus), null, "printable");
  await markPhysicalQrOrderPrinting(o.id);
  await shipPhysicalQrOrder({ orderId: o.id, carrier: "DHL", trackingNumber: "T1", trackingUrl: "" });
  const done = await deliverPhysicalQrOrder(o.id);
  assert.equal(done.fulfillmentStatus, "DELIVERED");
});

__setPaymentIntentsRetrieveFnForTests(null);
__setRefundsCreateFnForTests(null);
await prisma.$disconnect();
console.log(`\npayment-qr-policy: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
