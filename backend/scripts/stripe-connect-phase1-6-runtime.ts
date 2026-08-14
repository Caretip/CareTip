/**
 * Stripe Connect Phase 1.6 — concurrency, CAS, stale webhook, isolation tests.
 * Run: npm run test:stripe-connect-phase1-6
 *
 * Uses mocked Stripe accounts.create (no live Stripe account creation).
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Role, StripeConnectStatus } from "@prisma/client";
import type Stripe from "stripe";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  connectExpressIdempotencyKey,
  ensureExpressConnectedAccountForBusiness,
  handleConnectAccountUpdated,
  shouldAcceptConnectAccountEvent,
  StripeConnectError,
  __setCreateAccountFnForTests,
  __setSerializeConnectEnsureForTests,
} from "../src/services/stripeConnect.service.js";
import { transferBusinessOwnership } from "../src/services/businessOwnership.service.js";
import {
  isStripeWebhookEventProcessed,
  markStripeWebhookEventProcessed,
} from "../src/services/stripeWebhookIdempotency.service.js";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();

function pass(id: string, detail: string) {
  results.push({ id, pass: true, detail });
}
function fail(id: string, detail: string) {
  results.push({ id, pass: false, detail });
}
function read(rel: string): string {
  return readFileSync(join(backendRoot, rel), "utf8");
}

function fakeAccount(id: string, overrides: Partial<Stripe.Account> = {}): Stripe.Account {
  return {
    id,
    object: "account",
    created: Math.floor(Date.now() / 1000),
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    requirements: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      disabled_reason: null,
    },
    ...overrides,
  } as Stripe.Account;
}

function runStaticBoundary() {
  const connectSvc = read("src/services/stripeConnect.service.ts");
  const webhook = read("src/webhooks/stripe.webhook.ts");

  if (
    connectSvc.includes("idempotencyKey") &&
    connectSvc.includes("connect_express:") &&
    connectSvc.includes("stripeAccountId: null")
  ) {
    pass("static-cas-and-idempotency", "CAS bind + deterministic idempotency key present");
  } else {
    fail("static-cas-and-idempotency", "Missing CAS / idempotency hardening");
  }

  if (
    connectSvc.includes("shouldAcceptConnectAccountEvent") &&
    webhook.includes("eventCreatedUnix: event.created")
  ) {
    pass("static-stale-webhook", "Stale account.updated guard wired with event.created");
  } else {
    fail("static-stale-webhook", "Stale webhook protection missing");
  }

  if (
    !/application_fee_amount\s*:/.test(connectSvc) &&
    !/transfer_data\s*:/.test(connectSvc) &&
    !connectSvc.includes("checkout.sessions.create")
  ) {
    pass("connect-service-no-destination-routing", "Phase 1.6 Connect service still does not set Checkout destination/fee");
  } else {
    fail("connect-service-no-destination-routing", "Connect account service must not create destination charges");
  }

  if (webhook.includes("verifyWebhookSignature")) {
    pass("webhook-signature-preserved", "Webhook signature verification preserved");
  } else {
    fail("webhook-signature-preserved", "Webhook signature verification missing");
  }

  if (connectSvc.includes("BUSINESS_LEGAL_HOLD") && connectSvc.includes("legalHold")) {
    pass("legal-hold-gate", "Connect mutations blocked under legal hold");
  } else {
    fail("legal-hold-gate", "Legal hold Connect gate missing");
  }
}

function runStaleUnit() {
  const base = new Date("2026-08-13T12:00:00.000Z");
  if (
    shouldAcceptConnectAccountEvent({
      eventCreatedUnix: Math.floor(base.getTime() / 1000) + 10,
      lastAcceptedAt: base,
    })
  ) {
    pass("stale-unit-newer", "Newer event accepted");
  } else fail("stale-unit-newer", "Newer event rejected incorrectly");

  if (
    !shouldAcceptConnectAccountEvent({
      eventCreatedUnix: Math.floor(base.getTime() / 1000) - 10,
      lastAcceptedAt: base,
    })
  ) {
    pass("stale-unit-older", "Older event rejected");
  } else fail("stale-unit-older", "Older event accepted incorrectly");

  if (
    shouldAcceptConnectAccountEvent({
      eventCreatedUnix: Math.floor(base.getTime() / 1000),
      lastAcceptedAt: base,
    })
  ) {
    pass("stale-unit-equal", "Equal timestamp accepted (idempotent)");
  } else fail("stale-unit-equal", "Equal timestamp rejected");
}

async function withTestBusiness(
  tag: string,
  fn: (ctx: { businessId: string; ownerId: string; email: string }) => Promise<void>,
): Promise<void> {
  const suffix = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("ConnectPhase16!23", 4);
  const user = await prisma.user.create({
    data: {
      email: `mgr_${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });
  const biz = await prisma.business.create({
    data: {
      name: `Connect16 ${suffix}`,
      slug: `connect16-${suffix}`,
      userId: user.id,
    },
  });
  try {
    await fn({ businessId: biz.id, ownerId: user.id, email: user.email });
  } finally {
    await prisma.business.deleteMany({ where: { id: biz.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: user.id } }).catch(() => undefined);
  }
}

async function runDbSuite(): Promise<void> {
  const idempotencyCache = new Map<string, Stripe.Account>();
  let createCalls = 0;

  __setCreateAccountFnForTests(async (_params, options) => {
    createCalls += 1;
    const key = options?.idempotencyKey ?? "";
    if (key && idempotencyCache.has(key)) {
      return idempotencyCache.get(key)!;
    }
    const acct = fakeAccount(`acct_p16_${createCalls}_${Date.now()}`);
    if (key) idempotencyCache.set(key, acct);
    return acct;
  });

  try {
    // A. Sequential reuse
    await withTestBusiness("seq", async ({ businessId, email }) => {
      createCalls = 0;
      idempotencyCache.clear();
      const a = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      const b = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      if (a.accountId === b.accountId && a.created && !b.created && createCalls === 1) {
        pass("sequential-reuse", `Reused ${a.accountId.slice(-8)} createCalls=1`);
      } else {
        fail(
          "sequential-reuse",
          `a=${a.accountId} b=${b.accountId} created=${a.created}/${b.created} calls=${createCalls}`,
        );
      }
      if (connectExpressIdempotencyKey(businessId) === `connect_express:${businessId}`) {
        pass("idempotency-key-shape", "Deterministic connect_express:businessId key");
      } else {
        fail("idempotency-key-shape", "Unexpected idempotency key");
      }
    });

    // B. Concurrent ensure without in-process serialize — CAS + idempotency
    await withTestBusiness("conc", async ({ businessId, email }) => {
      createCalls = 0;
      idempotencyCache.clear();
      __setSerializeConnectEnsureForTests(false);
      try {
        const [r1, r2] = await Promise.all([
          ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email }),
          ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email }),
        ]);
        const row = await prisma.business.findUnique({
          where: { id: businessId },
          select: { stripeAccountId: true },
        });
        if (r1.accountId === r2.accountId && row?.stripeAccountId === r1.accountId) {
          pass("concurrent-cas", `Single authoritative acct suffix=${r1.accountId.slice(-8)}`);
        } else {
          fail(
            "concurrent-cas",
            `r1=${r1.accountId} r2=${r2.accountId} stored=${row?.stripeAccountId}`,
          );
        }
      } finally {
        __setSerializeConnectEnsureForTests(true);
      }
    });

    // B2. Concurrent with distinct mock accounts (no idempotency cache) — still one winner
    await withTestBusiness("conc2", async ({ businessId, email }) => {
      let n = 0;
      __setCreateAccountFnForTests(async () => {
        n += 1;
        // Delay so both pass the null check before either binds
        await new Promise((r) => setTimeout(r, 30));
        return fakeAccount(`acct_distinct_${n}_${businessId.slice(-6)}`);
      });
      __setSerializeConnectEnsureForTests(false);
      try {
        const [r1, r2] = await Promise.all([
          ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email }),
          ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email }),
        ]);
        const row = await prisma.business.findUnique({
          where: { id: businessId },
          select: { stripeAccountId: true },
        });
        if (r1.accountId === r2.accountId && row?.stripeAccountId === r1.accountId && n >= 1) {
          pass("concurrent-no-overwrite", `Winner ${r1.accountId.slice(-8)} mockCreates=${n}`);
        } else {
          fail(
            "concurrent-no-overwrite",
            `r1=${r1.accountId} r2=${r2.accountId} stored=${row?.stripeAccountId} n=${n}`,
          );
        }
      } finally {
        __setSerializeConnectEnsureForTests(true);
        // restore idempotent mock
        __setCreateAccountFnForTests(async (_params, options) => {
          createCalls += 1;
          const key = options?.idempotencyKey ?? "";
          if (key && idempotencyCache.has(key)) return idempotencyCache.get(key)!;
          const acct = fakeAccount(`acct_p16_${createCalls}_${Date.now()}`);
          if (key) idempotencyCache.set(key, acct);
          return acct;
        });
      }
    });

    // C. Existing account protection
    await withTestBusiness("exist", async ({ businessId, email }) => {
      createCalls = 0;
      idempotencyCache.clear();
      const first = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      // Force a different create if called again by clearing cache and swapping mock once
      __setCreateAccountFnForTests(async () => fakeAccount(`acct_SHOULD_NOT_BIND_${Date.now()}`));
      const second = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      const row = await prisma.business.findUnique({
        where: { id: businessId },
        select: { stripeAccountId: true },
      });
      if (second.accountId === first.accountId && row?.stripeAccountId === first.accountId) {
        pass("existing-account-protected", "Existing acct never overwritten");
      } else {
        fail("existing-account-protected", `stored=${row?.stripeAccountId}`);
      }
      // restore mock
      __setCreateAccountFnForTests(async (_params, options) => {
        createCalls += 1;
        const key = options?.idempotencyKey ?? "";
        if (key && idempotencyCache.has(key)) return idempotencyCache.get(key)!;
        const acct = fakeAccount(`acct_p16_${createCalls}_${Date.now()}`);
        if (key) idempotencyCache.set(key, acct);
        return acct;
      });
    });

    // D. Stripe create success / DB persist failure simulation via CAS lost after create
    await withTestBusiness("dbfail", async ({ businessId, email }) => {
      createCalls = 0;
      idempotencyCache.clear();
      let attempt = 0;
      __setCreateAccountFnForTests(async (_params, options) => {
        attempt += 1;
        const key = options?.idempotencyKey ?? `k${attempt}`;
        if (idempotencyCache.has(key)) return idempotencyCache.get(key)!;
        const acct = fakeAccount(`acct_retry_${attempt}_${Date.now()}`);
        idempotencyCache.set(key, acct);
        return acct;
      });
      // Pre-bind a winner mid-flight: first create returns, but we bind via parallel ensure
      // Simpler: call ensure once (persists), clear local memory of "create", call ensure again —
      // idempotency returns same Stripe account; DB already has it.
      const first = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      const beforeCalls = attempt;
      const second = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      if (
        first.accountId === second.accountId &&
        connectExpressIdempotencyKey(businessId) === `connect_express:${businessId}` &&
        beforeCalls >= 1
      ) {
        pass("retry-idempotent", "Retry reuses same idempotent Stripe account / stored binding");
      } else {
        fail("retry-idempotent", `first=${first.accountId} second=${second.accountId}`);
      }
    });

    // E. Isolation A vs B
    const suffix = `iso_${Date.now()}`;
    const passwordHash = await bcrypt.hash("ConnectPhase16!23", 4);
    const userA = await prisma.user.create({
      data: {
        email: `a_${suffix}@example.com`,
        passwordHash,
        role: Role.MANAGER,
        emailVerified: true,
        hasCompletedOnboarding: true,
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `b_${suffix}@example.com`,
        passwordHash,
        role: Role.MANAGER,
        emailVerified: true,
        hasCompletedOnboarding: true,
      },
    });
    const bizA = await prisma.business.create({
      data: { name: `A ${suffix}`, slug: `a-${suffix}`, userId: userA.id },
    });
    const bizB = await prisma.business.create({
      data: { name: `B ${suffix}`, slug: `b-${suffix}`, userId: userB.id },
    });
    try {
      createCalls = 0;
      idempotencyCache.clear();
      __setCreateAccountFnForTests(async (_params, options) => {
        createCalls += 1;
        const key = options?.idempotencyKey ?? "";
        if (key && idempotencyCache.has(key)) return idempotencyCache.get(key)!;
        const acct = fakeAccount(`acct_iso_${createCalls}_${Date.now()}`);
        if (key) idempotencyCache.set(key, acct);
        return acct;
      });
      const ra = await ensureExpressConnectedAccountForBusiness({
        businessId: bizA.id,
        managerEmail: userA.email,
      });
      const rb = await ensureExpressConnectedAccountForBusiness({
        businessId: bizB.id,
        managerEmail: userB.email,
      });
      if (ra.accountId !== rb.accountId) {
        pass("tenant-isolation-create", "Business A and B received distinct Connect accounts");
      } else {
        fail("tenant-isolation-create", "A and B share the same account id");
      }

      await handleConnectAccountUpdated(
        fakeAccount(ra.accountId, {
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        }),
        { eventCreatedUnix: Math.floor(Date.now() / 1000) },
      );
      const rowB = await prisma.business.findUnique({
        where: { id: bizB.id },
        select: { stripeChargesEnabled: true, stripeAccountId: true },
      });
      if (rowB?.stripeAccountId === rb.accountId && !rowB.stripeChargesEnabled) {
        pass("tenant-isolation-webhook", "Updating A does not mutate B");
      } else {
        fail("tenant-isolation-webhook", "Business B incorrectly mutated");
      }
    } finally {
      await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    }

    // F. Ownership transfer preserves acct
    await withTestBusiness("own", async ({ businessId, ownerId, email }) => {
      createCalls = 0;
      idempotencyCache.clear();
      __setCreateAccountFnForTests(async (_params, options) => {
        createCalls += 1;
        const key = options?.idempotencyKey ?? "";
        if (key && idempotencyCache.has(key)) return idempotencyCache.get(key)!;
        const acct = fakeAccount(`acct_own_${createCalls}_${Date.now()}`);
        if (key) idempotencyCache.set(key, acct);
        return acct;
      });
      const ensured = await ensureExpressConnectedAccountForBusiness({
        businessId,
        managerEmail: email,
      });
      const succ = await prisma.user.create({
        data: {
          email: `succ_${Date.now()}@example.com`,
          passwordHash: await bcrypt.hash("ConnectPhase16!23", 4),
          role: Role.MANAGER,
          emailVerified: true,
          hasCompletedOnboarding: true,
        },
      });
      try {
        await transferBusinessOwnership({
          businessId,
          successorUserId: succ.id,
          actorUserId: ownerId,
          source: "owner",
        });
        const row = await prisma.business.findUnique({
          where: { id: businessId },
          select: { stripeAccountId: true, userId: true },
        });
        if (row?.stripeAccountId === ensured.accountId && row.userId === succ.id) {
          pass("ownership-preserves-acct", "Transfer keeps stripeAccountId on Business");
        } else {
          fail("ownership-preserves-acct", `acct=${row?.stripeAccountId} owner=${row?.userId}`);
        }
      } finally {
        // Delete Business first (Restrict on userId), then both users.
        await prisma.business.deleteMany({ where: { id: businessId } }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: { in: [ownerId, succ.id] } } }).catch(() => undefined);
      }
    });

    // G/H stale webhook
    await withTestBusiness("stale", async ({ businessId, email }) => {
      createCalls = 0;
      idempotencyCache.clear();
      __setCreateAccountFnForTests(async (_params, options) => {
        const key = options?.idempotencyKey ?? "k";
        if (idempotencyCache.has(key)) return idempotencyCache.get(key)!;
        const acct = fakeAccount(`acct_stale_${Date.now()}`, { created: 1_700_000_000 });
        idempotencyCache.set(key, acct);
        return acct;
      });
      const { accountId } = await ensureExpressConnectedAccountForBusiness({
        businessId,
        managerEmail: email,
      });
      const tNewer = 1_800_000_100;
      const tOlder = 1_800_000_000;
      await handleConnectAccountUpdated(
        fakeAccount(accountId, {
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        }),
        { eventCreatedUnix: tNewer },
      );
      let row = await prisma.business.findUnique({
        where: { id: businessId },
        select: {
          stripeChargesEnabled: true,
          stripeConnectStatus: true,
          stripeConnectUpdatedAt: true,
        },
      });
      if (row?.stripeChargesEnabled && row.stripeConnectStatus === StripeConnectStatus.ready) {
        pass("webhook-newer", "Newer account.updated applied ready state");
      } else {
        fail("webhook-newer", `status=${row?.stripeConnectStatus}`);
      }

      const afterNewer = row?.stripeConnectUpdatedAt;
      await handleConnectAccountUpdated(
        fakeAccount(accountId, {
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
        }),
        { eventCreatedUnix: tOlder },
      );
      row = await prisma.business.findUnique({
        where: { id: businessId },
        select: {
          stripeChargesEnabled: true,
          stripeConnectStatus: true,
          stripeConnectUpdatedAt: true,
        },
      });
      if (
        row?.stripeChargesEnabled === true &&
        row.stripeConnectStatus === StripeConnectStatus.ready &&
        afterNewer &&
        row.stripeConnectUpdatedAt?.getTime() === afterNewer.getTime()
      ) {
        pass("webhook-stale-ignored", "Older account.updated did not overwrite newer state");
      } else {
        fail(
          "webhook-stale-ignored",
          `charges=${row?.stripeChargesEnabled} status=${row?.stripeConnectStatus}`,
        );
      }
    });

    // I. Duplicate event id
    const eventId = `evt_p16_dup_${Date.now()}`;
    await markStripeWebhookEventProcessed(eventId, "account.updated");
    if (await isStripeWebhookEventProcessed(eventId)) {
      pass("webhook-event-id-idempotent", "Duplicate Stripe event id detected as processed");
    } else {
      fail("webhook-event-id-idempotent", "Event id not marked processed");
    }
    await prisma.stripeWebhookEvent.delete({ where: { id: eventId } }).catch(() => undefined);

    // J. Unknown account
    const unknown = await handleConnectAccountUpdated(
      fakeAccount(`acct_unknown_p16_${Date.now()}`, {
        charges_enabled: true,
        payouts_enabled: true,
      }),
      { eventCreatedUnix: Math.floor(Date.now() / 1000) },
    );
    if (!unknown.matched && unknown.businessId == null) {
      pass("webhook-unknown", "Unknown acct does not attach to a Business");
    } else {
      fail("webhook-unknown", "Unknown account incorrectly matched");
    }

    // K. Invalid signature — static (handler rejects without constructEvent success)
    const webhook = read("src/webhooks/stripe.webhook.ts");
    if (
      webhook.includes('status(400).send("Webhook signature verification failed")') &&
      webhook.includes("verifyWebhookSignature")
    ) {
      pass("webhook-invalid-signature", "Invalid signature path returns 400");
    } else {
      fail("webhook-invalid-signature", "Missing invalid signature rejection");
    }

    // Legal hold blocks ensure
    await withTestBusiness("hold", async ({ businessId, email }) => {
      await prisma.business.update({
        where: { id: businessId },
        data: { legalHold: true, legalHoldReason: "phase16 test" },
      });
      const caught = await ensureExpressConnectedAccountForBusiness({
        businessId,
        managerEmail: email,
      }).then(
        () => null,
        (err: unknown) => err,
      );
      if (caught instanceof StripeConnectError && caught.code === "BUSINESS_LEGAL_HOLD") {
        pass("legal-hold-blocks-ensure", "Connect ensure blocked under legal hold");
      } else if (caught == null) {
        fail("legal-hold-blocks-ensure", "Expected LEGAL_HOLD error");
      } else {
        fail(
          "legal-hold-blocks-ensure",
          `Unexpected: ${caught instanceof Error ? `${caught.name}:${caught.message}` : String(caught)}`,
        );
      }
    });
  } catch (err: unknown) {
    fail("db-suite-body", err instanceof Error ? err.message : String(err));
  } finally {
    __setCreateAccountFnForTests(null);
    __setSerializeConnectEnsureForTests(true);
  }
}

async function main() {
  console.log("=== CareTip Stripe Connect Phase 1.6 Tests ===\n");
  runStaticBoundary();
  runStaleUnit();
  try {
    await runDbSuite();
  } catch (err) {
    fail("db-suite", err instanceof Error ? err.message : String(err));
  }

  console.log("--- Results ---\n");
  for (const r of results) {
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
  }
  const failures = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length} checks, ${failures.length} failed`);
  await prisma.$disconnect().catch(() => undefined);
  if (failures.length > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
