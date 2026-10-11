/**
 * Employee scheduled bank payout — Charline-shaped fixture + claim concurrency (isolated DB).
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
  releaseEmployeeScheduledPayoutProcessingClaim,
  SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS,
  tryAcquireEmployeeScheduledPayoutProcessingClaim,
} from "../src/services/scheduledBankPayoutProcessingClaim.service.js";
import {
  __resetScheduledBankPayoutDestinationStripeFnsForTests,
  __setScheduledBankPayoutDestinationStripeFnsForTests,
} from "../src/services/scheduledBankPayoutDestination.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const CHARLINE_WINDOW = new Date("2026-10-08T07:00:00.000Z");
const CHARLINE_AMOUNT_CENTS = 9802;

function installCompatibleDestinationMock(): void {
  __setScheduledBankPayoutDestinationStripeFnsForTests({
    listExternalAccounts: async () => ({
      object: "list",
      data: [
        {
          id: "ba_fixture_standard",
          object: "bank_account",
          currency: "eur",
          default_for_currency: true,
          available_payout_methods: ["standard"],
        },
      ],
      has_more: false,
      url: "/v1/external_accounts",
    }),
  });
}

function installStripeMocks(mocks: {
  retrieveBalance: () => Promise<unknown>;
  listPendingPayouts: () => Promise<boolean>;
  createStandardPayout: (args: {
    stripeAccountId: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    correlationId: string;
    scheduleWindowKey: string;
  }) => Promise<{ id: string }>;
}): void {
  installCompatibleDestinationMock();
  __setEmployeeScheduledBankPayoutStripeFnsForTests({
    retrieveBalance: mocks.retrieveBalance as never,
    listPendingPayouts: mocks.listPendingPayouts,
    createStandardPayout: mocks.createStandardPayout as never,
  });
}

async function withEmployeeFixture(
  fn: (args: { employeeId: string; dueAt: Date; stripeAccountId: string }) => Promise<void>,
): Promise<void> {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `emp-sched-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: `mgr-sched-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `Test Hotel Fixture ${tag}`,
          slug: `test-hotel-fixture-${tag}`,
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
      name: "Charline Test Fixture",
      jobTitle: "Staff",
      businessId,
      userId: user.id,
      isActive: true,
      activationStatus: "active",
    },
  });
  const stripeAccountId = `acct_charline_fixture_${tag}`;
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
    await fn({ employeeId: employee.id, dueAt: CHARLINE_WINDOW, stripeAccountId });
  } finally {
    await prisma.employeeStripeScheduledPayoutRequest.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, manager.id] } } });
    __resetEmployeeScheduledBankPayoutStripeFnsForTests();
    __resetScheduledBankPayoutDestinationStripeFnsForTests();
  }
}

await withEmployeeFixture(async ({ employeeId, stripeAccountId }) => {
  let createCalls = 0;
  installStripeMocks({
    retrieveBalance: async () => ({
      object: "balance",
      available: [{ amount: CHARLINE_AMOUNT_CENTS, currency: "eur" }],
      pending: [],
    }),
    listPendingPayouts: async () => false,
    createStandardPayout: async () => {
      createCalls += 1;
      return { id: "po_should_not_run" };
    },
  });

  const windowKey = scheduleWindowKeyFromDate(CHARLINE_WINDOW);
  const idempotencyKey = employeeScheduledBankPayoutStripeIdempotencyKey(employeeId, CHARLINE_WINDOW);
  assert(idempotencyKey.includes("2026-10-08T07:00:00.000Z"), "charline window key");

  await prisma.employeeStripeScheduledPayoutRequest.create({
    data: {
      employeeId,
      scheduleWindowKey: windowKey,
      idempotencyKey,
      amountCents: CHARLINE_AMOUNT_CENTS,
      currency: "eur",
      status: StripeConnectScheduledPayoutRequestStatus.failed,
      failureCode: "stripe_create_failed",
      attemptCount: 1,
      failureClassification: null,
      reconciliationStatus: ScheduledPayoutReconciliationStatus.none,
    },
  });

  const blocked = await runScheduledBankPayoutForEmployee(employeeId);
  assert(blocked.outcome === "blocked", "legacy failed blocked before create");
  assert(createCalls === 0, "legacy failed must not call payouts.create without reconciliation");
  assert(
    blocked.blockedReason === "reconciliation_inconclusive" ||
      blocked.blockedReason === "reconciliation_no_match",
    `expected reconciliation block, got ${blocked.blockedReason}`,
  );
});

await withEmployeeFixture(async ({ employeeId, stripeAccountId }) => {
  let createCalls = 0;
  installStripeMocks({
    retrieveBalance: async () => ({
      object: "balance",
      available: [{ amount: CHARLINE_AMOUNT_CENTS, currency: "eur" }],
      pending: [],
    }),
    listPendingPayouts: async () => false,
    createStandardPayout: async () => {
      createCalls += 1;
      return { id: "po_concurrent" };
    },
  });

  const [a, b] = await Promise.all([
    runScheduledBankPayoutForEmployee(employeeId),
    runScheduledBankPayoutForEmployee(employeeId),
  ]);
  assert(createCalls === 1, `concurrent workers: one stripe create, got ${createCalls}`);
  const outcomes = [a.outcome, b.outcome];
  assert(
    outcomes.filter((o) => o === "created").length === 1,
    `one created outcome, got ${outcomes.join(",")}`,
  );
});

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
  const corr = "crash_recovery_corr";
  const first = await tryAcquireEmployeeScheduledPayoutProcessingClaim(row.id, corr);
  assert(first.acquired && first.claimToken, "first claim acquired");
  await releaseEmployeeScheduledPayoutProcessingClaim(row.id, "wrong_token");
  const stillHeld = await prisma.employeeStripeScheduledPayoutRequest.findUnique({ where: { id: row.id } });
  assert(stillHeld?.processingClaimToken === first.claimToken, "wrong token cannot release claim");
  const second = await tryAcquireEmployeeScheduledPayoutProcessingClaim(row.id, "other");
  assert(!second.acquired, "active claim blocks peer");
  const stale = new Date(Date.now() - SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS - 1_000);
  await prisma.employeeStripeScheduledPayoutRequest.update({
    where: { id: row.id },
    data: { processingClaimedAt: stale },
  });
  const third = await tryAcquireEmployeeScheduledPayoutProcessingClaim(row.id, "after_crash");
  assert(third.acquired, "stale claim can be reclaimed after worker crash");
  await releaseEmployeeScheduledPayoutProcessingClaim(row.id, third.claimToken!);
});

console.log("employee-scheduled-bank-payout-runtime: ok");
