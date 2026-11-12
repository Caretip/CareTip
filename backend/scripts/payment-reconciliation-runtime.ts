/**
 * Stripe ↔ CareTip payment reconciliation for tips and QR print orders (audit M6 + QR phase 4).
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:payment-reconciliation
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
} from "../src/services/stripe.service.js";
import {
  __setReconciliationSessionsListFnForTests,
  runPaymentReconciliation,
} from "../src/services/payments/paymentReconciliation.service.js";
import { tryAcquirePaymentOperationLease, releasePaymentOperationLease } from "../src/lib/payments/operationLease.js";

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
const old = Math.floor(Date.now() / 1000) - 3600; // older than the settle window
const user = await prisma.user.create({
  data: { email: `recon-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true },
});
const business = await prisma.business.create({ data: { name: `Recon ${sfx}`, slug: `recon-${sfx}`, userId: user.id } });
const inactive = await prisma.employee.create({ data: { name: "Gone", jobTitle: "Server", businessId: business.id, isActive: false } });

let listing: Stripe.Checkout.Session[] = [];
__setReconciliationSessionsListFnForTests(async () => ({ sessions: listing, truncated: false }));
const pis = new Map<string, Partial<Stripe.PaymentIntent>>();
__setPaymentIntentsRetrieveFnForTests(async (id) => {
  const p = pis.get(id);
  if (!p) throw Object.assign(new Error("No such payment_intent"), { code: "resource_missing" });
  return { id, object: "payment_intent", metadata: {}, latest_charge: null, ...p } as Stripe.PaymentIntent;
});
const refundsByPi = new Map<string, Stripe.Refund[]>();
__setRefundsListFnForTests(async (pi) => refundsByPi.get(pi) ?? []);
__setRefundsCreateFnForTests(async (params) => ({ id: `re_recon_${params.payment_intent}`, status: "succeeded" }) as Stripe.Refund);

function charge(amount: number, refunded = 0, disputed = false) {
  return { id: `ch_${Math.random().toString(36).slice(2)}`, object: "charge", amount, amount_refunded: refunded, refunded: refunded >= amount, disputed } as unknown as Stripe.Charge;
}
function tipSession(pi: string, amount: number, extra: { refunded?: number; paid?: boolean; employeeId?: string } = {}) {
  const piObj = { id: pi, object: "payment_intent", status: "succeeded", amount, amount_received: amount, currency: "eur", latest_charge: charge(amount, extra.refunded ?? 0) };
  return {
    id: `cs_${pi}`, object: "checkout.session", created: old, currency: "eur", amount_total: amount,
    payment_status: extra.paid === false ? "unpaid" : "paid", status: "complete", payment_intent: piObj,
    metadata: { source: "checkout_session", businessId: business.id, employeeId: extra.employeeId ?? inactive.id },
  } as unknown as Stripe.Checkout.Session;
}
function qrSession(orderId: string, pi: string | null, amount: number, extra: { paid?: boolean; refunded?: number; disputed?: boolean; id?: string } = {}) {
  const piObj = pi ? { id: pi, object: "payment_intent", status: "succeeded", amount, amount_received: amount, currency: "eur", latest_charge: charge(amount, extra.refunded ?? 0, extra.disputed ?? false) } : null;
  return {
    id: extra.id ?? `cs_qr_${orderId}_${Math.random().toString(36).slice(2, 6)}`, object: "checkout.session", created: old, currency: "eur", amount_total: amount,
    payment_status: extra.paid === false ? "unpaid" : "paid", status: extra.paid === false ? "expired" : "complete", payment_intent: piObj,
    metadata: { source: "physical_qr_order", orderId, businessId: business.id },
  } as unknown as Stripe.Checkout.Session;
}
async function qrOrder(opts: { total?: number; status?: "PENDING" | "PAID"; pi?: string | null; session?: string | null } = {}) {
  return prisma.physicalQrOrder.create({
    data: {
      businessId: business.id, userId: user.id, totalAmount: opts.total ?? 1500, currency: "EUR", placedAt: new Date(),
      processingClass: "WITHIN_24_HOURS", processingDeadlineAt: new Date(Date.now() + 86_400_000), processingCopySnapshot: {},
      businessNameSnapshot: "Recon", paymentStatus: opts.status ?? "PENDING",
      fulfillmentStatus: opts.status === "PAID" ? "PROCESSING" : "PENDING_PAYMENT",
      stripePaymentIntentId: opts.pi ?? null, stripeCheckoutSessionId: opts.session ?? null,
    },
  });
}
const open = (kind: string, subjectKey: string) =>
  prisma.paymentDiscrepancy.findFirst({ where: { kind, subjectKey, status: "open" } });
const anyStatus = (kind: string, subjectKey: string) => prisma.paymentDiscrepancy.findFirst({ where: { kind, subjectKey } });

await check("RC1 paid tip with no CareTip record is detected; detection mode creates nothing", async () => {
  const pi = `pi_rc1_${sfx}`;
  listing = [tipSession(pi, 1000)];
  const r = await runPaymentReconciliation({ repair: false });
  assert.equal(r.tipsChecked, 1);
  assert.ok(await open("tip_missing", `tip:${pi}`));
  assert.equal(await prisma.transaction.count({ where: { stripePaymentIntentId: pi } }), 0, "never blindly creates a tip");
});

await check("RC2 repair re-runs the verified webhook path (here: ineligible → failed tip + refund)", async () => {
  const pi = `pi_rc1_${sfx}`;
  pis.set(pi, { status: "succeeded", amount: 1000, amount_received: 1000, currency: "eur" });
  const r = await runPaymentReconciliation({ repair: true });
  const tip = await prisma.transaction.findUnique({ where: { stripePaymentIntentId: pi } });
  assert.equal(tip?.status, "failed", "eligibility re-checked: ineligible employee → no success tip");
  assert.ok(r.repaired >= 1);
  assert.equal((await anyStatus("tip_missing", `tip:${pi}`))?.status, "auto_repaired");
  const op = await prisma.stripeRefundOperation.findUnique({ where: { operationKey: `eligibility_refund:${pi}` } });
  assert.equal(op?.status, "succeeded", "captured money for the ineligible tip is refunded");
});

await check("RC3 amount and refund mismatches are recorded; repair pulls missing refunds from Stripe", async () => {
  const pi = `pi_rc3_${sfx}`;
  const tip = await prisma.transaction.create({ data: { amount: 10, status: "success", businessId: business.id, employeeId: inactive.id, stripePaymentIntentId: pi } });
  listing = [tipSession(pi, 1500, { refunded: 500 })];
  await runPaymentReconciliation({ repair: false });
  assert.ok(await open("tip_amount_mismatch", `tip:${pi}`));
  assert.ok(await open("tip_refund_mismatch", `tip:${pi}`));
  refundsByPi.set(pi, [{ id: `re_rc3_${sfx}`, amount: 500, currency: "eur", status: "succeeded", created: old, charge: "ch_x" } as unknown as Stripe.Refund]);
  await runPaymentReconciliation({ repair: true });
  assert.equal((await anyStatus("tip_refund_mismatch", `tip:${pi}`))?.status, "auto_repaired");
  assert.ok(await open("tip_amount_mismatch", `tip:${pi}`), "amount mismatches are never auto-changed");
  assert.equal((await prisma.tipRefund.findUnique({ where: { stripeRefundId: `re_rc3_${sfx}` } }))?.tipId, tip.id);
});

await check("RC4 local success tip whose PaymentIntent Stripe does not have → discrepancy", async () => {
  const pi = `pi_rc4_${sfx}`;
  await prisma.transaction.create({
    data: { amount: 12, status: "success", businessId: business.id, employeeId: inactive.id, stripePaymentIntentId: pi, createdAt: new Date(Date.now() - 2 * 3600_000) },
  });
  listing = [];
  await runPaymentReconciliation({ repair: false });
  assert.ok(await open("local_tip_without_stripe_payment", `tip:${pi}`));
});

await check("RC5 failed tip that Stripe charged and nobody refunded → discrepancy", async () => {
  const pi = `pi_rc5_${sfx}`;
  await prisma.transaction.create({ data: { amount: 10, status: "failed", businessId: business.id, employeeId: inactive.id, stripePaymentIntentId: pi } });
  listing = [tipSession(pi, 1000)];
  await runPaymentReconciliation({ repair: false });
  assert.ok(await open("failed_tip_not_refunded", `tip:${pi}`));
});

await check("RC6 QR: paid session but order still PENDING → detected, then repaired via the webhook path", async () => {
  const o = await qrOrder({ session: `cs_rc6_${sfx}` });
  const pi = `pi_rc6_${sfx}`;
  pis.set(pi, { status: "succeeded", amount: 1500, amount_received: 1500, currency: "eur" });
  listing = [qrSession(o.id, pi, 1500, { id: `cs_rc6_${sfx}` })];
  await runPaymentReconciliation({ repair: false });
  assert.ok(await open("paid_session_pending_order", `qr_order:${o.id}`));
  assert.equal((await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus, "PENDING");
  await runPaymentReconciliation({ repair: true });
  assert.equal((await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus, "PAID");
  assert.notEqual((await anyStatus("paid_session_pending_order", `qr_order:${o.id}`))?.status, "open");
});

await check("RC7 QR: order marked paid but its only session never collected money → discrepancy", async () => {
  const o = await qrOrder({ status: "PAID", session: `cs_rc7_${sfx}` });
  listing = [qrSession(o.id, null, 1500, { paid: false, id: `cs_rc7_${sfx}` })];
  await runPaymentReconciliation({ repair: false });
  assert.ok(await open("order_paid_without_payment", `qr_order:${o.id}`));
});

await check("RC8 QR: two paid sessions for one order → multiple_paid_sessions", async () => {
  const pi = `pi_rc8a_${sfx}`;
  const o = await qrOrder({ status: "PAID", pi });
  listing = [qrSession(o.id, pi, 1500), qrSession(o.id, `pi_rc8b_${sfx}`, 1500)];
  await runPaymentReconciliation({ repair: false });
  assert.ok(await open("multiple_paid_sessions", `qr_order:${o.id}`));
  assert.ok(await open("duplicate_payment_unrefunded", `qr_order:${o.id}`));
});

await check("RC9 QR: Stripe refund/dispute not reflected locally → detected; repair applies refunds", async () => {
  const pi = `pi_rc9_${sfx}`;
  const o = await qrOrder({ status: "PAID", pi });
  listing = [qrSession(o.id, pi, 1500, { refunded: 1500, disputed: true })];
  await runPaymentReconciliation({ repair: false });
  assert.ok(await open("order_refund_mismatch", `qr_order:${o.id}`));
  assert.ok(await open("order_dispute_not_recorded", `qr_order:${o.id}`));
  refundsByPi.set(pi, [{ id: `re_rc9_${sfx}`, amount: 1500, currency: "eur", status: "succeeded", created: old, charge: "ch_y" } as unknown as Stripe.Refund]);
  await runPaymentReconciliation({ repair: true });
  assert.equal((await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus, "REFUNDED");
  assert.equal((await anyStatus("order_refund_mismatch", `qr_order:${o.id}`))?.status, "auto_repaired");
});

await check("RC10 a consistent re-check resolves earlier findings", async () => {
  const pi = `pi_rc10_${sfx}`;
  listing = [tipSession(pi, 1000)];
  await runPaymentReconciliation({ repair: false });
  assert.ok(await open("tip_missing", `tip:${pi}`));
  await prisma.transaction.create({ data: { amount: 10, status: "success", businessId: business.id, employeeId: inactive.id, stripePaymentIntentId: pi } });
  await runPaymentReconciliation({ repair: false });
  assert.equal((await anyStatus("tip_missing", `tip:${pi}`))?.status, "resolved");
});

await check("RC11 one reconciliation run at a time across instances", async () => {
  const lease = await tryAcquirePaymentOperationLease("payment_reconciliation", 60_000);
  assert.ok(lease);
  const r = await runPaymentReconciliation({ repair: false });
  assert.equal(r.skipped, "already_running");
  await releasePaymentOperationLease(lease!);
});

__setReconciliationSessionsListFnForTests(null);
__setPaymentIntentsRetrieveFnForTests(null);
__setRefundsListFnForTests(null);
__setRefundsCreateFnForTests(null);
await prisma.$disconnect();
console.log(`\npayment-reconciliation: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
