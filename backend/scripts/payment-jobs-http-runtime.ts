/**
 * The two payment cron endpoints over HTTP: CRON_SECRET is required, concurrent invocations are safe,
 * and each call reports a monitorable result.
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:payment-jobs-http
 *
 * Loopback HTTP server only; a random test-only secret; Stripe is never contacted.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import type Stripe from "stripe";

const CRON = `cron_test_${randomBytes(12).toString("hex")}`;
process.env.CRON_SECRET = CRON;
process.env.SUBSCRIPTION_BILLING_ENABLED = "true";

const { prisma } = await import("../src/prisma.js");
const { __setRefundsCreateFnForTests } = await import("../src/services/stripe.service.js");
const { __setReconciliationSessionsListFnForTests } = await import("../src/services/payments/paymentReconciliation.service.js");
const router = (await import("../src/routes/internalJobs.routes.js")).default;

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

const app = express();
app.use(express.json());
app.use("/api/internal/jobs", router);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/internal/jobs`;
const call = async (path: string, secret?: string) => {
  const res = await fetch(`${base}/${path}`, { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

let refundCreates = 0;
__setRefundsCreateFnForTests(async () => {
  refundCreates += 1;
  await new Promise((r) => setTimeout(r, 200));
  return { id: `re_job_${refundCreates}`, status: "succeeded" } as Stripe.Refund;
});
let listCalls = 0;
__setReconciliationSessionsListFnForTests(async () => {
  listCalls += 1;
  await new Promise((r) => setTimeout(r, 400));
  return { sessions: [], truncated: false };
});

for (const path of ["payment-refund-operations-tick", "payment-reconciliation"]) {
  await check(`J1 ${path}: no secret → 401`, async () => {
    assert.equal((await call(path)).status, 401);
  });
  await check(`J2 ${path}: wrong secret → 401`, async () => {
    assert.equal((await call(path, `${CRON}x`)).status, 401);
  });
}

await check("J3 refund tick: concurrent runs execute a due refund exactly once and report results", async () => {
  const sfx = Date.now().toString(36);
  const op = await prisma.stripeRefundOperation.create({
    data: { operationKey: `job_refund:pi_job_${sfx}`, purpose: "qr_duplicate_payment", stripePaymentIntentId: `pi_job_${sfx}`, nextAttemptAt: new Date(Date.now() - 1000) },
  });
  const results = await Promise.all([1, 2, 3].map(() => call("payment-refund-operations-tick", CRON)));
  assert.ok(results.every((r) => r.status === 200 && r.body.ok === true), JSON.stringify(results));
  assert.equal(refundCreates, 1);
  assert.equal((await prisma.stripeRefundOperation.findUniqueOrThrow({ where: { id: op.id } })).status, "succeeded");
  assert.ok(results.some((r) => (r.body.refunds as { succeeded?: number })?.succeeded === 1), "result is reported");
  assert.ok("deferredBilling" in results[0]!.body);
});

await check("J4 reconciliation: concurrent invocations → one run, the others report already_running", async () => {
  const results = await Promise.all([1, 2].map(() => call("payment-reconciliation", CRON)));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(listCalls, 1);
  assert.equal(results.filter((r) => r.body.skipped === "already_running").length, 1);
  assert.equal(results.find((r) => !r.body.skipped)?.body.repair, false, "repair is off by default");
});

// ── The Render cron runner (scripts/render-category-retention-http.mjs) against these endpoints ──
const { spawn } = await import("node:child_process");
const { dirname, join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const runner = join(dirname(fileURLToPath(import.meta.url)), "render-category-retention-http.mjs");
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
// Asynchronous: the job server runs in this process, so a blocking spawn could never be answered.
const runCron = (path: string, secret: string | undefined, extra: Record<string, string> = {}) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [runner], {
      env: { ...process.env, CRON_SECRET: secret ?? "", CARE_TIP_API_ORIGIN: origin, CARE_TIP_INTERNAL_JOB_PATH: path, ...extra },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (status) => resolve({ status, stdout, stderr }));
  });

for (const path of ["/api/internal/jobs/payment-refund-operations-tick", "/api/internal/jobs/payment-reconciliation"]) {
  await check(`R1 cron runner → ${path}: prints the JSON result and exits 0`, async () => {
    const r = await runCron(path, CRON, { CARE_TIP_JOB_TIMEOUT_MS: "600000" });
    assert.equal(r.status, 0, r.stderr);
    const body = JSON.parse(r.stdout.trim().split("\n").at(-1)!);
    assert.equal(body.ok, true);
  });
  await check(`R2 cron runner → ${path}: wrong secret exits 1 with HTTP 401`, async () => {
    const r = await runCron(path, `${CRON}-wrong`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /HTTP 401/);
  });
}
await check("R3 cron runner refuses to run without CRON_SECRET (fail-closed)", async () => {
  const r = await runCron("/api/internal/jobs/payment-reconciliation", undefined);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CRON_SECRET is not set/);
});

server.close();
__setRefundsCreateFnForTests(null);
__setReconciliationSessionsListFnForTests(null);
await prisma.$disconnect();
console.log(`\npayment-jobs-http: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
