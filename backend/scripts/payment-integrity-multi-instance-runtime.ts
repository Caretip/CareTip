/**
 * Payment safeguards across separate processes (simulated backend instances sharing one database).
 * No Redis is configured: financial correctness must hold with Redis absent/unavailable.
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:payment-integrity-multi-instance
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/prisma.js";

const here = dirname(fileURLToPath(import.meta.url));
const worker = join(here, "payment-integrity-multi-instance-worker.ts");
const tsxCli = join(here, "..", "node_modules", "tsx", "dist", "cli.mjs");
const specDir = join(tmpdir(), `caretip-pay-mi-${process.pid}`);
mkdirSync(specDir, { recursive: true });

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

type WorkerResult = { pid: number; creates: number; ok: boolean; [k: string]: unknown };
let specSeq = 0;
function runWorker(spec: Record<string, unknown>): Promise<WorkerResult> {
  const path = join(specDir, `spec-${++specSeq}.json`);
  writeFileSync(path, JSON.stringify(spec));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, worker, path], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) => {
      const line = out.split(/\r?\n/).find((l) => l.startsWith("MI_RESULT "));
      if (!line) return reject(new Error(`worker exit ${code}: ${(err || out).slice(-600)}`));
      resolve(JSON.parse(line.slice("MI_RESULT ".length)));
    });
  });
}

const sfx = Date.now().toString(36);
const PRODUCT = "caretip-a5-flyer-no-address";
await prisma.physicalQrProduct.update({ where: { id: PRODUCT }, data: { priceCents: 990, orderable: true } });
async function fixture(tag: string) {
  const user = await prisma.user.create({ data: { email: `mi-${tag}-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true } });
  const business = await prisma.business.create({ data: { name: `MI ${tag}`, slug: `mi-${tag}-${sfx}`, userId: user.id } });
  return { user, business };
}
const INSTANCES = 4;

await check("MI1 QR checkout from 4 instances at once → one Stripe session", async () => {
  const { user, business } = await fixture("qr");
  const order = await prisma.physicalQrOrder.create({
    data: {
      businessId: business.id, userId: user.id, productId: PRODUCT, qrContextType: "storefront",
      qrTargetUrlSnapshot: `https://example.test/mi/${sfx}`, quantity: 10, totalAmount: 0, currency: "EUR", placedAt: new Date(),
      processingClass: "WITHIN_24_HOURS", processingDeadlineAt: new Date(Date.now() + 86_400_000), processingCopySnapshot: {}, businessNameSnapshot: "MI",
    },
  });
  const results = await Promise.all(
    Array.from({ length: INSTANCES }, () => runWorker({ action: "qr_checkout", businessId: business.id, userId: user.id, orderId: order.id })),
  );
  const totalCreates = results.reduce((s, r) => s + r.creates, 0);
  const stored = await prisma.physicalQrOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(totalCreates, 1, `Stripe session creates across instances: ${totalCreates} (${JSON.stringify(results)})`);
  for (const r of results) {
    assert.ok(r.ok || r.code === "CHECKOUT_IN_PROGRESS", JSON.stringify(r));
  }
  assert.ok(stored.stripeCheckoutSessionId?.startsWith("cs_mi_"));
});

await check("MI2 first-time Stripe customer from 4 instances → one customer", async () => {
  const { business } = await fixture("cus");
  const results = await Promise.all(Array.from({ length: INSTANCES }, () => runWorker({ action: "customer", businessId: business.id })));
  const totalCreates = results.reduce((s, r) => s + r.creates, 0);
  const ids = new Set(results.filter((r) => r.ok).map((r) => r.customerId));
  const bound = (await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).stripeCustomerId;
  assert.equal(totalCreates, 1, `customers.create across instances: ${totalCreates}`);
  assert.equal(ids.size, 1);
  assert.equal(bound, [...ids][0]);
});

await check("MI3 subscription sync: a slow stale read on one instance cannot overwrite a newer one", async () => {
  const { business } = await fixture("sub");
  const subId = `sub_mi_${sfx}`;
  await prisma.business.update({ where: { id: business.id }, data: { subscriptionTier: "premium" } });
  await prisma.subscription.create({
    data: { businessId: business.id, planKey: "premium", status: "active", stripeSubscriptionId: subId, stripeCustomerId: `cus_mi_${business.id}` },
  });
  // Instance A reads Stripe first but slowly ("active", now stale); instance B reads later ("canceled").
  const [a, b] = await Promise.all([
    runWorker({ action: "subscription_sync", businessId: business.id, stripeSubscriptionId: subId, stripeStatus: "active", retrieveDelayMs: 1500 }),
    runWorker({ action: "subscription_sync", businessId: business.id, stripeSubscriptionId: subId, stripeStatus: "canceled", retrieveDelayMs: 0, startDelayMs: 2500 }),
  ]);
  const tier = (await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).subscriptionTier;
  assert.ok((b.appliedAt as number) > (a.appliedAt as number), "serialized: the later writer applied last");
  assert.equal(tier, "basic", `final tier ${tier} (a=${JSON.stringify(a)} b=${JSON.stringify(b)})`);
});

await check("MI4 one refund operation executed by 4 instances → one Stripe refund", async () => {
  const op = await prisma.stripeRefundOperation.create({
    data: { operationKey: `mi_refund:pi_mi_${sfx}`, purpose: "qr_duplicate_payment", stripePaymentIntentId: `pi_mi_${sfx}`, nextAttemptAt: new Date() },
  });
  const results = await Promise.all(Array.from({ length: INSTANCES }, () => runWorker({ action: "refund_op", businessId: "-", operationId: op.id })));
  const totalCreates = results.reduce((s, r) => s + r.creates, 0);
  const after = await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: op.id } });
  assert.equal(totalCreates, 1, `refund creates across instances: ${totalCreates}`);
  assert.equal(after.status, "succeeded");
});

rmSync(specDir, { recursive: true, force: true });
await prisma.$disconnect();
console.log(`\npayment-integrity-multi-instance: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
