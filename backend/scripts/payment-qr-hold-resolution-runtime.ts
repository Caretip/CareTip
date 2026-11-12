/**
 * Platform-admin resolution of held QR print orders: authorization, allowed transitions, Stripe
 * re-verification, atomicity/concurrency and audit trail.
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:payment-qr-hold-resolution
 *
 * Disposable loopback Postgres; loopback HTTP; Stripe stubbed (never contacted).
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import { signJwt } from "../src/lib/jwtConfig.js";
import { __setPaymentIntentsRetrieveFnForTests } from "../src/services/stripe.service.js";
import { releasePhysicalQrOrderHold } from "../src/services/physicalQr/physicalQrHoldResolution.service.js";
import { markPhysicalQrOrderPrinting } from "../src/services/physicalQr/physicalQrFulfillment.service.js";
import { upsertStripeDisputeEvent, upsertStripeRefundEvent } from "../src/services/finance/tipRefunds.service.js";
import { physicalQrOrderFulfillmentBlock } from "../src/lib/physicalQr/fulfillmentEligibility.js";
import { recordPaymentDiscrepancy } from "../src/services/payments/paymentDiscrepancy.service.js";
import { isPhysicalQrFulfillable } from "../../src/app/lib/physicalQrOrderUi.js";

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
const mkUser = (tag: string, data: Record<string, unknown>) =>
  prisma.user.create({ data: { email: `hold-${tag}-${sfx}@example.com`, passwordHash: "x", emailVerified: true, ...data } as never });
const manager = await mkUser("mgr", { role: "MANAGER" });
const admin = await mkUser("admin", { role: "SUPER_ADMIN", isPlatformAdmin: true });
const superNoPlatform = await mkUser("super", { role: "SUPER_ADMIN", isPlatformAdmin: false });
const business = await prisma.business.create({ data: { name: `Hold ${sfx}`, slug: `hold-${sfx}`, userId: manager.id } });

// Stripe PaymentIntents (+ latest charge) as Stripe reports them now.
const pis = new Map<string, { status?: string; amount_received?: number; currency?: string; refunded?: number; disputed?: boolean }>();
let retrieveHook: ((id: string) => Promise<void>) | null = null;
__setPaymentIntentsRetrieveFnForTests(async (id) => {
  if (retrieveHook) await retrieveHook(id);
  const p = pis.get(id);
  if (!p) throw Object.assign(new Error("Stripe unreachable"), { type: "StripeConnectionError" });
  return {
    id, object: "payment_intent", status: p.status ?? "succeeded", amount: p.amount_received ?? 1500, amount_received: p.amount_received ?? 1500,
    currency: p.currency ?? "eur", metadata: {},
    latest_charge: { id: `ch_${id}`, object: "charge", amount: p.amount_received ?? 1500, amount_refunded: p.refunded ?? 0, disputed: p.disputed ?? false },
  } as unknown as Stripe.PaymentIntent;
});

let n = 0;
async function heldOrder(payment: "IN_REVIEW" | "PARTIALLY_REFUNDED" | "REFUNDED" | "DISPUTED" | "PAID", opts: { fulfillment?: string; total?: number } = {}) {
  n += 1;
  const pi = `pi_hold_${sfx}_${n}`;
  const o = await prisma.physicalQrOrder.create({
    data: {
      businessId: business.id, userId: manager.id, productId: "caretip-a5-flyer-no-address", qrContextType: "storefront",
      qrTargetUrlSnapshot: `https://example.test/hold/${sfx}/${n}`, quantity: 5, totalAmount: opts.total ?? 1500, currency: "EUR",
      placedAt: new Date(), processingClass: "WITHIN_24_HOURS", processingDeadlineAt: new Date(Date.now() + 86_400_000),
      processingCopySnapshot: {}, businessNameSnapshot: "Hold", paymentStatus: payment as never,
      fulfillmentStatus: (opts.fulfillment ?? (payment === "IN_REVIEW" ? "PENDING_PAYMENT" : "PROCESSING")) as never,
      stripePaymentIntentId: pi, stripeCheckoutSessionId: `cs_hold_${sfx}_${n}`,
    },
  });
  pis.set(pi, {});
  if (payment === "IN_REVIEW") {
    await recordPaymentDiscrepancy({ workflow: "qr_order", kind: "payment_needs_review", subjectKey: `qr_order:${o.id}`, physicalQrOrderId: o.id, alert: false });
  }
  return { o, pi };
}
const release = (orderId: string, expected: string, reason = "Verified the bank transfer note with the customer by phone.") =>
  releasePhysicalQrOrderHold({ orderId, adminUserId: admin.id, reason, expectedPaymentStatus: expected });
const reload = (id: string) => prisma.physicalQrOrder.findUniqueOrThrow({ where: { id } });
async function partialRefund(pi: string, refundId: string, cents: number) {
  await upsertStripeRefundEvent({ stripeRefundId: refundId, stripePaymentIntentId: pi, amountCents: cents, currency: "eur", status: "succeeded", occurredAt: new Date() });
  pis.set(pi, { ...(pis.get(pi) ?? {}), refunded: (pis.get(pi)?.refunded ?? 0) + cents });
}

// ── HTTP authorization through the real platform router ──
const platformRouter = (await import("../src/routes/platform.routes.js")).default;
const app = express();
app.use(express.json());
app.use("/api/platform", platformRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/platform`;
const token = (u: { id: string; role: string; authTokenVersion: number }) => signJwt({ sub: u.id, role: u.role, type: "access", tv: u.authTokenVersion }, "10m");
const postRelease = async (orderId: string, auth: string | null, body: Record<string, unknown>) => {
  const res = await fetch(`${base}/physical-qr/orders/${orderId}/release-hold`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

await check("A1 only platform admins can release a hold (401 anonymous, 403 manager / non-platform super admin)", async () => {
  const { o } = await heldOrder("IN_REVIEW");
  const body = { reason: "Checked the payment in Stripe and with the business.", expectedPaymentStatus: "IN_REVIEW" };
  assert.equal((await postRelease(o.id, null, body)).status, 401);
  assert.equal((await postRelease(o.id, token(manager), body)).status, 403);
  assert.equal((await postRelease(o.id, token(superNoPlatform), body)).status, 403);
  assert.equal((await reload(o.id)).paymentStatus, "IN_REVIEW", "unchanged after refused attempts");
  const ok = await postRelease(o.id, token(admin), body);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const res = await prisma.physicalQrHoldResolution.findFirstOrThrow({ where: { orderId: o.id } });
  assert.equal(res.adminUserId, admin.id, "the acting admin is recorded");
});

await check("A2 the business manager's own QR routes offer no release action", async () => {
  const routes = (await import("node:fs")).readFileSync("src/routes/physicalQr.routes.ts", "utf8");
  assert.ok(!/release|resolve-hold/i.test(routes));
});

// ── Transitions ──
await check("T1 IN_REVIEW release → PAID/PROCESSING; review finding resolved; history kept; audit written", async () => {
  const { o, pi } = await heldOrder("IN_REVIEW", { total: 1900 });
  const r = await release(o.id, "IN_REVIEW");
  const after = await reload(o.id);
  assert.equal(r.paymentStatus, "PAID");
  assert.equal(after.paymentStatus, "PAID");
  assert.equal(after.fulfillmentStatus, "PROCESSING");
  assert.ok(after.paidAt);
  assert.equal(after.stripePaymentIntentId, pi, "payment reference unchanged");
  const res = await prisma.physicalQrHoldResolution.findUniqueOrThrow({ where: { id: r.resolutionId } });
  assert.equal(res.previousPaymentStatus, "IN_REVIEW");
  assert.equal(res.newPaymentStatus, "PAID");
  assert.equal(res.verifiedAmountReceivedCents, 1500);
  assert.ok(res.reason.length >= 10);
  assert.equal((await prisma.paymentDiscrepancy.findFirstOrThrow({ where: { physicalQrOrderId: o.id, kind: "payment_needs_review" } })).status, "resolved");
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "physical_qr.hold_released", userId: admin.id, metadata: { contains: o.id } } }));
});

await check("T2 a reason is mandatory (and bounded)", async () => {
  const { o } = await heldOrder("IN_REVIEW");
  await rejectsWith(release(o.id, "IN_REVIEW", "ok"), "REASON_REQUIRED");
  await rejectsWith(release(o.id, "IN_REVIEW", "x".repeat(1001)), "REASON_REQUIRED");
  assert.equal((await reload(o.id)).paymentStatus, "IN_REVIEW");
});

await check("T3 acting on a stale screen is refused", async () => {
  const { o } = await heldOrder("IN_REVIEW");
  await rejectsWith(release(o.id, "PARTIALLY_REFUNDED"), "ORDER_STATE_CHANGED");
});

await check("T4 refunded, disputed and paid orders cannot be released", async () => {
  for (const s of ["REFUNDED", "DISPUTED", "PAID"] as const) {
    const { o } = await heldOrder(s);
    await rejectsWith(release(o.id, s), "HOLD_NOT_RELEASABLE");
    assert.equal((await reload(o.id)).paymentStatus, s);
  }
});

await check("T5 Stripe shows a dispute, a failed payment, or other refunds → refused", async () => {
  const a = await heldOrder("IN_REVIEW");
  pis.set(a.pi, { disputed: true });
  await rejectsWith(release(a.o.id, "IN_REVIEW"), "PAYMENT_DISPUTED");
  const b = await heldOrder("IN_REVIEW");
  pis.set(b.pi, { status: "canceled", amount_received: 0 });
  await rejectsWith(release(b.o.id, "IN_REVIEW"), "PAYMENT_NOT_SUCCEEDED");
  const c = await heldOrder("IN_REVIEW");
  pis.set(c.pi, { refunded: 300 });
  await rejectsWith(release(c.o.id, "IN_REVIEW"), "REFUNDS_NOT_RECONCILED");
});

await check("T6 another open payment finding for the order blocks release", async () => {
  const { o } = await heldOrder("IN_REVIEW");
  await recordPaymentDiscrepancy({ workflow: "qr_order", kind: "order_refund_mismatch", subjectKey: `qr_order:${o.id}`, physicalQrOrderId: o.id, alert: false });
  await rejectsWith(release(o.id, "IN_REVIEW"), "OPEN_PAYMENT_DISCREPANCY");
});

await check("T7 Stripe unreachable → 503, nothing changes", async () => {
  const { o, pi } = await heldOrder("IN_REVIEW");
  pis.delete(pi);
  await rejectsWith(release(o.id, "IN_REVIEW"), "STRIPE_UNAVAILABLE");
  assert.equal((await reload(o.id)).paymentStatus, "IN_REVIEW");
});

await check("P1 PARTIALLY_REFUNDED release: status stays truthful, fulfilment allowed; any later refund re-holds", async () => {
  const { o, pi } = await heldOrder("PAID", { fulfillment: "PROCESSING" });
  await partialRefund(pi, `re_p1a_${sfx}`, 500);
  assert.equal((await reload(o.id)).paymentStatus, "PARTIALLY_REFUNDED");
  await rejectsWith(markPhysicalQrOrderPrinting(o.id), "FULFILLMENT_ON_HOLD");
  await release(o.id, "PARTIALLY_REFUNDED", "Shipping refunded only; the prints are still owed to the customer.");
  let after = await reload(o.id);
  assert.equal(after.paymentStatus, "PARTIALLY_REFUNDED");
  assert.equal(after.holdReleaseRefundedCents, 500);
  assert.equal(physicalQrOrderFulfillmentBlock(after), null, "printable after the decision");
  assert.equal(isPhysicalQrFulfillable(after.paymentStatus, after.holdReleasedAt?.toISOString()), true, "frontend agrees");
  // Replaying the same refund event changes nothing.
  await upsertStripeRefundEvent({ stripeRefundId: `re_p1a_${sfx}`, stripePaymentIntentId: pi, amountCents: 500, currency: "eur", status: "succeeded", occurredAt: new Date() });
  assert.ok((await reload(o.id)).holdReleasedAt, "replay keeps the release");
  await markPhysicalQrOrderPrinting(o.id);
  // A further refund invalidates the decision.
  await partialRefund(pi, `re_p1b_${sfx}`, 200);
  after = await reload(o.id);
  assert.equal(after.holdReleasedAt, null);
  assert.equal(physicalQrOrderFulfillmentBlock(after)?.code, "FULFILLMENT_ON_HOLD");
  assert.equal(await prisma.physicalQrHoldResolution.count({ where: { orderId: o.id } }), 1, "history kept");
});

await check("P2 a dispute after a release re-holds; open disputes block release; won → held until re-verified, then releasable", async () => {
  const { o, pi } = await heldOrder("PAID", { fulfillment: "PROCESSING" });
  await partialRefund(pi, `re_p2_${sfx}`, 400);
  await release(o.id, "PARTIALLY_REFUNDED");
  await upsertStripeDisputeEvent({ stripeDisputeId: `dp_p2_${sfx}`, stripePaymentIntentId: pi, amountCents: 1100, currency: "eur", status: "needs_response", occurredAt: new Date() });
  let after = await reload(o.id);
  assert.equal(after.paymentStatus, "DISPUTED");
  assert.equal(after.holdReleasedAt, null);
  await rejectsWith(release(o.id, "DISPUTED"), "HOLD_NOT_RELEASABLE");
  pis.set(pi, { ...(pis.get(pi) ?? {}), disputed: true }); // Stripe keeps charge.disputed after the outcome
  await upsertStripeDisputeEvent({ stripeDisputeId: `dp_p2_${sfx}`, stripePaymentIntentId: pi, amountCents: 1100, currency: "eur", status: "won", occurredAt: new Date() });
  after = await reload(o.id);
  assert.equal(after.paymentStatus, "PARTIALLY_REFUNDED");
  assert.equal(physicalQrOrderFulfillmentBlock(after)?.code, "FULFILLMENT_ON_HOLD", "a won dispute is not an automatic release");
  assert.ok(await prisma.paymentDiscrepancy.findFirst({ where: { physicalQrOrderId: o.id, kind: "dispute_won_needs_review", status: "open" } }));
  await release(o.id, "PARTIALLY_REFUNDED", "Dispute won; shipping refund confirmed; prints still owed.");
  after = await reload(o.id);
  assert.equal(physicalQrOrderFulfillmentBlock(after), null, "released after re-verification");
  assert.equal((await prisma.paymentDiscrepancy.findFirst({ where: { physicalQrOrderId: o.id, kind: "dispute_won_needs_review" } }))?.status, "resolved");
  assert.equal(await prisma.physicalQrHoldResolution.count({ where: { orderId: o.id } }), 2);
});

await check("P3 PAID order: dispute won → IN_REVIEW → admin release → PAID; a replayed 'won' does not re-hold", async () => {
  const { o, pi } = await heldOrder("PAID", { fulfillment: "PROCESSING" });
  const won = () => upsertStripeDisputeEvent({ stripeDisputeId: `dp_p3_${sfx}`, stripePaymentIntentId: pi, amountCents: 1500, currency: "eur", status: "won", occurredAt: new Date() });
  await upsertStripeDisputeEvent({ stripeDisputeId: `dp_p3_${sfx}`, stripePaymentIntentId: pi, amountCents: 1500, currency: "eur", status: "needs_response", occurredAt: new Date() });
  await won();
  assert.equal((await reload(o.id)).paymentStatus, "IN_REVIEW");
  pis.set(pi, { disputed: true });
  await release(o.id, "IN_REVIEW", "Dispute won in Stripe; payment confirmed kept.");
  assert.equal((await reload(o.id)).paymentStatus, "PAID");
  await won(); // Stripe redelivery
  const after = await reload(o.id);
  assert.equal(after.paymentStatus, "PAID");
  assert.equal(physicalQrOrderFulfillmentBlock(after), null);
});

await check("P4 Stripe shows a dispute CareTip has not recorded → refused (reconcile first)", async () => {
  const { o, pi } = await heldOrder("IN_REVIEW");
  pis.set(pi, { disputed: true });
  await rejectsWith(release(o.id, "IN_REVIEW"), "PAYMENT_DISPUTED");
});

await check("C1 five concurrent releases → exactly one succeeds, one audit record", async () => {
  const { o } = await heldOrder("IN_REVIEW");
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => release(o.id, "IN_REVIEW")));
  const ok = results.filter((r) => r.status === "fulfilled");
  assert.equal(ok.length, 1, JSON.stringify(results.map((r) => (r.status === "rejected" ? (r.reason as { code?: string }).code : "ok"))));
  for (const r of results) if (r.status === "rejected") assert.ok(["ORDER_STATE_CHANGED", "HOLD_NOT_RELEASABLE"].includes((r.reason as { code: string }).code));
  assert.equal(await prisma.physicalQrHoldResolution.count({ where: { orderId: o.id } }), 1);
});

await check("C2 a refund that lands while Stripe is being checked aborts the release", async () => {
  const { o, pi } = await heldOrder("PAID", { fulfillment: "PROCESSING" });
  await partialRefund(pi, `re_c2a_${sfx}`, 300);
  retrieveHook = async () => {
    retrieveHook = null;
    await upsertStripeRefundEvent({ stripeRefundId: `re_c2b_${sfx}`, stripePaymentIntentId: pi, amountCents: 100, currency: "eur", status: "succeeded", occurredAt: new Date() });
  };
  await assert.rejects(release(o.id, "PARTIALLY_REFUNDED"), (err: { code?: string }) => ["ORDER_STATE_CHANGED", "REFUNDS_NOT_RECONCILED"].includes(err.code ?? ""));
  assert.equal((await reload(o.id)).holdReleasedAt, null);
  assert.equal(await prisma.physicalQrHoldResolution.count({ where: { orderId: o.id } }), 0);
});

server.close();
__setPaymentIntentsRetrieveFnForTests(null);
await prisma.$disconnect();
console.log(`\npayment-qr-hold-resolution: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
