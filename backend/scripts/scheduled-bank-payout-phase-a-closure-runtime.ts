/**
 * Phase A closure — heartbeat, long-running Stripe mock, stale-worker fencing (deterministic).
 * Requires migrated dev/test DB (processing_claim_token). No live Stripe payouts.
 */
import bcrypt from "bcrypt";
import {
  BusinessBankPayoutSchedule,
  ScheduledPayoutReconciliationStatus,
  StripeConnectScheduledPayoutRequestStatus,
} from "@prisma/client";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { scheduleWindowKeyFromDate } from "../src/services/businessBankPayoutSchedule.service.js";
import {
  __resetEmployeeScheduledBankPayoutStripeFnsForTests,
  __setEmployeeScheduledBankPayoutStripeFnsForTests,
  employeeScheduledBankPayoutStripeIdempotencyKey,
  runScheduledBankPayoutForEmployee,
} from "../src/services/employeeScheduledBankPayout.service.js";
import {
  __setScheduledPayoutClaimHeartbeatIntervalMsForTests,
  executeScheduledPayoutClaimHeartbeatWork,
  releaseEmployeeScheduledPayoutProcessingClaim,
  renewEmployeeScheduledPayoutProcessingClaim,
  tryAcquireEmployeeScheduledPayoutProcessingClaim,
} from "../src/services/scheduledBankPayoutProcessingClaim.service.js";
import {
  resolveScheduledPayoutCreateAmount,
} from "../src/services/scheduledBankPayoutRecovery.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Unit: heartbeat helper (mocked renew/release, short interval) ---
__setScheduledPayoutClaimHeartbeatIntervalMsForTests(15);

{
  let renewCalls = 0;
  const heart = await executeScheduledPayoutClaimHeartbeatWork(
    "led_unit",
    "tok_unit",
    async () => {
      renewCalls += 1;
      return true;
    },
    async () => {},
    async () => {
      await sleep(45);
      return "done";
    },
  );
  assert(heart.kind === "ok" && heart.value === "done", "long op with renew ok");
  assert(renewCalls >= 2, `heartbeat renew during long op, calls=${renewCalls}`);
}

{
  const heart = await executeScheduledPayoutClaimHeartbeatWork(
    "led_unit2",
    "tok_lost",
    async () => false,
    async () => {},
    async () => "x",
  );
  assert(heart.kind === "heartbeat_lost", "renew false → heartbeat_lost");
}

{
  let released = false;
  let releaseToken: string | null = null;
  await executeScheduledPayoutClaimHeartbeatWork(
    "led_unit3",
    "owner_tok",
    async () => true,
    async (_id, tok) => {
      released = true;
      releaseToken = tok;
    },
    async () => "v",
  );
  assert(released && releaseToken === "owner_tok", "release only owner token");
}

{
  let innerRenewFalse = false;
  const heart = await executeScheduledPayoutClaimHeartbeatWork(
    "led_unit4",
    "tok_mid",
    async () => {
      if (innerRenewFalse) return false;
      return true;
    },
    async () => {},
    async (handle) => {
      innerRenewFalse = true;
      const ok = await handle.renew();
      assert(!ok, "handle.renew reflects lost ownership");
      return "partial";
    },
  );
  assert(heart.kind === "heartbeat_lost", "lost ownership inside fn → heartbeat_lost");
}

__setScheduledPayoutClaimHeartbeatIntervalMsForTests(null);

// --- Unit: ledger-authoritative amount (no drift on retry) ---
{
  const resolved = resolveScheduledPayoutCreateAmount({
    ledgerAmountCents: 9802,
    ledgerCurrency: "eur",
    ledgerCreated: false,
    availableCents: 50,
    balanceCurrency: "eur",
  });
  assert(!resolved.ok && resolved.blockedReason === "insufficient_balance_for_ledger_amount", "amount drift blocked");
}

{
  const resolved = resolveScheduledPayoutCreateAmount({
    ledgerAmountCents: 100,
    ledgerCurrency: "eur",
    ledgerCreated: false,
    availableCents: 200,
    balanceCurrency: "usd",
  });
  assert(!resolved.ok && resolved.blockedReason === "ledger_currency_mismatch", "currency mismatch blocked");
}

const CHARLINE_WINDOW = new Date("2026-10-08T07:00:00.000Z");
const CHARLINE_AMOUNT_CENTS = 9802;

function installEmployeeStripeMocks(mocks: {
  retrieveBalance: () => Promise<unknown>;
  listPendingPayouts: () => Promise<boolean>;
  createStandardPayout: () => Promise<{ id: string }>;
}): void {
  __setEmployeeScheduledBankPayoutStripeFnsForTests({
    retrieveBalance: mocks.retrieveBalance as never,
    listPendingPayouts: mocks.listPendingPayouts,
    createStandardPayout: mocks.createStandardPayout as never,
  });
}

async function withEmployeeFixture(
  fn: (args: { employeeId: string; stripeAccountId: string }) => Promise<void>,
): Promise<void> {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `phase-a-closure-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: `phase-a-mgr-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `Phase A Fixture ${tag}`,
          slug: `phase-a-fixture-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
          timezone: "Europe/Berlin",
        },
      },
    },
    include: { business: true },
  });
  const businessId = manager.business!.id;
  const employee = await prisma.employee.create({
    data: {
      name: "Phase A Closure Fixture",
      jobTitle: "Staff",
      businessId,
      userId: user.id,
      isActive: true,
      activationStatus: "active",
    },
  });
  const stripeAccountId = `acct_phase_a_${tag}`;
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: employee.id,
      stripeAccountId,
      stripePayoutsEnabled: true,
      bankPayoutSchedule: BusinessBankPayoutSchedule.every_3_days,
      bankPayoutNextScheduledAt: CHARLINE_WINDOW,
    },
  });

  try {
    await fn({ employeeId: employee.id, stripeAccountId });
  } finally {
    await prisma.employeeStripeScheduledPayoutRequest.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, manager.id] } } });
    __resetEmployeeScheduledBankPayoutStripeFnsForTests();
    __setScheduledPayoutClaimHeartbeatIntervalMsForTests(null);
  }
}

// DB: long-running work keeps claim; heartbeat uses real renew; peer blocked (no pool-heavy full payout run)
await withEmployeeFixture(async ({ employeeId }) => {
  __setScheduledPayoutClaimHeartbeatIntervalMsForTests(20);
  const windowKey = scheduleWindowKeyFromDate(CHARLINE_WINDOW);
  const idempotencyKey = employeeScheduledBankPayoutStripeIdempotencyKey(employeeId, CHARLINE_WINDOW);
  const row = await prisma.employeeStripeScheduledPayoutRequest.create({
    data: {
      employeeId,
      scheduleWindowKey: windowKey,
      idempotencyKey,
      amountCents: CHARLINE_AMOUNT_CENTS,
      currency: "eur",
      status: StripeConnectScheduledPayoutRequestStatus.pending,
    },
  });
  const acquired = await tryAcquireEmployeeScheduledPayoutProcessingClaim(row.id, "long_op_owner");
  assert(acquired.acquired && acquired.claimToken, "owner claim");

  const workPromise = executeScheduledPayoutClaimHeartbeatWork(
    row.id,
    acquired.claimToken!,
    renewEmployeeScheduledPayoutProcessingClaim,
    releaseEmployeeScheduledPayoutProcessingClaim,
    async () => {
      await sleep(90);
      return "slow_stripe_done";
    },
  );

  await sleep(35);
  const held = await prisma.employeeStripeScheduledPayoutRequest.findUnique({ where: { id: row.id } });
  assert(held?.processingClaimToken === acquired.claimToken, "claim held during long op");

  const peer = await tryAcquireEmployeeScheduledPayoutProcessingClaim(row.id, "peer_worker");
  assert(!peer.acquired, "peer cannot acquire active claim during slow create");

  const heart = await workPromise;
  assert(heart.kind === "ok" && heart.value === "slow_stripe_done", "owner completes long op");
});

// DB: stale worker cannot release new owner's claim
await withEmployeeFixture(async ({ employeeId }) => {
  const windowKey = scheduleWindowKeyFromDate(CHARLINE_WINDOW);
  const idempotencyKey = employeeScheduledBankPayoutStripeIdempotencyKey(employeeId, CHARLINE_WINDOW);
  const row = await prisma.employeeStripeScheduledPayoutRequest.create({
    data: {
      employeeId,
      scheduleWindowKey: windowKey,
      idempotencyKey,
      amountCents: CHARLINE_AMOUNT_CENTS,
      currency: "eur",
      status: StripeConnectScheduledPayoutRequestStatus.pending,
    },
  });
  const first = await tryAcquireEmployeeScheduledPayoutProcessingClaim(row.id, "stale_owner");
  assert(first.acquired && first.claimToken, "first claim");
  await releaseEmployeeScheduledPayoutProcessingClaim(row.id, "wrong_stale_token");
  const afterWrong = await prisma.employeeStripeScheduledPayoutRequest.findUnique({ where: { id: row.id } });
  assert(afterWrong?.processingClaimToken === first.claimToken, "stale token cannot clear claim");

  const newOwner = await tryAcquireEmployeeScheduledPayoutProcessingClaim(row.id, "new_owner");
  assert(!newOwner.acquired, "cannot steal while first still valid");

  await releaseEmployeeScheduledPayoutProcessingClaim(row.id, first.claimToken!);
  const reclaimed = await tryAcquireEmployeeScheduledPayoutProcessingClaim(row.id, "reclaimed");
  assert(reclaimed.acquired, "reclaim after proper release");
  await releaseEmployeeScheduledPayoutProcessingClaim(row.id, reclaimed.claimToken!);
});

// DB: claim lost after stripe — reconciliation_required, no duplicate create on retry path
await withEmployeeFixture(async ({ employeeId }) => {
  const windowKey = scheduleWindowKeyFromDate(CHARLINE_WINDOW);
  const idempotencyKey = employeeScheduledBankPayoutStripeIdempotencyKey(employeeId, CHARLINE_WINDOW);
  await prisma.employeeStripeScheduledPayoutRequest.create({
    data: {
      employeeId,
      scheduleWindowKey: windowKey,
      idempotencyKey,
      amountCents: CHARLINE_AMOUNT_CENTS,
      currency: "eur",
      status: StripeConnectScheduledPayoutRequestStatus.failed,
      failureClassification: "retryable",
      attemptCount: 1,
      reconciliationStatus: ScheduledPayoutReconciliationStatus.resolved,
      correlationId: "corr_retry_ok",
    },
  });

  let createCalls = 0;
  installEmployeeStripeMocks({
    retrieveBalance: async () => ({
      object: "balance",
      available: [{ amount: CHARLINE_AMOUNT_CENTS, currency: "eur" }],
      pending: [],
    }),
    listPendingPayouts: async () => false,
    createStandardPayout: async () => {
      createCalls += 1;
      return { id: "po_after_loss" };
    },
  });

  const row = await prisma.employeeStripeScheduledPayoutRequest.findFirst({ where: { employeeId } });
  assert(row, "ledger row");
  const hijack = await tryAcquireEmployeeScheduledPayoutProcessingClaim(row!.id, "hijacker");
  assert(hijack.acquired, "pre-hijack claim for simulate loss");

  const blocked = await runScheduledBankPayoutForEmployee(employeeId);
  assert(blocked.outcome === "blocked", `expected blocked, got ${blocked.outcome}`);
  assert(createCalls === 0, "contended worker must not call payouts.create");
  await releaseEmployeeScheduledPayoutProcessingClaim(row!.id, hijack.claimToken!);
});

console.log("scheduled-bank-payout-phase-a-closure-runtime: ok");
