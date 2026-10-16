/**
 * Multi-instance (multi-process) money-path races on disposable PostgreSQL, Stripe mocked:
 *  - same refund delivered to 3 instances → one ledger application, one reversal
 *  - instance crashes after Stripe reversal succeeded, before commit → retry does not reverse twice
 *  - conflicting dispute events (lost / needs_response) → terminal lost, one reversal
 *  - same distribution key on 3 instances → one batch; competing keys → no over-allocation;
 *    opposite employee order → no deadlock
 *  - same Instant Payout key on 3 instances → one Stripe create, row never marked failed
 *  - billing reconciliation started on 3 instances → one run holds the (pooler-safe) lease
 *  - out-of-order payout events racing on a new payout → newest snapshot wins, no unique errors
 *
 *   npm run test:financial-multi-instance-concurrency
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Role,
  StripeConnectInstantPayoutRequestStatus,
  StripeConnectPayoutStatus,
  StripeConnectStatus,
  TipRefundStatus,
  TipStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { createEmployeeTipPayableForSuccessfulTip } from "../src/services/employeeTipPayable.service.js";
import { listTipDistributionEmployeesForBusiness } from "../src/services/tipDistribution.service.js";
import {
  INSTANT_PAYOUT_TERMS_CONTEXT_EMPLOYEE,
  getInstantPayoutTermsRequirement,
} from "../src/lib/instantPayoutTerms.js";
import {
  installMultiInstanceStripeMocks,
  instantCreatesPath,
  mockAmountReversed,
  readJsonl,
  reversalCallsPath,
} from "./lib/multiInstanceStripeMocks.js";
import type { WorkerRound, WorkerRoundResult, WorkerSpec } from "./financial-multi-instance-concurrency-worker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerScript = join(__dirname, "financial-multi-instance-concurrency-worker.ts");
const INSTANCES = 3;
const START_BUFFER_MS = 30_000;
const ROUND_GAP_MS = 2_500;

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

const s = `mi_${Date.now()}`;
const passwordHash = await bcrypt.hash("Testpass1!", 4);

async function createUser(tag: string, role: Role) {
  return prisma.user.create({
    data: { email: `${tag}-${s}@example.com`, passwordHash, role, emailVerified: true, isActive: true },
  });
}

// --- platform_hold business: refund / dispute / instant payout / payout events -------------------
const holdManager = await createUser("mi-mgr", Role.MANAGER);
const empUser = await createUser("mi-emp", Role.EMPLOYEE);
const bizAccount = `acct_mi_biz_${s}`;
const empAccount = `acct_mi_emp_${s}`;
const holdBiz = await prisma.business.create({
  data: {
    name: `MI ${s}`,
    slug: `mi-${s}`,
    userId: holdManager.id,
    stripeAccountId: bizAccount,
    stripeConnectStatus: StripeConnectStatus.ready,
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
  },
});
const holdEmp = await prisma.employee.create({
  data: {
    name: `MI Emp ${s}`,
    jobTitle: "Server",
    businessId: holdBiz.id,
    userId: empUser.id,
    isActive: true,
    activationStatus: "active",
  },
});
await prisma.employeeStripeAccount.create({
  data: {
    employeeId: holdEmp.id,
    stripeAccountId: empAccount,
    stripeConnectStatus: StripeConnectStatus.ready,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
  },
});

async function transferredHoldPayable(tag: string) {
  const pi = `pi_mi_${tag}_${s}`;
  const tip = await prisma.transaction.create({
    data: { amount: 10, status: TipStatus.success, stripePaymentIntentId: pi, employeeId: holdEmp.id, businessId: holdBiz.id },
  });
  const payable = await prisma.employeeTipPayable.create({
    data: {
      transactionId: tip.id,
      employeeId: holdEmp.id,
      businessId: holdBiz.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.transferred,
      grossCents: 1000,
      platformFeeCents: 100,
      payableCents: 900,
      transferredCents: 900,
      stripePaymentIntentId: pi,
      stripeChargeId: `ch_mi_${tag}_${s}`,
      stripeTransferId: `tr_mi_${tag}_${s}`,
      stripeDestinationAccountId: empAccount,
    },
  });
  return { pi, payable, transferId: payable.stripeTransferId! };
}

const race = await transferredHoldPayable("race");
const crash = await transferredHoldPayable("crash");
const disp = await transferredHoldPayable("disp");

// --- business_distribution business -----------------------------------------------------------
const distManager = await createUser("mi-dmgr", Role.MANAGER);
const distBiz = await prisma.business.create({
  data: {
    name: `MI Dist ${s}`,
    slug: `mi-dist-${s}`,
    userId: distManager.id,
    stripeAccountId: `acct_mi_dist_${s}`,
    stripeConnectStatus: StripeConnectStatus.ready,
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution,
  },
});
const distEmps = await Promise.all(
  [1, 2, 3].map((n) =>
    prisma.employee.create({
      data: { name: `MI D${n} ${s}`, jobTitle: "Staff", businessId: distBiz.id, activationStatus: "active" },
    }),
  ),
);
async function heldBusinessPayable(employeeId: string, tag: string, grossCents: number) {
  const pi = `pi_mi_d_${tag}_${s}`;
  const tip = await prisma.transaction.create({
    data: { amount: grossCents / 100, status: TipStatus.success, stripePaymentIntentId: pi, employeeId, businessId: distBiz.id },
  });
  await prisma.$transaction(async (tx) => {
    await createEmployeeTipPayableForSuccessfulTip({
      tx,
      transactionId: tip.id,
      employeeId,
      businessId: distBiz.id,
      paymentIntentId: pi,
      grossCents,
      snapshot: {
        chargeModel: EmployeeTipChargeModel.destination_business,
        routingMode: EmployeeTipPayoutMode.business_distribution,
        destinationAccountId: `acct_mi_dist_${s}`,
      },
      stripeChargeId: `ch_mi_d_${tag}_${s}`,
      destinationTransferId: `tr_mi_d_${tag}_${s}`,
    });
  });
}
await heldBusinessPayable(distEmps[0]!.id, "1a", 1000);
await heldBusinessPayable(distEmps[0]!.id, "1b", 500);
await heldBusinessPayable(distEmps[1]!.id, "2", 1000);
await heldBusinessPayable(distEmps[2]!.id, "3", 1000);
const remainingBefore = new Map(
  (await listTipDistributionEmployeesForBusiness(distBiz.id)).items.map((i) => [i.employeeId, i.remainingCents]),
);
const [e1, e2, e3] = distEmps.map((e) => e.id) as [string, string, string];
const e1Remaining = remainingBefore.get(e1) ?? 0;
assert.ok(e1Remaining > 200, `seeded distributable remaining (${e1Remaining})`);

const termsVersion = (await getInstantPayoutTermsRequirement(INSTANT_PAYOUT_TERMS_CONTEXT_EMPLOYEE, "en")).version;
const payoutBase = Math.floor(Date.now() / 1000);
const PAYOUT_ROUNDS = 4;
const payoutVariants = [
  { eventType: "payout.paid", status: "paid", offset: 200 },
  { eventType: "payout.updated", status: "in_transit", offset: 100 },
  { eventType: "payout.created", status: "pending", offset: 50 },
];
const payoutIds = Array.from({ length: PAYOUT_ROUNDS }, (_, r) => `po_mi_${r}_${s}`);

function roundsFor(i: number): WorkerRound[] {
  return [
    { mode: "refund", paymentIntentId: race.pi, refundId: `re_mi_race_${s}`, amountCents: 1000 },
    {
      mode: "dispute",
      paymentIntentId: disp.pi,
      disputeId: `du_mi_${s}`,
      amountCents: 1000,
      status: ["lost", "needs_response", "lost"][i]!,
    },
    {
      mode: "distribute",
      businessId: distBiz.id,
      actorUserId: distManager.id,
      key: `mi-same-${s}`,
      items: [{ employeeId: e1, amountCents: 100 }],
    },
    {
      mode: "distribute",
      businessId: distBiz.id,
      actorUserId: distManager.id,
      key: `mi-comp-${i}-${s}`,
      items: [{ employeeId: e1, amountCents: e1Remaining - 100 }],
    },
    {
      mode: "distribute",
      businessId: distBiz.id,
      actorUserId: distManager.id,
      key: `mi-cross-${i}-${s}`,
      items:
        i % 2 === 0
          ? [{ employeeId: e2, amountCents: 50 }, { employeeId: e3, amountCents: 50 }]
          : [{ employeeId: e3, amountCents: 50 }, { employeeId: e2, amountCents: 50 }],
    },
    { mode: "instant", userId: empUser.id, key: `mi-instant-key-${s}`, termsVersion },
    { mode: "billing-lease" },
    ...payoutIds.map((payoutId, r): WorkerRound => {
      const v = payoutVariants[i]!;
      return {
        mode: "payout",
        account: r % 2 === 0 ? bizAccount : empAccount,
        payoutId,
        eventType: v.eventType,
        status: v.status,
        created: payoutBase + v.offset,
        amountCents: 2500,
      };
    }),
  ];
}

// Disposable DB: close any run left open by other suites so the lease round starts free.
await prisma.subscriptionBillingReconciliationRun.updateMany({
  where: { finishedAt: null },
  data: { finishedAt: new Date() },
});

const stateDir = join(tmpdir(), `caretip-multi-instance-${Date.now()}`);
mkdirSync(stateDir, { recursive: true });

function runWorker(spec: WorkerSpec, label: string): Promise<{ code: number | null; results: WorkerRoundResult[] }> {
  const specPath = join(stateDir, `${label}.spec.json`);
  writeFileSync(specPath, JSON.stringify(spec));
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", workerScript, specPath], {
      cwd: join(__dirname, ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const line = stdout
        .split("\n")
        .filter((l) => l.startsWith("RESULT "))
        .pop();
      const results = line ? (JSON.parse(line.slice("RESULT ".length)) as { results: WorkerRoundResult[] }).results : [];
      resolve({ code, results });
    });
  });
}

const startAt = Date.now() + START_BUFFER_MS;
console.log(`[multi-instance] ${INSTANCES} instances + 1 crashing instance; rounds start in ${START_BUFFER_MS / 1000}s`);
const [crashRun, ...runs] = await Promise.all([
  runWorker(
    {
      stateDir,
      startAt,
      roundGapMs: ROUND_GAP_MS,
      crashAfterReversal: true,
      rounds: [{ mode: "refund", paymentIntentId: crash.pi, refundId: `re_mi_crash_${s}`, amountCents: 1000 }],
    },
    "crash",
  ),
  ...Array.from({ length: INSTANCES }, (_, i) =>
    runWorker({ stateDir, startAt, roundGapMs: ROUND_GAP_MS, rounds: roundsFor(i) }, `instance-${i}`),
  ),
]);

for (const [i, run] of runs.entries()) {
  assert.equal(run.code, 0, `instance ${i} exited ${run.code}`);
  assert.equal(run.results.length, roundsFor(i).length, `instance ${i} reported every round`);
}
const maxLate = Math.max(...runs.flatMap((r) => r.results.map((x) => x.lateMs)));
console.log(`[multi-instance] max round start lateness ${maxLate}ms`);
assert.ok(maxLate < ROUND_GAP_MS, "instances started rounds together (race actually exercised)");
const roundResults = (index: number) => runs.map((r) => r.results[index]!);
const callsFor = (transferId: string) =>
  readJsonl(reversalCallsPath(stateDir)).filter((c) => c.transferId === transferId).length;

// Round 0: same refund on every instance.
assert.ok(roundResults(0).every((r) => r.ok), `refund race results ${JSON.stringify(roundResults(0))}`);
const raceAfter = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { id: race.payable.id } });
assert.equal(raceAfter.refundedCents, 900);
assert.equal(raceAfter.reversedCents, 900);
assert.equal(raceAfter.status, EmployeeTipPayableStatus.refunded);
assert.equal(callsFor(race.transferId), 1, "exactly one Stripe reversal request");
assert.equal(mockAmountReversed(stateDir, race.transferId), 900);
assert.equal(
  await prisma.tipRefund.count({ where: { stripeRefundId: `re_mi_race_${s}`, status: TipRefundStatus.succeeded } }),
  1,
);
pass("refund-race", "3 instances → refund applied once, 1 reversal of 900");

// Crash after Stripe reversal, before commit.
assert.notEqual(crashRun.code, 0, "crash instance must die mid-transaction");
const crashMid = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { id: crash.payable.id } });
assert.equal(crashMid.reversedCents, 0, "crashed transaction rolled back");
assert.equal(crashMid.refundedCents, 0);
assert.equal(await prisma.tipRefund.count({ where: { stripeRefundId: `re_mi_crash_${s}` } }), 0);
assert.equal(mockAmountReversed(stateDir, crash.transferId), 900, "Stripe kept the reversal");
await installMultiInstanceStripeMocks(stateDir);
const { upsertStripeRefundEvent } = await import("../src/services/finance/tipRefunds.service.js");
await upsertStripeRefundEvent({
  stripeRefundId: `re_mi_crash_${s}`,
  stripePaymentIntentId: crash.pi,
  amountCents: 1000,
  status: "succeeded",
  occurredAt: new Date(),
});
const crashAfter = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { id: crash.payable.id } });
assert.equal(crashAfter.refundedCents, 900);
assert.equal(crashAfter.reversedCents, 900);
assert.equal(callsFor(crash.transferId), 1, "retry must not send a second reversal");
assert.equal(mockAmountReversed(stateDir, crash.transferId), 900);
pass("crash-after-stripe", "instance died after Stripe reversal; retry recorded ledger without reversing again");

// Round 1: conflicting dispute events.
assert.ok(roundResults(1).every((r) => r.ok), `dispute results ${JSON.stringify(roundResults(1))}`);
const dispRow = await prisma.tipRefund.findUniqueOrThrow({ where: { stripeDisputeId: `du_mi_${s}` } });
assert.equal(dispRow.status, TipRefundStatus.lost, "terminal lost never regresses to needs_response");
const dispAfter = await prisma.employeeTipPayable.findUniqueOrThrow({ where: { id: disp.payable.id } });
assert.equal(dispAfter.disputedLostCents, 900);
assert.equal(dispAfter.disputedOpenCents, 0);
assert.equal(dispAfter.reversedCents, 900);
assert.equal(callsFor(disp.transferId), 1);
assert.equal(mockAmountReversed(stateDir, disp.transferId), 900);
pass("dispute-race", "lost/needs_response/lost on 3 instances → lost, 1 reversal of 900");

// Round 2: same distribution key everywhere.
const same = roundResults(2);
assert.ok(same.every((r) => r.ok), `same-key results ${JSON.stringify(same)}`);
assert.equal(new Set(same.map((r) => r.value)).size, 1, "all instances return the same batch");
assert.equal(
  await prisma.employeeTipDistributionBatch.count({ where: { businessId: distBiz.id, idempotencyKey: `mi-same-${s}` } }),
  1,
);
pass("distribution-same-key", "3 instances → 1 batch replayed to all");

// Round 3: competing keys each claiming the whole remainder.
const comp = roundResults(3);
assert.equal(comp.filter((r) => r.ok).length, 1, `competing results ${JSON.stringify(comp)}`);
assert.ok(comp.filter((r) => !r.ok).every((r) => r.errorCode === "DISTRIBUTION_EXCEEDS_REMAINING"));
pass("distribution-no-overallocation", "3 competing full-remainder batches → exactly 1 accepted");

// Round 4: opposite employee order.
const cross = roundResults(4);
assert.ok(cross.every((r) => r.ok), `cross-order results ${JSON.stringify(cross)}`);
const remainingAfter = new Map(
  (await listTipDistributionEmployeesForBusiness(distBiz.id)).items.map((i) => [i.employeeId, i.remainingCents]),
);
assert.equal(remainingAfter.get(e1) ?? 0, 0);
assert.equal(remainingAfter.get(e2), (remainingBefore.get(e2) ?? 0) - 150);
assert.equal(remainingAfter.get(e3), (remainingBefore.get(e3) ?? 0) - 150);
pass("distribution-lock-order", "opposite employee order on 3 instances → all committed, totals exact");

// Round 5: same Instant Payout key.
const inst = roundResults(5);
assert.ok(
  inst.every((r) => (r.ok && r.value === "submitted") || r.errorCode === "INSTANT_PAYOUT_IN_PROGRESS"),
  `instant results ${JSON.stringify(inst)}`,
);
assert.ok(inst.some((r) => r.ok));
const instRows = await prisma.employeeInstantPayoutRequest.findMany({ where: { employeeId: holdEmp.id } });
assert.equal(instRows.length, 1);
assert.equal(instRows[0]!.status, StripeConnectInstantPayoutRequestStatus.submitted);
assert.ok(instRows[0]!.stripePayoutId?.startsWith("po_mock_"));
assert.equal(readJsonl(instantCreatesPath(stateDir)).length, 1, "one Stripe payout create");
const { createEmployeeInstantPayoutForUser } = await import("../src/services/employeeInstantPayout.service.js");
const replay = await createEmployeeInstantPayoutForUser({
  userId: empUser.id,
  idempotencyKey: `mi-instant-key-${s}`,
  termsVersion,
  language: "en",
});
assert.equal(replay.payout.status, "submitted");
assert.equal(readJsonl(instantCreatesPath(stateDir)).length, 1);
pass("instant-payout-same-key", "3 instances → 1 Stripe create, row submitted (never failed), replay idempotent");

// Round 6: billing reconciliation run lease (replaces a session advisory lock).
const lease = roundResults(6);
assert.ok(lease.every((r) => r.ok), `billing lease results ${JSON.stringify(lease)}`);
const winners = lease.filter((r) => r.value).map((r) => r.value!);
assert.equal(winners.length, 1, `exactly one instance starts the run (${JSON.stringify(lease)})`);
const { acquireBillingReconciliationRun, BILLING_RECONCILIATION_RUN_LEASE_MS } = await import(
  "../src/services/subscriptionBillingReconciliation.service.js"
);
assert.equal(await acquireBillingReconciliationRun(new Date()), null, "open run still holds the lease");
await prisma.subscriptionBillingReconciliationRun.update({
  where: { id: winners[0]! },
  data: { startedAt: new Date(Date.now() - BILLING_RECONCILIATION_RUN_LEASE_MS - 60_000) },
});
const afterExpiry = await acquireBillingReconciliationRun(new Date());
assert.ok(afterExpiry, "crashed (expired) run no longer blocks");
await prisma.subscriptionBillingReconciliationRun.updateMany({
  where: { id: { in: [winners[0]!, afterExpiry.id] } },
  data: { finishedAt: new Date() },
});
pass("billing-run-lease", "3 instances → 1 run started; expired unfinished run does not block (pooler-safe lease)");

// Rounds 7..: out-of-order payout events racing on a new payout.
for (const [r, payoutId] of payoutIds.entries()) {
  const results = roundResults(7 + r);
  assert.ok(results.every((x) => x.ok), `payout ${r} results ${JSON.stringify(results)}`);
  const row =
    r % 2 === 0
      ? await prisma.stripeConnectPayout.findUniqueOrThrow({ where: { stripePayoutId: payoutId } })
      : await prisma.employeeStripePayout.findUniqueOrThrow({ where: { stripePayoutId: payoutId } });
  assert.equal(row.status, StripeConnectPayoutStatus.paid, `payout ${r} final status`);
  assert.equal(row.lastStripeEventCreated, payoutBase + 200, `payout ${r} newest event wins`);
}
pass("payout-event-order", `${PAYOUT_ROUNDS} payouts × 3 racing events → newest snapshot, no unique violations`);

rmSync(stateDir, { recursive: true, force: true });
await prisma.$disconnect();
console.log("\nfinancial-multi-instance-concurrency-runtime: OK");
