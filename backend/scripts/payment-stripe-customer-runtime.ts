/**
 * Stripe customer creation is exactly-once per business across concurrency, lost responses, lost
 * database writes, process restarts and the end of Stripe's 24h idempotency window (audit M5).
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:payment-stripe-customer
 *
 * Disposable loopback Postgres only. Stripe is a local fake; nothing is contacted.
 */
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { prisma } from "../src/prisma.js";
import { getStripeClient } from "../src/services/stripe.service.js";
import { ensureStripeCustomerCreated, stripeCustomerIdempotencyKey } from "../src/services/payments/stripeCustomerCreation.service.js";

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

// ── Fake Stripe customers (idempotency keys, search, list, lost responses) ──
type FakeCustomer = { id: string; object: "customer"; email: string; name: string; created: number; metadata: Record<string, string>; deleted?: boolean };
const customers = new Map<string, FakeCustomer>();
const byKey = new Map<string, string>();
let creates = 0;
let createDelayMs = 0;
let loseNextResponse = false;
let searchUnavailable = false;
let clock = Math.floor(Date.now() / 1000);
const stripe = getStripeClient() as unknown as { customers: Record<string, unknown> };
stripe.customers.create = async (params: { email: string; name: string; metadata: Record<string, string> }, options?: { idempotencyKey?: string }) => {
  if (createDelayMs) await new Promise((r) => setTimeout(r, createDelayMs));
  const key = options?.idempotencyKey ?? "";
  let id = byKey.get(key);
  if (!id) {
    creates += 1;
    id = `cus_fake_${customers.size + 1}`;
    customers.set(id, { id, object: "customer", email: params.email, name: params.name, created: clock++, metadata: { ...params.metadata } });
    byKey.set(key, id);
  }
  if (loseNextResponse) {
    loseNextResponse = false;
    throw Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
  }
  return customers.get(id);
};
stripe.customers.retrieve = async (id: string) => {
  const c = customers.get(id);
  if (!c) throw Object.assign(new Error("No such customer"), { code: "resource_missing", statusCode: 404 });
  return c.deleted ? { id, object: "customer", deleted: true } : c;
};
stripe.customers.search = async ({ query }: { query: string }) => {
  if (searchUnavailable) throw Object.assign(new Error("Search is not available"), { type: "StripeInvalidRequestError", statusCode: 400 });
  const m = /metadata\['caretipBusinessId'\]:'([^']+)'/.exec(query);
  return { data: [...customers.values()].filter((c) => !c.deleted && c.metadata.caretipBusinessId === m?.[1]) };
};
stripe.customers.list = async ({ email }: { email: string }) => ({ data: [...customers.values()].filter((c) => !c.deleted && c.email === email) });
/** A customer that exists at Stripe but that CareTip never recorded (e.g. a lost write before this change). */
function stripeSideCustomer(businessId: string, email = "owner@example.com") {
  const id = `cus_fake_${customers.size + 1}`;
  customers.set(id, { id, object: "customer", email, name: "Biz", created: clock++, metadata: { caretipBusinessId: businessId } });
  return id;
}

const sfx = Date.now().toString(36);
let n = 0;
async function business() {
  n += 1;
  const u = await prisma.user.create({ data: { email: `scu-${sfx}-${n}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true } });
  return prisma.business.create({ data: { name: `SCU ${n}`, slug: `scu-${sfx}-${n}`, userId: u.id } });
}
const ensure = (businessId: string, email = "owner@example.com") => ensureStripeCustomerCreated({ businessId, email, businessName: "Biz" });
const bound = async (id: string) => (await prisma.business.findUniqueOrThrow({ where: { id } })).stripeCustomerId;
const op = (id: string) => prisma.stripeCustomerCreation.findUnique({ where: { businessId: id } });

await check("C1 ten concurrent first-time requests → one Stripe customer, bound once", async () => {
  const b = await business();
  creates = 0;
  createDelayMs = 200;
  const ids = await Promise.allSettled(Array.from({ length: 10 }, () => ensure(b.id)));
  createDelayMs = 0;
  const ok = ids.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<string>).value);
  assert.equal(creates, 1);
  assert.equal(new Set(ok).size, 1);
  assert.equal(await bound(b.id), ok[0]);
  assert.equal((await op(b.id))?.status, "bound");
});

await check("C2 an existing Stripe customer for this business (earlier lost write) is adopted, not duplicated", async () => {
  const b = await business();
  const orphan = stripeSideCustomer(b.id);
  creates = 0;
  assert.equal(await ensure(b.id), orphan);
  assert.equal(creates, 0);
});

await check("C3 another business's customer (same email) is never attached", async () => {
  const other = await business();
  const b = await business();
  stripeSideCustomer(other.id, "shared@example.com");
  searchUnavailable = true; // force the email-list fallback, which returns the other business's customer
  creates = 0;
  const id = await ensure(b.id, "shared@example.com");
  searchUnavailable = false;
  assert.equal(creates, 1);
  assert.equal(customers.get(id)?.metadata.caretipBusinessId, b.id);
});

await check("C4 Stripe answered but the database bind was lost → bound on retry, no second create", async () => {
  const b = await business();
  const first = await ensure(b.id);
  await prisma.business.update({ where: { id: b.id }, data: { stripeCustomerId: null } });
  await prisma.stripeCustomerCreation.update({ where: { businessId: b.id }, data: { status: "created" } });
  creates = 0;
  assert.equal(await ensure(b.id), first);
  assert.equal(creates, 0);
});

await check("C5 lost response (timeout after Stripe created it) → retry with the same key returns the same customer", async () => {
  const b = await business();
  creates = 0;
  loseNextResponse = true;
  await assert.rejects(ensure(b.id));
  assert.equal((await op(b.id))?.status, "creating", "interruption is recorded durably");
  assert.equal(await bound(b.id), null);
  const id = await ensure(b.id);
  assert.equal(creates, 1, "Stripe created exactly one customer");
  assert.equal(await bound(b.id), id);
});

await check("C6 restart after the 24h key window: the interrupted customer is found by metadata and adopted", async () => {
  const b = await business();
  creates = 0;
  loseNextResponse = true;
  await assert.rejects(ensure(b.id));
  await prisma.stripeCustomerCreation.update({ where: { businessId: b.id }, data: { startedAt: new Date(Date.now() - 25 * 3600_000) } });
  byKey.clear(); // Stripe has forgotten the idempotency key
  const id = await ensure(b.id);
  assert.equal(creates, 1, "no second customer after the key expired");
  assert.equal(customers.get(id)?.metadata.caretipBusinessId, b.id);
});

await check("C7 after the window with nothing at Stripe: a new key generation is used once", async () => {
  const b = await business();
  await prisma.stripeCustomerCreation.create({
    data: { businessId: b.id, status: "creating", idempotencyKey: stripeCustomerIdempotencyKey(b.id, "owner@example.com", "Biz"), email: "owner@example.com", name: "Biz", startedAt: new Date(Date.now() - 25 * 3600_000) },
  });
  creates = 0;
  const id = await ensure(b.id);
  const row = await op(b.id);
  assert.equal(creates, 1);
  assert.equal(row?.keyGeneration, 1);
  assert.equal(await bound(b.id), id);
});

await check("C8 several Stripe customers for one business → oldest bound, others recorded (never deleted)", async () => {
  const b = await business();
  const oldest = stripeSideCustomer(b.id);
  const newer = stripeSideCustomer(b.id);
  assert.equal(await ensure(b.id), oldest);
  assert.ok(await prisma.paymentDiscrepancy.findFirst({ where: { kind: "orphan_stripe_customer", subjectKey: `stripe_customer:${newer}` } }));
  assert.ok(customers.has(newer));
});

await check("C9 a recorded customer that was deleted at Stripe is not re-bound", async () => {
  const b = await business();
  const first = await ensure(b.id);
  customers.get(first)!.deleted = true;
  await prisma.business.update({ where: { id: b.id }, data: { stripeCustomerId: null } });
  await prisma.stripeCustomerCreation.update({ where: { businessId: b.id }, data: { status: "created", startedAt: new Date(Date.now() - 25 * 3600_000) } });
  const id = await ensure(b.id);
  assert.notEqual(id, first);
});

await check("C10 a retry after the email changed reuses the original request parameters (no idempotency conflict)", async () => {
  const b = await business();
  loseNextResponse = true;
  await assert.rejects(ensure(b.id, "old@example.com"));
  const id = await ensure(b.id, "new@example.com");
  assert.equal(customers.get(id)?.email, "old@example.com");
});

await prisma.$disconnect();
console.log(`\npayment-stripe-customer: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
