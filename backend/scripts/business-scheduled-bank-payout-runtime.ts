/**
 * Scheduled bank payout scheduler — idempotency + P2002 race contract.
 * Run: tsx scripts/business-scheduled-bank-payout-runtime.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { BusinessBankPayoutSchedule, StripeConnectScheduledPayoutRequestStatus } from "@prisma/client";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import {
  __createScheduledPayoutLedgerRowOrGetExistingForTests,
  __resetScheduledBankPayoutStripeFnsForTests,
  __setScheduledBankPayoutStripeFnsForTests,
  runScheduledBankPayoutForBusiness,
  scheduledBankPayoutStripeIdempotencyKey,
  tickBusinessScheduledBankPayouts,
} from "../src/services/businessScheduledBankPayout.service.js";
import { scheduleWindowKeyFromDate } from "../src/services/businessBankPayoutSchedule.service.js";
import {
  __resetScheduledBankPayoutDestinationStripeFnsForTests,
  __setScheduledBankPayoutDestinationStripeFnsForTests,
} from "../src/services/scheduledBankPayoutDestination.service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const tickSrc = read("src/services/businessScheduledBankPayout.service.ts");

assert(tickSrc.includes("isPrismaUniqueViolation"), "P2002 helper imported");
assert(tickSrc.includes("createScheduledPayoutLedgerRowOrGetExisting"), "ledger race helper");
assert(tickSrc.includes("businessScheduledBankPayout.tick.business"), "tick batch continues on error");

const dueAt = new Date("2026-01-15T08:00:00.000Z");
const bizId = "biz_test_123";
const key1 = scheduledBankPayoutStripeIdempotencyKey(bizId, dueAt);
const key2 = scheduledBankPayoutStripeIdempotencyKey(bizId, dueAt);
assert(key1 === key2, "idempotency key deterministic");
assert(
  key1 === `caretip_scheduled_payout:${bizId}:${scheduleWindowKeyFromDate(dueAt)}`,
  "idempotency key format",
);

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
  }) => Promise<unknown>;
}): void {
  installCompatibleDestinationMock();
  __setScheduledBankPayoutStripeFnsForTests({
    retrieveBalance: mocks.retrieveBalance as never,
    listPendingPayouts: mocks.listPendingPayouts,
    createStandardPayout: mocks.createStandardPayout as never,
  });
}

async function withFixture(
  fn: (args: { businessId: string; dueAt: Date; stripeAccountId: string }) => Promise<void>,
): Promise<void> {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const due = new Date(Date.now() - 60_000);
  const user = await prisma.user.create({
    data: {
      email: `sched-payout-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `Sched Payout ${tag}`,
          slug: `sched-payout-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
          timezone: "Europe/Berlin",
          bankPayoutSchedule: BusinessBankPayoutSchedule.every_3_days,
          bankPayoutNextScheduledAt: due,
          stripeAccountId: `acct_sched_test_${tag}`,
          stripePayoutsEnabled: true,
        },
      },
    },
    include: { business: true },
  });
  const businessId = user.business!.id;
  const stripeAccountId = user.business!.stripeAccountId!;
  try {
    await fn({ businessId, dueAt: due, stripeAccountId });
  } finally {
    await prisma.stripeConnectScheduledPayoutRequest.deleteMany({ where: { businessId } });
    await prisma.stripeConnectPayout.deleteMany({ where: { businessId } });
    await prisma.business.delete({ where: { id: businessId } });
    await prisma.user.delete({ where: { id: user.id } });
    __resetScheduledBankPayoutStripeFnsForTests();
    __resetScheduledBankPayoutDestinationStripeFnsForTests();
  }
}

async function runDbTests(): Promise<void> {
  let stripeCreateCalls = 0;

  await withFixture(async ({ businessId, dueAt: due }) => {
    const windowKey = scheduleWindowKeyFromDate(due);
    const idempotencyKey = scheduledBankPayoutStripeIdempotencyKey(businessId, due);
    const ledgerData = {
      businessId,
      scheduleWindowKey: windowKey,
      idempotencyKey,
      amountCents: 5000,
      currency: "eur",
      status: StripeConnectScheduledPayoutRequestStatus.pending,
    };
    const [raceA, raceB] = await Promise.all([
      __createScheduledPayoutLedgerRowOrGetExistingForTests(ledgerData),
      __createScheduledPayoutLedgerRowOrGetExistingForTests(ledgerData),
    ]);
    assert(
      (raceA.created && !raceB.created) || (!raceA.created && raceB.created),
      "P2002 race: exactly one ledger creator",
    );
    assert(raceA.row.id === raceB.row.id, "P2002 race: same ledger row");
    const ledgerCount = await prisma.stripeConnectScheduledPayoutRequest.count({
      where: { businessId },
    });
    assert(ledgerCount === 1, "P2002 race: single ledger row");
    await prisma.stripeConnectScheduledPayoutRequest.deleteMany({ where: { businessId } });
  });

  await withFixture(async ({ businessId }) => {
    stripeCreateCalls = 0;
    installStripeMocks({
      retrieveBalance: async () => ({
        object: "balance",
        available: [{ amount: 5000, currency: "eur" }],
        pending: [{ amount: 0, currency: "eur" }],
        livemode: false,
      }),
      listPendingPayouts: async () => false,
      createStandardPayout: async (args) => {
        stripeCreateCalls += 1;
        assert(
          args.idempotencyKey.startsWith("caretip_scheduled_payout:"),
          "stripe idempotency key prefix",
        );
        return {
          id: "po_test_sched",
          object: "payout",
          amount: args.amountCents,
          currency: args.currency,
          status: "pending",
        };
      },
    });
    const before = await prisma.business.findUnique({
      where: { id: businessId },
      select: { bankPayoutNextScheduledAt: true },
    });
    const [a, b] = await Promise.all([
      runScheduledBankPayoutForBusiness(businessId),
      runScheduledBankPayoutForBusiness(businessId),
    ]);
    assert(stripeCreateCalls === 1, `expected one Stripe create, got ${stripeCreateCalls}`);
    const outcomes = [a.outcome, b.outcome];
    assert(
      outcomes.filter((o) => o === "created").length === 1,
      `expected one created outcome, got ${outcomes.join(",")}`,
    );
    assert(
      outcomes.includes("blocked") || outcomes.includes("created"),
      "loser should be blocked or idempotent created",
    );
    const afterSuccess = await prisma.business.findUnique({
      where: { id: businessId },
      select: { bankPayoutNextScheduledAt: true },
    });
    assert(
      afterSuccess!.bankPayoutNextScheduledAt!.getTime() > before!.bankPayoutNextScheduledAt!.getTime(),
      "successful payout advances schedule",
    );
  });

  stripeCreateCalls = 0;

  await withFixture(async ({ businessId }) => {
    installStripeMocks({
      retrieveBalance: async () => ({
        object: "balance",
        available: [{ amount: 50, currency: "eur" }],
        pending: [{ amount: 5000, currency: "eur" }],
        livemode: false,
      }),
      listPendingPayouts: async () => false,
      createStandardPayout: async () => {
        stripeCreateCalls += 1;
        throw new Error("should not create payout on zero balance");
      },
    });
    const result = await runScheduledBankPayoutForBusiness(businessId);
    assert(result.outcome === "zero", "zero balance skip");
    assert(stripeCreateCalls === 0, "no stripe on zero");
    const ledger = await prisma.stripeConnectScheduledPayoutRequest.findFirst({
      where: { businessId },
    });
    assert(
      ledger?.status === StripeConnectScheduledPayoutRequestStatus.skipped_zero_balance,
      "ledger skipped_zero_balance",
    );
  });

  stripeCreateCalls = 0;

  await withFixture(async ({ businessId }) => {
    installStripeMocks({
      retrieveBalance: async () => ({
        object: "balance",
        available: [{ amount: 5000, currency: "eur" }],
        pending: [],
        livemode: false,
      }),
      listPendingPayouts: async () => true,
      createStandardPayout: async () => {
        stripeCreateCalls += 1;
        throw new Error("must not create while stripe payout pending");
      },
    });
    const result = await runScheduledBankPayoutForBusiness(businessId);
    assert(result.outcome === "blocked", "pending stripe blocks run");
    assert(result.blockedReason === "pending_stripe_payout", "pending_stripe_payout reason");
    assert(stripeCreateCalls === 0, "no create when pending stripe payout");
    const ledger = await prisma.stripeConnectScheduledPayoutRequest.findFirst({ where: { businessId } });
    assert(!ledger, "no ledger row before safe create path");
  });

  stripeCreateCalls = 0;

  await withFixture(async ({ businessId, dueAt: due }) => {
    installStripeMocks({
      retrieveBalance: async () => ({
        object: "balance",
        available: [{ amount: 5000, currency: "eur" }],
        pending: [],
        livemode: false,
      }),
      listPendingPayouts: async () => false,
      createStandardPayout: async () => {
        stripeCreateCalls += 1;
        throw new Error("stripe_down");
      },
    });
    const before = await prisma.business.findUnique({
      where: { id: businessId },
      select: { bankPayoutNextScheduledAt: true },
    });
    const result = await runScheduledBankPayoutForBusiness(businessId);
    assert(result.outcome === "blocked", "failed stripe → blocked");
    assert(result.blockedReason !== undefined, "blocked reason surfaced");
    assert(stripeCreateCalls === 1, "attempted stripe once");
    const after = await prisma.business.findUnique({
      where: { id: businessId },
      select: { bankPayoutNextScheduledAt: true },
    });
    assert(
      after!.bankPayoutNextScheduledAt!.getTime() === before!.bankPayoutNextScheduledAt!.getTime(),
      "failed payout does not advance window",
    );
    const ledger = await prisma.stripeConnectScheduledPayoutRequest.findFirst({
      where: { businessId, scheduleWindowKey: scheduleWindowKeyFromDate(due) },
    });
    assert(ledger?.status === StripeConnectScheduledPayoutRequestStatus.failed, "ledger failed");
    assert((ledger?.attemptCount ?? 0) >= 1, "attempt count persisted");
  });

  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const due = new Date(Date.now() - 60_000);
  const user1 = await prisma.user.create({
    data: {
      email: `sched-payout-a-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `Sched A ${tag}`,
          slug: `sched-payout-a-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
          timezone: "Europe/Berlin",
          bankPayoutSchedule: BusinessBankPayoutSchedule.every_3_days,
          bankPayoutNextScheduledAt: due,
          stripeAccountId: `acct_sched_a_${tag}`,
          stripePayoutsEnabled: true,
        },
      },
    },
    include: { business: true },
  });
  const user2 = await prisma.user.create({
    data: {
      email: `sched-payout-b-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `Sched B ${tag}`,
          slug: `sched-payout-b-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
          timezone: "Europe/Berlin",
          bankPayoutSchedule: BusinessBankPayoutSchedule.every_3_days,
          bankPayoutNextScheduledAt: due,
          stripeAccountId: `acct_sched_b_${tag}`,
          stripePayoutsEnabled: true,
        },
      },
    },
    include: { business: true },
  });
  const idA = user1.business!.id;
  const idB = user2.business!.id;
  let callsA = 0;
  let callsB = 0;
  installStripeMocks({
    retrieveBalance: async () => ({
      object: "balance",
      available: [{ amount: 5000, currency: "eur" }],
      pending: [],
      livemode: false,
    }),
    listPendingPayouts: async () => false,
    createStandardPayout: async (args) => {
      if (args.stripeAccountId.includes("acct_sched_a")) callsA += 1;
      if (args.stripeAccountId.includes("acct_sched_b")) callsB += 1;
      return {
        id: `po_${args.stripeAccountId}`,
        object: "payout",
        amount: args.amountCents,
        currency: "eur",
      };
    },
  });
  try {
    const tick = await tickBusinessScheduledBankPayouts();
    assert(tick.scanned >= 2, "tick scans multiple due businesses");
    assert(callsA === 1 && callsB === 1, "tick processes remaining businesses after each run");
  } finally {
    await prisma.stripeConnectScheduledPayoutRequest.deleteMany({
      where: { businessId: { in: [idA, idB] } },
    });
    await prisma.stripeConnectPayout.deleteMany({ where: { businessId: { in: [idA, idB] } } });
    await prisma.business.deleteMany({ where: { id: { in: [idA, idB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2.id] } } });
    __resetScheduledBankPayoutStripeFnsForTests();
    __resetScheduledBankPayoutDestinationStripeFnsForTests();
  }
}

const skipDb = process.env.CARETIP_SCHEDULED_PAYOUT_RUNTIME_SKIP_DB === "1";
if (skipDb) {
  console.log("business-scheduled-bank-payout-runtime: static ok (DB tests skipped)");
} else {
  try {
    await runDbTests();
    console.log("business-scheduled-bank-payout-runtime: ok");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("business-scheduled-bank-payout-runtime: DB tests failed:", message);
    process.exit(1);
  }
}
