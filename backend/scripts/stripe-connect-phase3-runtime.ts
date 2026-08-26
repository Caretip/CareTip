/**
 * Stripe Connect Phase 3 — payout observation, attribution, lifecycle, APIs.
 * Run: npm run test:stripe-connect-phase3
 *
 * Uses webhook fixtures/mocks. Does not call payouts.create or live payout APIs.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import {
  OnboardingVerificationStatus,
  Role,
  StripeConnectPayoutStatus,
  StripeConnectStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { CARETIP_FEE_FIXED_CENTS_EUR, CARETIP_FEE_PERCENT } from "../src/config/fees.js";
import { verifyWebhookSignature } from "../src/services/stripe.service.js";
import { transferBusinessOwnership } from "../src/services/businessOwnership.service.js";
import {
  isStripeWebhookEventProcessed,
  markStripeWebhookEventProcessed,
} from "../src/services/stripeWebhookIdempotency.service.js";
import {
  getPayoutForBusiness,
  handleConnectPayoutEvent,
  listPayoutsForBusiness,
  shouldApplyPayoutEvent,
  __clearConnectPayoutSyncThrottleForTests,
  __setListConnectPayoutsFnForTests,
  __setListPayoutBalanceTransactionsFnForTests,
  __setPayoutHandlerAfterUpsertHookForTests,
} from "../src/services/stripeConnectPayout.service.js";
import * as connectController from "../src/controllers/connect.controller.js";

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

type Venue = {
  managerId: string;
  employeeUserId: string;
  businessId: string;
  employeeId: string;
  stripeAccountId: string;
};

async function createVenue(
  tag: string,
  connect: { stripeAccountId?: string | null } = {},
): Promise<Venue> {
  const suffix = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("ConnectPhase3!23", 4);
  const manager = await prisma.user.create({
    data: {
      email: `mgr_${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });
  const empUser = await prisma.user.create({
    data: {
      email: `emp_${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
      isActive: true,
    },
  });
  const acct =
    connect.stripeAccountId === null ? null : (connect.stripeAccountId ?? `acct_p3_${suffix}`);
  const biz = await prisma.business.create({
    data: {
      name: `Connect3 ${suffix}`,
      slug: `connect3-${suffix}`,
      userId: manager.id,
      onboardingVerificationStatus: OnboardingVerificationStatus.approved,
      operationalStatus: "active",
      stripeAccountId: acct,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  const emp = await prisma.employee.create({
    data: {
      name: `Staff ${suffix}`,
      jobTitle: "Server",
      businessId: biz.id,
      userId: empUser.id,
      isActive: true,
      activationStatus: "active",
    },
  });
  return {
    managerId: manager.id,
    employeeUserId: empUser.id,
    businessId: biz.id,
    employeeId: emp.id,
    stripeAccountId: acct ?? "",
  };
}

async function destroyVenue(v: Venue): Promise<void> {
  await prisma.stripeConnectPayout.deleteMany({ where: { businessId: v.businessId } }).catch(() => undefined);
  await prisma.notification.deleteMany({
    where: { userId: { in: [v.managerId, v.employeeUserId] } },
  }).catch(() => undefined);
  await prisma.transaction.deleteMany({
    where: { OR: [{ businessId: v.businessId }, { employeeId: v.employeeId }] },
  }).catch(() => undefined);
  await prisma.employee.deleteMany({ where: { id: v.employeeId } }).catch(() => undefined);
  await prisma.business.deleteMany({ where: { id: v.businessId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [v.managerId, v.employeeUserId] } } }).catch(() => undefined);
}

function fakePayout(overrides: Record<string, unknown> = {}): Stripe.Payout {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "po_test_default",
    object: "payout",
    amount: 950,
    arrival_date: now + 86400,
    automatic: true,
    balance_transaction: "txn_test",
    created: now,
    currency: "eur",
    description: "STRIPE PAYOUT",
    destination: null,
    failure_balance_transaction: null,
    failure_code: null,
    failure_message: null,
    livemode: false,
    metadata: {},
    method: "standard",
    source_type: "card",
    statement_descriptor: null,
    status: "pending",
    type: "bank_account",
    ...overrides,
  } as Stripe.Payout;
}

function fakePayoutEvent(opts: {
  eventId: string;
  type: string;
  account?: string | null;
  created: number;
  payout: Stripe.Payout;
}): Stripe.Event {
  return {
    id: opts.eventId,
    object: "event",
    api_version: "2024-11-20.acacia",
    created: opts.created,
    type: opts.type,
    account: opts.account ?? undefined,
    data: { object: opts.payout },
    livemode: false,
    pending_webhooks: 1,
    request: null,
  } as Stripe.Event;
}

function mockReq(overrides: {
  user?: { userId: string; id?: string } | undefined;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}): Request {
  return {
    user: overrides.user,
    query: overrides.query ?? {},
    params: overrides.params ?? {},
    body: overrides.body ?? {},
    headers: {},
  } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

async function processLikeWebhook(event: Stripe.Event): Promise<{ duplicate?: boolean }> {
  if (await isStripeWebhookEventProcessed(event.id)) return { duplicate: true };
  await handleConnectPayoutEvent(event);
  await markStripeWebhookEventProcessed(event.id, event.type);
  return {};
}

function runStatic() {
  const webhook = read("src/webhooks/stripe.webhook.ts");
  const payoutSvc = read("src/services/stripeConnectPayout.service.ts");
  const stripeSvc = read("src/services/stripe.service.ts");
  const connectSvc = read("src/services/stripeConnect.service.ts");
  const connectRoutes = read("src/routes/connect.routes.ts");
  const platformRoutes = read("src/routes/platform.routes.ts");
  const schema = read("prisma/schema.prisma");
  const fees = read("src/config/fees.ts");

  if (
    /\.payouts\.create\s*\(/.test(payoutSvc) ||
    /\.payouts\.create\s*\(/.test(stripeSvc) ||
    /\.payouts\.create\s*\(/.test(connectSvc)
  ) {
    fail("W-no-payouts-create", "payouts.create call found");
  } else {
    pass("W-no-payouts-create", "payouts.create not implemented");
  }

  if (connectRoutes.includes("router.post") && /payouts/.test(connectRoutes) && connectRoutes.includes('router.post("/connect/payouts"')) {
    fail("J-no-client-create", "POST manager payouts route present");
  } else if (!connectRoutes.includes("listMyConnectPayouts") || connectRoutes.includes("router.post(\"/connect/payouts\"")) {
    fail("J-no-client-create", "Unexpected payout mutation route");
  } else {
    pass("J-no-client-create", "Manager payout APIs are GET-only");
  }

  if (
    connectRoutes.includes("listMyConnectPayouts") &&
    connectRoutes.includes("requireRole(Role.MANAGER)") &&
    connectRoutes.includes("authMiddleware")
  ) {
    pass("N-role-static", "Manager payout list uses auth + MANAGER role");
  } else {
    fail("N-role-static", "Manager payout route missing auth/role");
  }

  if (
    platformRoutes.includes("listConnectPayouts") &&
    platformRoutes.includes("requirePlatformAdmin") &&
    !platformRoutes.includes("router.post(\"/connect-payouts\"")
  ) {
    pass("admin-read-only", "Platform connect-payouts is read-only behind existing admin auth");
  } else {
    fail("admin-read-only", "Platform payout visibility wiring incomplete");
  }

  const payoutHandleIdx = webhook.indexOf("handleConnectPayoutEvent");
  const payoutBlock = webhook.slice(payoutHandleIdx, payoutHandleIdx + 600);
  if (
    payoutHandleIdx >= 0 &&
    payoutBlock.includes("markStripeWebhookEventProcessed") &&
    payoutBlock.indexOf("handleConnectPayoutEvent") < payoutBlock.indexOf("markStripeWebhookEventProcessed")
  ) {
    pass("U-static-mark-after-handler", "Payout events marked processed only after handler");
  } else {
    fail("U-static-mark-after-handler", "Payout webhook mark-after-handler missing");
  }

  if (
    stripeSvc.includes("transfer_data") &&
    stripeSvc.includes("application_fee_amount") &&
    stripeSvc.includes("refund_application_fee: true") &&
    stripeSvc.includes("reverse_transfer: true")
  ) {
    pass("X-destination-unchanged", "Destination-charge Checkout path still present");
    pass("Z-refund-app-fee-unchanged", "refund_application_fee + reverse_transfer for destination-charge full refunds");
  } else {
    fail("X-destination-unchanged", "Destination-charge path changed");
    fail("Z-refund-app-fee-unchanged", "Refund application fee path changed");
  }

  if (
    fees.includes("CARETIP_FEE_PERCENT = 10") &&
    fees.includes("CARETIP_FEE_FIXED_CENTS_EUR = 49")
  ) {
    pass("Y-fee-policy", "CARETIP_FEE_PERCENT = 10 + €0.49");
  } else {
    fail("Y-fee-policy", `fee policy drifted`);
  }

  if (schema.includes("model StripeConnectPayout") && schema.includes("payoutStatus          PayoutStatus")) {
    pass("legacy-payoutStatus-preserved", "StripeConnectPayout is separate from Transaction.payoutStatus");
  } else {
    fail("legacy-payoutStatus-preserved", "Schema missing StripeConnectPayout or legacy payoutStatus");
  }

  if (schema.includes("stripePayoutId         String                    @unique") || schema.includes("@unique @map(\"stripe_payout_id\")")) {
    pass("unique-stripe-payout-id", "stripePayoutId unique");
  } else {
    fail("unique-stripe-payout-id", "Missing unique stripe payout id");
  }

  if (
    payoutSvc.includes("syncConnectPayoutsFromStripeForBusiness") &&
    payoutSvc.includes("stripeAccount:") &&
    payoutSvc.includes("payouts.list")
  ) {
    pass("sync-connected-account-scoped", "List sync uses stripe.payouts.list with stripeAccount");
  } else {
    fail("sync-connected-account-scoped", "Missing connected-account payout list sync");
  }

  const paidThenPending = shouldApplyPayoutEvent({
    storedStatus: StripeConnectPayoutStatus.paid,
    storedEventCreated: 200,
    incomingStatus: StripeConnectPayoutStatus.pending,
    incomingEventCreated: 100,
  });
  if (!paidThenPending.apply) pass("unit-stale-paid", paidThenPending.reason);
  else fail("unit-stale-paid", "paid allowed stale pending");

  const failedThenPendingNewer = shouldApplyPayoutEvent({
    storedStatus: StripeConnectPayoutStatus.failed,
    storedEventCreated: 100,
    incomingStatus: StripeConnectPayoutStatus.pending,
    incomingEventCreated: 300,
  });
  if (!failedThenPendingNewer.apply) pass("unit-failed-no-regress", failedThenPendingNewer.reason);
  else fail("unit-failed-no-regress", "failed allowed pending");
}

async function runRuntime() {
  // Default: do not hit live Stripe payouts.list during list/sync in this suite.
  __setListConnectPayoutsFnForTests(async () => ({ data: [], hasMore: false }));
  __clearConnectPayoutSyncThrottleForTests();
  __setListPayoutBalanceTransactionsFnForTests(async () => [
    {
      id: `txn_p3_${Date.now()}`,
      type: "payment",
      reporting_category: "charge",
      amount: 1000,
      fee: 50,
      net: 950,
      currency: "eur",
      created: Math.floor(Date.now() / 1000),
    },
  ]);

  const venueA = await createVenue("a");
  const venueB = await createVenue("b");
  const venueMissed = await createVenue("missed");

  try {
    const poA = `po_test_a_${Date.now()}`;
    const t0 = Math.floor(Date.now() / 1000);

    const created = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p3_created_${Date.now()}`,
        type: "payout.created",
        account: venueA.stripeAccountId,
        created: t0,
        payout: fakePayout({
          id: poA,
          amount: 950,
          currency: "eur",
          status: "pending",
          metadata: { businessId: venueB.businessId, amount: "1" },
        }),
      }),
    );
    const rowsA = await prisma.stripeConnectPayout.findMany({
      where: { stripePayoutId: poA },
    });
    if (created.matched && rowsA.length === 1 && rowsA[0]?.businessId === venueA.businessId) {
      pass("A-map-acct-A-to-business-A", `business=${rowsA[0]?.businessId}`);
    } else {
      fail("A-map-acct-A-to-business-A", `matched=${created.matched} rows=${rowsA.length} biz=${rowsA[0]?.businessId}`);
    }

    const unknown = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p3_unknown_${Date.now()}`,
        type: "payout.created",
        account: `acct_unknown_${Date.now()}`,
        created: t0,
        payout: fakePayout({ id: `po_test_unknown_${Date.now()}`, amount: 100, status: "pending" }),
      }),
    );
    if (!unknown.matched && unknown.reason === "unknown_account") {
      pass("B-unknown-acct-no-attach", unknown.reason);
    } else {
      fail("B-unknown-acct-no-attach", JSON.stringify(unknown));
    }

    const spoof = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p3_spoof_${Date.now()}`,
        type: "payout.created",
        account: venueA.stripeAccountId,
        created: t0 + 1,
        payout: fakePayout({
          id: `po_test_spoof_${Date.now()}`,
          amount: 222,
          status: "pending",
          metadata: { businessId: venueB.businessId, stripeAccountId: venueB.stripeAccountId },
        }),
      }),
    );
    const spoofRow = spoof.payoutRowId
      ? await prisma.stripeConnectPayout.findUnique({ where: { id: spoof.payoutRowId } })
      : null;
    if (spoof.matched && spoofRow?.businessId === venueA.businessId && spoofRow.businessId !== venueB.businessId) {
      pass("C-acct-A-cannot-attach-B", "metadata businessId ignored");
    } else {
      fail("C-acct-A-cannot-attach-B", `biz=${spoofRow?.businessId} expected=${venueA.businessId}`);
    }

    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p3_created_dup_${Date.now()}`,
        type: "payout.created",
        account: venueA.stripeAccountId,
        created: t0 + 2,
        payout: fakePayout({ id: poA, amount: 950, currency: "eur", status: "pending" }),
      }),
    );
    const afterCreatedDup = await prisma.stripeConnectPayout.count({ where: { stripePayoutId: poA } });
    if (afterCreatedDup === 1) pass("D-duplicate-created-idempotent", "single row");
    else fail("D-duplicate-created-idempotent", `rows=${afterCreatedDup}`);

    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p3_paid_${Date.now()}`,
        type: "payout.paid",
        account: venueA.stripeAccountId,
        created: t0 + 10,
        payout: fakePayout({ id: poA, amount: 950, currency: "eur", status: "paid" }),
      }),
    );
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p3_paid_dup_${Date.now()}`,
        type: "payout.paid",
        account: venueA.stripeAccountId,
        created: t0 + 11,
        payout: fakePayout({ id: poA, amount: 950, currency: "eur", status: "paid" }),
      }),
    );
    const paidRows = await prisma.stripeConnectPayout.findMany({ where: { stripePayoutId: poA } });
    if (paidRows.length === 1 && paidRows[0]?.status === StripeConnectPayoutStatus.paid) {
      pass("E-duplicate-paid-idempotent", "single paid row");
    } else {
      fail("E-duplicate-paid-idempotent", `n=${paidRows.length} status=${paidRows[0]?.status}`);
    }

    const stale = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p3_stale_pending_${Date.now()}`,
        type: "payout.updated",
        account: venueA.stripeAccountId,
        created: t0,
        payout: fakePayout({ id: poA, amount: 950, currency: "eur", status: "pending" }),
      }),
    );
    const afterStale = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: poA } });
    if (stale.skippedStale && afterStale?.status === StripeConnectPayoutStatus.paid) {
      pass("F-out-of-order-no-regress-paid", stale.reason ?? "skipped");
    } else {
      fail("F-out-of-order-no-regress-paid", `status=${afterStale?.status} skipped=${stale.skippedStale}`);
    }

    const poFail = `po_test_fail_${Date.now()}`;
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p3_fail_${Date.now()}`,
        type: "payout.failed",
        account: venueA.stripeAccountId,
        created: t0 + 20,
        payout: fakePayout({
          id: poFail,
          amount: 400,
          currency: "eur",
          status: "failed",
          failure_code: "account_closed",
          failure_message: "The bank account was closed. IBAN DE89370400440532013000",
        }),
      }),
    );
    const newerPending = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p3_fail_regress_${Date.now()}`,
        type: "payout.updated",
        account: venueA.stripeAccountId,
        created: t0 + 50,
        payout: fakePayout({ id: poFail, amount: 400, currency: "eur", status: "pending" }),
      }),
    );
    const failRow = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: poFail } });
    if (
      newerPending.skippedStale &&
      failRow?.status === StripeConnectPayoutStatus.failed &&
      failRow.failureCode === "account_closed" &&
      failRow.failureMessage &&
      !failRow.failureMessage.includes("DE89370400440532013000")
    ) {
      pass("G-out-of-order-no-regress-failed", newerPending.reason ?? "skipped");
    } else {
      fail(
        "G-out-of-order-no-regress-failed",
        `status=${failRow?.status} msg=${failRow?.failureMessage} skipped=${newerPending.skippedStale}`,
      );
    }

    if (afterStale?.amountCents === 950 && afterStale.currency === "eur") {
      pass("H-amount-from-stripe", "950 cents from Stripe object");
      pass("I-currency-from-stripe", "eur from Stripe object");
    } else {
      fail("H-amount-from-stripe", `amount=${afterStale?.amountCents}`);
      fail("I-currency-from-stripe", `currency=${afterStale?.currency}`);
    }

    const listA = await listPayoutsForBusiness(venueA.businessId, { take: 50, skip: 0 });
    const resIgnoreBiz = mockRes();
    await connectController.listMyConnectPayouts(
      mockReq({
        user: { userId: venueA.managerId },
        query: { businessId: venueB.businessId, take: 50 },
      }),
      resIgnoreBiz,
    );
    const listed = resIgnoreBiz.body as { items?: Array<{ id: string }>; total?: number };
    const idsA = new Set(listA.items.map((i) => i.id));
    const bPayouts = await listPayoutsForBusiness(venueB.businessId);
    const onlyA =
      resIgnoreBiz.statusCode === 200 &&
      (listed.items ?? []).every((item) => idsA.has(item.id)) &&
      (listed.total ?? -1) === listA.total;
    if (bPayouts.total === 0 && onlyA) {
      pass("K-manager-cannot-specify-businessId", "query businessId ignored; JWT business only");
    } else {
      fail(
        "K-manager-cannot-specify-businessId",
        `A=${listA.total} listed=${listed.total} B=${bPayouts.total} status=${resIgnoreBiz.statusCode}`,
      );
    }

    const payoutA = listA.items[0];
    const resIdor = mockRes();
    if (payoutA) {
      await connectController.getMyConnectPayout(
        mockReq({
          user: { userId: venueB.managerId },
          params: { id: payoutA.id },
        }),
        resIdor,
      );
      if (resIdor.statusCode === 404) pass("L-manager-A-cannot-read-B", "404 on cross-tenant payout id");
      else fail("L-manager-A-cannot-read-B", `status=${resIdor.statusCode}`);
    } else {
      fail("L-manager-A-cannot-read-B", "missing payout A");
    }

    const resUnauth = mockRes();
    await connectController.listMyConnectPayouts(mockReq({ user: undefined }), resUnauth);
    if (resUnauth.statusCode === 401) pass("M-list-requires-auth", "401 without JWT user");
    else fail("M-list-requires-auth", `status=${resUnauth.statusCode}`);

    const resEmp = mockRes();
    await connectController.listMyConnectPayouts(
      mockReq({ user: { userId: venueA.employeeUserId } }),
      resEmp,
    );
    if (resEmp.statusCode === 404) pass("N-list-requires-manager-business", "employee has no manager business");
    else fail("N-list-requires-manager-business", `status=${resEmp.statusCode}`);

    const originalOwnerId = venueA.managerId;
    const succ = await prisma.user.create({
      data: {
        email: `succ_${Date.now()}@example.com`,
        passwordHash: await bcrypt.hash("ConnectPhase3!23", 4),
        role: Role.MANAGER,
        emailVerified: true,
        hasCompletedOnboarding: true,
      },
    });
    try {
      await transferBusinessOwnership({
        businessId: venueA.businessId,
        successorUserId: succ.id,
        actorUserId: originalOwnerId,
        source: "owner",
      });
      const afterXfer = await listPayoutsForBusiness(venueA.businessId);
      const resNewOwner = mockRes();
      await connectController.listMyConnectPayouts(
        mockReq({ user: { userId: succ.id }, query: { take: 50 } }),
        resNewOwner,
      );
      const newBody = resNewOwner.body as { total?: number };
      if (afterXfer.total >= 1 && resNewOwner.statusCode === 200 && (newBody.total ?? 0) >= 1) {
        pass("O-ownership-preserves-payout-history", `total=${afterXfer.total}`);
      } else {
        fail("O-ownership-preserves-payout-history", `svc=${afterXfer.total} http=${resNewOwner.statusCode}`);
      }
      venueA.managerId = succ.id;
    } finally {
      await prisma.user.deleteMany({ where: { id: originalOwnerId } }).catch(() => undefined);
    }

    await prisma.business.update({
      where: { id: venueA.businessId },
      data: { deletedAt: new Date(), lifecycleStatus: "soft_closed" },
    });
    const afterSoft = await prisma.stripeConnectPayout.count({ where: { businessId: venueA.businessId } });
    const afterSoftList = await listPayoutsForBusiness(venueA.businessId);
    if (afterSoft >= 1 && afterSoftList.total === afterSoft) {
      pass("P-soft-close-preserves-payouts", `rows=${afterSoft}`);
    } else {
      fail("P-soft-close-preserves-payouts", `rows=${afterSoft}`);
    }

    await prisma.business.update({
      where: { id: venueA.businessId },
      data: { legalHold: true, legalHoldReason: "phase3-test" },
    });
    const afterHold = await prisma.stripeConnectPayout.count({ where: { businessId: venueA.businessId } });
    if (afterHold >= 1) pass("Q-legal-hold-preserves-payouts", `rows=${afterHold}`);
    else fail("Q-legal-hold-preserves-payouts", `rows=${afterHold}`);

    try {
      verifyWebhookSignature(Buffer.from("{}"), "t=1,v1=deadbeef");
      fail("R-invalid-signature-rejected", "invalid signature accepted");
    } catch {
      pass("R-invalid-signature-rejected", "constructEvent rejected invalid signature");
    }
    try {
      verifyWebhookSignature(Buffer.from("{}"), undefined);
      fail("S-missing-signature-rejected", "missing signature accepted");
    } catch {
      pass("S-missing-signature-rejected", "missing signature rejected");
    }

    const throwPo = `po_test_throw_${Date.now()}`;
    const throwEvtId = `evt_p3_throw_${Date.now()}`;
    __setPayoutHandlerAfterUpsertHookForTests(async () => {
      throw new Error("phase3-handler-boom");
    });
    try {
      await processLikeWebhook(
        fakePayoutEvent({
          eventId: throwEvtId,
          type: "payout.created",
          account: venueA.stripeAccountId,
          created: t0 + 80,
          payout: fakePayout({ id: throwPo, amount: 100, currency: "eur", status: "pending" }),
        }),
      );
      fail("T-failed-handler-retryable", "handler throw was swallowed");
      fail("U-event-not-marked-on-failure", "processLikeWebhook completed");
    } catch {
      const processed = await isStripeWebhookEventProcessed(throwEvtId);
      if (!processed) {
        pass("T-failed-handler-retryable", "throw before mark; Stripe can retry");
        pass("U-event-not-marked-on-failure", "StripeWebhookEvent absent after handler failure");
      } else {
        fail("T-failed-handler-retryable", "event marked despite throw");
        fail("U-event-not-marked-on-failure", "processed=true");
      }
    } finally {
      __setPayoutHandlerAfterUpsertHookForTests(null);
    }

    const dto = await getPayoutForBusiness(venueA.businessId, paidRows[0]!.id);
    const dtoJson = JSON.stringify(dto);
    if (
      dto &&
      !dtoJson.includes("iban") &&
      !dtoJson.includes("routing") &&
      !dtoJson.includes("account_number") &&
      !dtoJson.includes("sk_test") &&
      !dtoJson.includes("sk_live") &&
      !dtoJson.includes("destination") &&
      !("stripeAccountId" in dto) &&
      !("stripePayoutId" in dto)
    ) {
      pass("V-no-secrets-in-dto", "manager DTO omits bank details and Stripe account/payout ids");
    } else {
      fail("V-no-secrets-in-dto", dtoJson.slice(0, 240));
    }

    if (CARETIP_FEE_PERCENT === 10 && CARETIP_FEE_FIXED_CENTS_EUR === 49) pass("Y-runtime-fee", "10% + €0.49");
    else fail("Y-runtime-fee", `${CARETIP_FEE_PERCENT}+${CARETIP_FEE_FIXED_CENTS_EUR}`);

    // REGRESSION: Stripe shows PAID payout but CareTip DB empty (missed webhook) → list sync fills UI.
    const missedPo = `po_test_missed_paid_${Date.now()}`;
    const beforeMissed = await prisma.stripeConnectPayout.count({ where: { businessId: venueMissed.businessId } });
    __clearConnectPayoutSyncThrottleForTests();
    __setListConnectPayoutsFnForTests(async (acct) => {
      if (acct !== venueMissed.stripeAccountId) return { data: [], hasMore: false };
      return {
        data: [
          fakePayout({
            id: missedPo,
            amount: 7500,
            currency: "eur",
            status: "paid",
            created: Math.floor(Date.now() / 1000) - 7 * 86400,
          }),
        ],
        hasMore: false,
      };
    });
    const syncedList = await listPayoutsForBusiness(venueMissed.businessId, { take: 50, skip: 0 });
    const missedRow = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: missedPo } });
    if (
      beforeMissed === 0 &&
      syncedList.total >= 1 &&
      syncedList.items.some((i) => i.status === StripeConnectPayoutStatus.paid && i.amountCents === 7500) &&
      missedRow?.businessId === venueMissed.businessId &&
      missedRow.status === StripeConnectPayoutStatus.paid
    ) {
      pass(
        "reg-stripe-paid-empty-caretip-sync",
        "Paid Connect payout from Stripe list appears after missed webhook",
      );
    } else {
      fail(
        "reg-stripe-paid-empty-caretip-sync",
        `before=${beforeMissed} total=${syncedList.total} status=${missedRow?.status} biz=${missedRow?.businessId}`,
      );
    }

    // Sync must not leak another connected account's payouts into this business.
    __clearConnectPayoutSyncThrottleForTests();
    __setListConnectPayoutsFnForTests(async (acct) => {
      if (acct !== venueB.stripeAccountId) return { data: [], hasMore: false };
      return {
        data: [fakePayout({ id: `po_test_b_only_${Date.now()}`, amount: 111, currency: "eur", status: "paid" })],
        hasMore: false,
      };
    });
    await listPayoutsForBusiness(venueB.businessId);
    const aAfterBSync = await listPayoutsForBusiness(venueA.businessId);
    if (!aAfterBSync.items.some((i) => i.amountCents === 111)) {
      pass("reg-sync-tenant-isolation", "Business A list unaffected by Business B Stripe sync");
    } else {
      fail("reg-sync-tenant-isolation", "cross-tenant payout appeared on A");
    }

    // Empty DB + Stripe sync failure must not present as "No payouts yet".
    __clearConnectPayoutSyncThrottleForTests();
    __setListConnectPayoutsFnForTests(async () => null);
    const emptyVenue = await createVenue("syncfail");
    try {
      let threw = false;
      try {
        await listPayoutsForBusiness(emptyVenue.businessId);
      } catch {
        threw = true;
      }
      if (threw) pass("reg-sync-fail-not-empty", "Stripe sync failure throws instead of empty list");
      else fail("reg-sync-fail-not-empty", "empty list returned despite sync failure");
    } finally {
      await destroyVenue(emptyVenue);
    }
  } finally {
    __setListConnectPayoutsFnForTests(null);
    __clearConnectPayoutSyncThrottleForTests();
    __setListPayoutBalanceTransactionsFnForTests(null);
    __setPayoutHandlerAfterUpsertHookForTests(null);
    await destroyVenue(venueA);
    await destroyVenue(venueB);
    await destroyVenue(venueMissed);
  }
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (key.startsWith("sk_live_")) {
    console.error("PHASE 3 E2E BLOCKED — LIVE STRIPE CREDENTIAL DETECTED.");
    process.exit(2);
  }

  console.log("=== CareTip Stripe Connect Phase 3 Tests ===\n");
  runStatic();
  try {
    await runRuntime();
  } catch (err) {
    fail("runtime-suite", err instanceof Error ? err.message : String(err));
    console.error(err);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

void main();
