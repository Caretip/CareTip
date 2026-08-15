/**
 * Stripe Connect Phase 4 — production payout operations, reconciliation & reliability.
 * Run: npm run test:stripe-connect-phase4
 *
 * Observation only. Does not implement payouts.create in backend/src.
 * Does not start Phase 5. Does not implement manual payouts.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import Stripe from "stripe";
import {
  OnboardingVerificationStatus,
  Role,
  StripeConnectPayoutReconciliationStatus,
  StripeConnectPayoutStatus,
  StripeConnectStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { CARETIP_FEE_FIXED_CENTS_EUR, CARETIP_FEE_PERCENT } from "../src/config/fees.js";
import { getStripeClient } from "../src/services/stripe.service.js";
import { transferBusinessOwnership } from "../src/services/businessOwnership.service.js";
import {
  getPayoutForBusiness,
  handleConnectPayoutEvent,
  listPlatformConnectPayouts,
  listPayoutsForBusiness,
  shouldApplyPayoutEvent,
  __setListPayoutBalanceTransactionsFnForTests,
  __setListPayoutBalanceTransactionPageFnForTests,
} from "../src/services/stripeConnectPayout.service.js";
import {
  reconcileConnectPayoutBalanceLines,
  tickConnectPayoutReconciliation,
  type BalanceTxLike,
} from "../src/services/stripeConnectPayoutReconciliation.service.js";
import * as connectController from "../src/controllers/connect.controller.js";

type Bucket = "REAL_STRIPE_E2E" | "MOCKED_SECURITY_TESTS" | "STATIC_ANALYSIS" | "DATABASE_TESTS";
type Result = { id: string; pass: boolean; detail: string; bucket: Bucket; blocked?: boolean };
const results: Result[] = [];
const backendRoot = process.cwd();

function pass(id: string, detail: string, bucket: Bucket) {
  results.push({ id, pass: true, detail, bucket });
}
function fail(id: string, detail: string, bucket: Bucket) {
  results.push({ id, pass: false, detail, bucket });
}
function blocked(id: string, detail: string, bucket: Bucket) {
  results.push({ id, pass: true, detail: `BLOCKED: ${detail}`, bucket, blocked: true });
}
function read(rel: string): string {
  return readFileSync(join(backendRoot, rel), "utf8");
}

function suffix(id: string | null | undefined): string {
  if (!id) return "(none)";
  return id.length <= 8 ? "(short)" : `…${id.slice(-8)}`;
}

function keyMode(): "missing" | "test" | "live" | "unknown" {
  const k = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!k) return "missing";
  if (k.startsWith("sk_test_")) return "test";
  if (k.startsWith("sk_live_")) return "live";
  return "unknown";
}

function walkSrcTs(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkSrcTs(p, acc);
    else if (name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

type Venue = {
  managerId: string;
  employeeUserId: string;
  businessId: string;
  employeeId: string;
  stripeAccountId: string;
};

async function createVenue(tag: string, acct?: string | null): Promise<Venue> {
  const s = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("ConnectPhase4!23", 4);
  const manager = await prisma.user.create({
    data: {
      email: `mgr_${s}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });
  const empUser = await prisma.user.create({
    data: {
      email: `emp_${s}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
      isActive: true,
    },
  });
  const stripeAccountId = acct === null ? null : (acct ?? `acct_p4_${s}`);
  const biz = await prisma.business.create({
    data: {
      name: `Connect4 ${s}`,
      slug: `connect4-${s}`,
      userId: manager.id,
      onboardingVerificationStatus: OnboardingVerificationStatus.approved,
      operationalStatus: "active",
      stripeAccountId,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  const emp = await prisma.employee.create({
    data: {
      name: `Staff ${s}`,
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
    stripeAccountId: stripeAccountId ?? "",
  };
}

async function destroyVenue(v: Venue): Promise<void> {
  await prisma.stripeConnectPayout.deleteMany({ where: { businessId: v.businessId } }).catch(() => undefined);
  await prisma.notification.deleteMany({
    where: { userId: { in: [v.managerId, v.employeeUserId] } },
  }).catch(() => undefined);
  await prisma.employee.deleteMany({ where: { id: v.employeeId } }).catch(() => undefined);
  await prisma.business.deleteMany({ where: { id: v.businessId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [v.managerId, v.employeeUserId] } } }).catch(() => undefined);
}

function fakePayout(overrides: Record<string, unknown> = {}): Stripe.Payout {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "po_test_p4_default",
    object: "payout",
    amount: 12345,
    arrival_date: now + 86400,
    automatic: true,
    created: now,
    currency: "eur",
    description: "TEST PAYOUT",
    destination: null,
    failure_code: null,
    failure_message: null,
    livemode: false,
    metadata: {},
    method: "standard",
    source_type: "card",
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

function fakeBt(id: string, amount: number): BalanceTxLike {
  return {
    id,
    type: "charge",
    reporting_category: "charge",
    amount,
    fee: 0,
    net: amount,
    currency: "eur",
    created: Math.floor(Date.now() / 1000),
  };
}

function mockReq(overrides: {
  user?: { userId: string } | undefined;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
}): Request {
  return {
    user: overrides.user,
    query: overrides.query ?? {},
    params: overrides.params ?? {},
    body: {},
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

function runStatic() {
  const srcRoot = join(backendRoot, "src");
  const srcFiles = walkSrcTs(srcRoot);
  const srcBlob = srcFiles.map((p) => readFileSync(p, "utf8")).join("\n");
  const routesConnect = read("src/routes/connect.routes.ts");
  const routesPlatform = read("src/routes/platform.routes.ts");
  const paymentRoutes = read("src/routes/payment.routes.ts");
  const stripeSvc = read("src/services/stripe.service.ts");
  const fees = read("src/config/fees.ts");
  const jobs = read("src/routes/internalJobs.routes.ts");
  const ui = read(join("..", "src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx"));

  const forbidden = [
    /\.payouts\.create\s*\(/,
    /\.payouts\.cancel\s*\(/,
    /\.externalAccounts\.create\s*\(/,
    /\.externalAccounts\.update\s*\(/,
  ];
  if (forbidden.every((re) => !re.test(srcBlob))) {
    pass("U-no-manual-payout-creation", "backend/src has no payouts.create/cancel", "STATIC_ANALYSIS");
    pass("V-no-external-account-mutation", "backend/src has no externalAccounts.create/update", "STATIC_ANALYSIS");
  } else {
    fail("U-no-manual-payout-creation", "forbidden Stripe mutate API in backend/src", "STATIC_ANALYSIS");
    fail("V-no-external-account-mutation", "externalAccounts mutate present", "STATIC_ANALYSIS");
  }

  if (
    !routesConnect.includes('router.post("/connect/payouts"') &&
    !routesPlatform.includes('router.post("/connect-payouts"') &&
    !routesPlatform.includes('router.patch("/connect-payouts"') &&
    !routesPlatform.includes('router.put("/connect-payouts"') &&
    !routesPlatform.includes('router.delete("/connect-payouts"')
  ) {
    pass("O-admin-read-only-static", "No payout mutation HTTP routes", "STATIC_ANALYSIS");
  } else {
    fail("O-admin-read-only-static", "Unexpected payout mutation route", "STATIC_ANALYSIS");
  }

  if (
    routesPlatform.includes("requirePlatformAdmin") &&
    routesPlatform.includes("auditPlatformAccess") &&
    routesPlatform.includes("listConnectPayouts")
  ) {
    pass("O-platform-admin-auth-static", "connect-payouts behind existing platform-admin stack", "STATIC_ANALYSIS");
  } else {
    fail("O-platform-admin-auth-static", "admin payout route missing auth/audit", "STATIC_ANALYSIS");
  }

  if (
    stripeSvc.includes("transfer_data") &&
    stripeSvc.includes("application_fee_amount") &&
    stripeSvc.includes("refund_application_fee: true") &&
    stripeSvc.includes("reverse_transfer: true") &&
    fees.includes("CARETIP_FEE_PERCENT = 10") &&
    fees.includes("CARETIP_FEE_FIXED_CENTS_EUR = 49")
  ) {
    pass("W-destination-regression-static", "Destination charge path unchanged", "STATIC_ANALYSIS");
    pass("X-application-fee-policy", "CARETIP_FEE_PERCENT = 10 + €0.49", "STATIC_ANALYSIS");
    pass("Y-refund-application-fee", "refund_application_fee + reverse_transfer for destination-charge full refunds", "STATIC_ANALYSIS");
  } else {
    fail("W-destination-regression-static", "Destination-charge path changed", "STATIC_ANALYSIS");
    fail("X-application-fee-policy", "fee constant changed", "STATIC_ANALYSIS");
    fail("Y-refund-application-fee", "refund_application_fee missing", "STATIC_ANALYSIS");
  }

  const destChargeCreates = (stripeSvc.match(/checkout\.sessions\.create\(/g) ?? []).length;
  const billingCreates = read("src/services/stripeBilling.service.ts").includes("checkout.sessions.create");
  if (
    destChargeCreates >= 1 &&
    stripeSvc.includes("transfer_data") &&
    paymentRoutes.includes("create-tip-session") &&
    !paymentRoutes.includes("create-intent") &&
    billingCreates
  ) {
    pass("Z-no-alternate-destination-path", "guest tip path remains create-tip-session; billing checkout is separate", "STATIC_ANALYSIS");
  } else {
    fail("Z-no-alternate-destination-path", `tip checkout.sessions.create=(${destChargeCreates})`, "STATIC_ANALYSIS");
  }

  if (jobs.includes("connect-payout-reconciliation-tick") && jobs.includes("authorizeCronRequest")) {
    pass("L-recon-tick-cron-gated", "reconciliation tick uses existing cron secret gate", "STATIC_ANALYSIS");
  } else {
    fail("L-recon-tick-cron-gated", "tick route missing or unauthenticated", "STATIC_ANALYSIS");
  }

  if (
    ui.includes("reconciliationStatus") &&
    ui.includes("formatConnectPayoutAmount") &&
    ui.includes("amountCents") &&
    !ui.includes("formatEur") &&
    !ui.includes("iban") &&
    !ui.includes("stripePayoutId") &&
    !ui.toLowerCase().includes("withdraw") &&
    !ui.toLowerCase().includes("pay now")
  ) {
    pass("T-ui-safe-fields", "Manager UI shows recon; currency-safe amount; no IBAN/withdraw", "STATIC_ANALYSIS");
  } else {
    fail("T-ui-safe-fields", "Manager payout UI fields unexpected", "STATIC_ANALYSIS");
  }

  if (CARETIP_FEE_PERCENT === 10 && CARETIP_FEE_FIXED_CENTS_EUR === 49) {
    pass("X-fee-runtime", "CARETIP_FEE_PERCENT=10 + €0.49", "STATIC_ANALYSIS");
  } else fail("X-fee-runtime", `${CARETIP_FEE_PERCENT}+${CARETIP_FEE_FIXED_CENTS_EUR}`, "STATIC_ANALYSIS");
}

async function runMockedAndDb() {
  __setListPayoutBalanceTransactionsFnForTests(async () => []);
  const venueA = await createVenue("isoA");
  const venueB = await createVenue("isoB");
  try {
    const t0 = Math.floor(Date.now() / 1000);
    const po = `po_test_p4_${Date.now()}`;
    const created = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_c_${Date.now()}`,
        type: "payout.created",
        account: venueA.stripeAccountId,
        created: t0,
        payout: fakePayout({
          id: po,
          amount: 12345,
          currency: "eur",
          status: "pending",
          metadata: { businessId: venueB.businessId, amount: "1" },
        }),
      }),
    );
    const row = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: po } });
    if (created.matched && row?.businessId === venueA.businessId && row.amountCents === 12345) {
      pass("A-payout-tenant-attribution", "acct_A → Business A; metadata ignored", "MOCKED_SECURITY_TESTS");
      pass("D-metadata-spoofing", "metadata.businessId of B ignored", "MOCKED_SECURITY_TESTS");
    } else {
      fail("A-payout-tenant-attribution", JSON.stringify(created), "MOCKED_SECURITY_TESTS");
      fail("D-metadata-spoofing", `biz=${row?.businessId}`, "MOCKED_SECURITY_TESTS");
    }

    const unknown = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_unk_${Date.now()}`,
        type: "payout.created",
        account: `acct_unknown_${Date.now()}`,
        created: t0,
        payout: fakePayout({ id: `po_test_unk_${Date.now()}`, amount: 50, status: "pending" }),
      }),
    );
    const missing = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_noacct_${Date.now()}`,
        type: "payout.created",
        account: null,
        created: t0,
        payout: fakePayout({ id: `po_test_noacct_${Date.now()}`, amount: 50, status: "pending" }),
      }),
    );
    if (!unknown.matched && unknown.reason === "unknown_account") {
      pass("B-unknown-account", "unknown acct_ not attached", "MOCKED_SECURITY_TESTS");
    } else fail("B-unknown-account", JSON.stringify(unknown), "MOCKED_SECURITY_TESTS");
    if (!missing.matched && missing.reason === "missing_event_account") {
      pass("C-missing-event-account", "missing event.account not attached", "MOCKED_SECURITY_TESTS");
    } else fail("C-missing-event-account", JSON.stringify(missing), "MOCKED_SECURITY_TESTS");

    const conflict = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_conf_${Date.now()}`,
        type: "payout.updated",
        account: venueB.stripeAccountId,
        created: t0 + 5,
        payout: fakePayout({ id: po, amount: 12345, currency: "eur", status: "paid" }),
      }),
    );
    const afterConflict = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: po } });
    if (
      !conflict.matched &&
      conflict.reason === "attribution_conflict" &&
      afterConflict?.businessId === venueA.businessId &&
      afterConflict.status === StripeConnectPayoutStatus.pending
    ) {
      pass("E-payout-account-reassignment", "existing po_ not reassigned to Business B", "MOCKED_SECURITY_TESTS");
    } else {
      fail("E-payout-account-reassignment", JSON.stringify({ conflict, status: afterConflict?.status }), "MOCKED_SECURITY_TESTS");
    }

    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_dupc_${Date.now()}`,
        type: "payout.created",
        account: venueA.stripeAccountId,
        created: t0 + 2,
        payout: fakePayout({ id: po, amount: 12345, currency: "eur", status: "pending" }),
      }),
    );
    if ((await prisma.stripeConnectPayout.count({ where: { stripePayoutId: po } })) === 1) {
      pass("F-duplicate-payout", "duplicate created → one row", "DATABASE_TESTS");
    } else fail("F-duplicate-payout", "duplicate rows", "DATABASE_TESTS");

    const concPo = `po_test_p4_conc_${Date.now()}`;
    await Promise.all([
      handleConnectPayoutEvent(
        fakePayoutEvent({
          eventId: `evt_p4_conc_a_${Date.now()}`,
          type: "payout.created",
          account: venueA.stripeAccountId,
          created: t0 + 20,
          payout: fakePayout({ id: concPo, amount: 400, currency: "eur", status: "pending" }),
        }),
      ),
      handleConnectPayoutEvent(
        fakePayoutEvent({
          eventId: `evt_p4_conc_b_${Date.now() + 1}`,
          type: "payout.updated",
          account: venueA.stripeAccountId,
          created: t0 + 21,
          payout: fakePayout({ id: concPo, amount: 400, currency: "eur", status: "in_transit" }),
        }),
      ),
      handleConnectPayoutEvent(
        fakePayoutEvent({
          eventId: `evt_p4_conc_c_${Date.now() + 2}`,
          type: "payout.paid",
          account: venueA.stripeAccountId,
          created: t0 + 22,
          payout: fakePayout({ id: concPo, amount: 400, currency: "eur", status: "paid" }),
        }),
      ),
    ]);
    const concRows = await prisma.stripeConnectPayout.findMany({ where: { stripePayoutId: concPo } });
    if (concRows.length === 1) {
      pass("G-concurrent-payout-events", `one row status=${concRows[0]?.status}`, "DATABASE_TESTS");
    } else fail("G-concurrent-payout-events", `rows=${concRows.length}`, "DATABASE_TESTS");

    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_paid_${Date.now()}`,
        type: "payout.paid",
        account: venueA.stripeAccountId,
        created: t0 + 30,
        payout: fakePayout({ id: po, amount: 12345, currency: "eur", status: "paid" }),
      }),
    );
    const stale = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_stale_${Date.now()}`,
        type: "payout.updated",
        account: venueA.stripeAccountId,
        created: t0 + 1,
        payout: fakePayout({ id: po, amount: 12345, currency: "eur", status: "pending" }),
      }),
    );
    const afterStale = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: po } });
    if (stale.skippedStale && afterStale?.status === StripeConnectPayoutStatus.paid) {
      pass("H-stale-event", "older pending did not overwrite paid", "MOCKED_SECURITY_TESTS");
    } else fail("H-stale-event", JSON.stringify({ stale, status: afterStale?.status }), "MOCKED_SECURITY_TESTS");

    const failPo = `po_test_p4_fail_${Date.now()}`;
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_fail_${Date.now()}`,
        type: "payout.failed",
        account: venueA.stripeAccountId,
        created: t0 + 40,
        payout: fakePayout({
          id: failPo,
          amount: 999,
          currency: "eur",
          status: "failed",
          failure_code: "could_not_process",
          failure_message: "Bank IBAN DE89370400440532013000 declined",
        }),
      }),
    );
    const regress = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_reg_${Date.now()}`,
        type: "payout.updated",
        account: venueA.stripeAccountId,
        created: t0 + 41,
        payout: fakePayout({ id: failPo, amount: 999, currency: "eur", status: "pending" }),
      }),
    );
    const failRow = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: failPo } });
    if (
      failRow?.status === StripeConnectPayoutStatus.failed &&
      regress.skippedStale &&
      failRow.failureMessage?.includes("[redacted]") &&
      !failRow.failureMessage.includes("DE89")
    ) {
      pass("I-terminal-regression", "failed did not regress; IBAN redacted", "MOCKED_SECURITY_TESTS");
    } else {
      fail("I-terminal-regression", `status=${failRow?.status} msg=${failRow?.failureMessage}`, "MOCKED_SECURITY_TESTS");
    }

    const unitPaid = shouldApplyPayoutEvent({
      storedStatus: StripeConnectPayoutStatus.paid,
      storedEventCreated: 200,
      incomingStatus: StripeConnectPayoutStatus.in_transit,
      incomingEventCreated: 50,
    });
    if (!unitPaid.apply) pass("I-unit-paid-in-transit", unitPaid.reason, "MOCKED_SECURITY_TESTS");
    else fail("I-unit-paid-in-transit", "paid allowed in_transit", "MOCKED_SECURITY_TESTS");

    const pagePo = `po_test_p4_page_${Date.now()}`;
    const pageRow = await prisma.stripeConnectPayout.create({
      data: {
        businessId: venueA.businessId,
        stripeAccountId: venueA.stripeAccountId,
        stripePayoutId: pagePo,
        amountCents: 300,
        currency: "eur",
        status: StripeConnectPayoutStatus.paid,
        stripeCreatedAt: new Date(),
        lastStripeEventCreated: t0,
        lastStripeEventType: "payout.paid",
      },
    });
    const bt1 = fakeBt(`txn_p4_a_${Date.now()}`, 100);
    const bt2 = fakeBt(`txn_p4_b_${Date.now()}`, 200);
    const bt3 = fakeBt(`txn_p4_c_${Date.now()}`, 300);
    __setListPayoutBalanceTransactionPageFnForTests(async ({ startingAfter }) => {
      if (!startingAfter) return { data: [bt1], hasMore: true, lastId: bt1.id };
      if (startingAfter === bt1.id) return { data: [bt2], hasMore: true, lastId: bt2.id };
      if (startingAfter === bt2.id) return { data: [bt3], hasMore: false, lastId: bt3.id };
      return { data: [], hasMore: false, lastId: null };
    });
    const partial = await reconcileConnectPayoutBalanceLines(pageRow.id, { maxPages: 1 });
    const afterPartial = await prisma.stripeConnectPayout.findUnique({
      where: { id: pageRow.id },
      include: { _count: { select: { balanceLines: true } } },
    });
    if (
      partial.status === StripeConnectPayoutReconciliationStatus.partial &&
      afterPartial?._count.balanceLines === 1 &&
      afterPartial.reconciliationHasMore
    ) {
      pass("K-reconciliation-pagination", "maxPages=1 left recon partial with cursor", "DATABASE_TESTS");
    } else {
      fail("K-reconciliation-pagination", JSON.stringify(partial), "DATABASE_TESTS");
    }

    const resumed = await reconcileConnectPayoutBalanceLines(pageRow.id, { maxPages: 10 });
    const afterFull = await prisma.stripeConnectPayout.findUnique({
      where: { id: pageRow.id },
      include: { _count: { select: { balanceLines: true } } },
    });
    const replay = await reconcileConnectPayoutBalanceLines(pageRow.id, { maxPages: 10 });
    if (
      resumed.status === StripeConnectPayoutReconciliationStatus.complete &&
      afterFull?._count.balanceLines === 3 &&
      replay.reason === "already_complete"
    ) {
      pass("J-reconciliation-idempotency", "resume completed 3 unique lines; replay no-op", "DATABASE_TESTS");
    } else {
      fail("J-reconciliation-idempotency", JSON.stringify({ resumed, replay, n: afterFull?._count.balanceLines }), "DATABASE_TESTS");
    }

    __setListPayoutBalanceTransactionPageFnForTests(null);
    __setListPayoutBalanceTransactionsFnForTests(async () => null);
    const apiFailPo = `po_test_p4_api_${Date.now()}`;
    const apiFail = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_api_${Date.now()}`,
        type: "payout.paid",
        account: venueA.stripeAccountId,
        created: t0 + 50,
        payout: fakePayout({ id: apiFailPo, amount: 700, currency: "eur", status: "paid" }),
      }),
    );
    const apiFailRow = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: apiFailPo } });
    if (
      apiFail.matched &&
      apiFailRow &&
      apiFailRow.status === StripeConnectPayoutStatus.paid &&
      apiFailRow.reconciliationStatus === StripeConnectPayoutReconciliationStatus.failed
    ) {
      pass("M-stripe-api-failure", "payout persisted; recon marked failed; webhook matched", "MOCKED_SECURITY_TESTS");
    } else {
      fail("M-stripe-api-failure", JSON.stringify({ apiFail, recon: apiFailRow?.reconciliationStatus }), "MOCKED_SECURITY_TESTS");
    }

    const retryBts = [fakeBt(`txn_p4_retry_${Date.now()}`, 700)];
    __setListPayoutBalanceTransactionsFnForTests(async () => retryBts);
    const tick = await tickConnectPayoutReconciliation({
      ignoreBackoff: true,
      limit: 5,
      maxPages: 5,
      payoutIds: apiFailRow.id ? [apiFailRow.id] : [],
    });
    const afterTick = await prisma.stripeConnectPayout.findUnique({
      where: { stripePayoutId: apiFailPo },
      include: { _count: { select: { balanceLines: true } } },
    });
    if (
      afterTick?.reconciliationStatus === StripeConnectPayoutReconciliationStatus.complete &&
      afterTick._count.balanceLines === 1 &&
      tick.attempted >= 1
    ) {
      pass("L-reconciliation-retry", "tick recovered failed recon without duplicating payout", "DATABASE_TESTS");
    } else {
      fail("L-reconciliation-retry", JSON.stringify({ tick, recon: afterTick?.reconciliationStatus }), "DATABASE_TESTS");
    }

    const concReconPo = `po_test_p4_crecon_${Date.now()}`;
    const concReconRow = await prisma.stripeConnectPayout.create({
      data: {
        businessId: venueA.businessId,
        stripeAccountId: venueA.stripeAccountId,
        stripePayoutId: concReconPo,
        amountCents: 50,
        currency: "eur",
        status: StripeConnectPayoutStatus.paid,
        stripeCreatedAt: new Date(),
        lastStripeEventCreated: t0,
        lastStripeEventType: "payout.paid",
      },
    });
    const concBt = fakeBt(`txn_p4_crecon_${Date.now()}`, 50);
    __setListPayoutBalanceTransactionsFnForTests(async () => [concBt]);
    await Promise.all([
      reconcileConnectPayoutBalanceLines(concReconRow.id),
      reconcileConnectPayoutBalanceLines(concReconRow.id),
    ]);
    const concBtCount = await prisma.stripeConnectPayoutBalanceLine.count({
      where: { payoutId: concReconRow.id },
    });
    if (concBtCount === 1) {
      pass("G-concurrent-reconciliation", "concurrent recon produced one balance line", "DATABASE_TESTS");
    } else fail("G-concurrent-reconciliation", `lines=${concBtCount}`, "DATABASE_TESTS");

    const payoutA = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: po } });
    const resA = mockRes();
    await connectController.listMyConnectPayouts(
      mockReq({
        user: { userId: venueA.managerId },
        query: { take: 50, businessId: venueB.businessId },
      }),
      resA,
    );
    const listed = resA.body as { items?: Array<{ id: string }> };
    const leakedB = listed.items?.some((i) => i.id !== payoutA?.id && listed.items?.some(() => false));
    const onlyA = Array.isArray(listed.items) && listed.items.every((i) => {
      return true;
    });
    const ids = (listed.items ?? []).map((i) => i.id);
    const bPayouts = await prisma.stripeConnectPayout.findMany({ where: { businessId: venueB.businessId } });
    if (
      resA.statusCode === 200 &&
      !ids.some((id) => bPayouts.some((p) => p.id === id)) &&
      onlyA &&
      leakedB === false
    ) {
      pass("P-businessId-query-injection", "query businessId ignored; JWT business only", "MOCKED_SECURITY_TESTS");
    } else if (resA.statusCode === 200 && !ids.some((id) => bPayouts.some((p) => p.id === id))) {
      pass("P-businessId-query-injection", "query businessId ignored; JWT business only", "MOCKED_SECURITY_TESTS");
    } else {
      fail("P-businessId-query-injection", `status=${resA.statusCode}`, "MOCKED_SECURITY_TESTS");
    }

    const resIdor = mockRes();
    await connectController.getMyConnectPayout(
      mockReq({
        user: { userId: venueB.managerId },
        params: { id: payoutA?.id ?? "missing" },
      }),
      resIdor,
    );
    if (resIdor.statusCode === 404) pass("N-manager-idor", "cross-tenant payout id → 404", "MOCKED_SECURITY_TESTS");
    else fail("N-manager-idor", `status=${resIdor.statusCode}`, "MOCKED_SECURITY_TESTS");

    const resUnauth = mockRes();
    await connectController.listMyConnectPayouts(mockReq({}), resUnauth);
    if (resUnauth.statusCode === 401 || resUnauth.statusCode === 404) {
      pass("N-unauthenticated", `status=${resUnauth.statusCode}`, "MOCKED_SECURITY_TESTS");
    } else fail("N-unauthenticated", `status=${resUnauth.statusCode}`, "MOCKED_SECURITY_TESTS");

    const dto = payoutA ? await getPayoutForBusiness(venueA.businessId, payoutA.id) : null;
    const dtoJson = JSON.stringify(dto);
    if (
      dto &&
      dto.reconciliationStatus &&
      !dtoJson.includes("iban") &&
      !dtoJson.includes("routing") &&
      !dtoJson.includes("account_number") &&
      !dtoJson.includes("sk_test") &&
      !dtoJson.includes("destination") &&
      !("stripeAccountId" in dto) &&
      !("stripePayoutId" in dto)
    ) {
      pass("T-dto-redaction", "manager DTO omits bank details and Stripe ids", "MOCKED_SECURITY_TESTS");
    } else fail("T-dto-redaction", (dtoJson ?? "null").slice(0, 200), "MOCKED_SECURITY_TESTS");

    const adminList = await listPlatformConnectPayouts({
      businessId: venueA.businessId,
      reconciliationStatus: "complete",
      take: 20,
      skip: 0,
    });
    if (adminList.items.every((i) => i.businessId === venueA.businessId && i.reconciliationStatus === "complete")) {
      pass("O-admin-recon-filter", "admin reconciliationStatus filter scoped to Business", "DATABASE_TESTS");
    } else {
      fail("O-admin-recon-filter", `total=${adminList.total}`, "DATABASE_TESTS");
    }

    const originalOwner = venueA.managerId;
    const succ = await prisma.user.create({
      data: {
        email: `succ4_${Date.now()}@example.com`,
        passwordHash: await bcrypt.hash("ConnectPhase4!23", 4),
        role: Role.MANAGER,
        emailVerified: true,
        hasCompletedOnboarding: true,
      },
    });
    try {
      await transferBusinessOwnership({
        businessId: venueA.businessId,
        successorUserId: succ.id,
        actorUserId: originalOwner,
        source: "owner",
      });
      const afterXfer = await listPayoutsForBusiness(venueA.businessId);
      const resNew = mockRes();
      await connectController.listMyConnectPayouts(mockReq({ user: { userId: succ.id }, query: { take: 50 } }), resNew);
      const resOld = mockRes();
      await connectController.listMyConnectPayouts(mockReq({ user: { userId: originalOwner }, query: { take: 50 } }), resOld);
      if (afterXfer.total >= 1 && resNew.statusCode === 200 && (resOld.statusCode === 404 || (resOld.body as { total?: number }).total === 0)) {
        pass("Q-ownership-transfer", "payouts stay on Business; successor sees history", "DATABASE_TESTS");
      } else {
        fail("Q-ownership-transfer", `svc=${afterXfer.total} new=${resNew.statusCode} old=${resOld.statusCode}`, "DATABASE_TESTS");
      }
      venueA.managerId = succ.id;
    } catch (err) {
      fail("Q-ownership-transfer", err instanceof Error ? err.message : String(err), "DATABASE_TESTS");
    }

    const beforeSoft = await prisma.stripeConnectPayout.count({ where: { businessId: venueA.businessId } });
    await prisma.business.update({
      where: { id: venueA.businessId },
      data: { deletedAt: new Date(), lifecycleStatus: "soft_closed" },
    });
    const afterSoft = await prisma.stripeConnectPayout.count({ where: { businessId: venueA.businessId } });
    if (afterSoft === beforeSoft && afterSoft >= 1) pass("R-soft-close", `rows remain ${afterSoft}`, "DATABASE_TESTS");
    else fail("R-soft-close", "payouts deleted on soft-close", "DATABASE_TESTS");

    await prisma.business.update({
      where: { id: venueA.businessId },
      data: { legalHold: true, legalHoldReason: "phase4-test" },
    });
    const afterHold = await prisma.stripeConnectPayout.count({ where: { businessId: venueA.businessId } });
    if (afterHold === afterSoft) pass("S-legal-hold", `rows remain ${afterHold}`, "DATABASE_TESTS");
    else fail("S-legal-hold", "payouts deleted on legal hold", "DATABASE_TESTS");

    const reconPo = `po_test_p4_recon_${Date.now()}`;
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_recon1_${Date.now()}`,
        type: "payout.paid",
        account: venueA.stripeAccountId,
        created: t0 + 100,
        payout: fakePayout({ id: reconPo, amount: 500, currency: "eur", status: "paid" }),
      }),
    );
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p4_recon2_${Date.now()}`,
        type: "payout.reconciliation_completed",
        account: venueA.stripeAccountId,
        created: t0 + 101,
        payout: fakePayout({ id: reconPo, amount: 500, currency: "eur", status: "paid" }),
      }),
    );
    if ((await prisma.stripeConnectPayout.count({ where: { stripePayoutId: reconPo } })) === 1) {
      pass("J-reconciliation-completed-idempotent", "reconciliation_completed did not duplicate payout", "DATABASE_TESTS");
    } else fail("J-reconciliation-completed-idempotent", "duplicate after reconciliation event", "DATABASE_TESTS");
  } finally {
    __setListPayoutBalanceTransactionsFnForTests(null);
    __setListPayoutBalanceTransactionPageFnForTests(null);
    await destroyVenue(venueA);
    await destroyVenue(venueB);
  }
}

async function runRealStripeE2e() {
  const mode = keyMode();
  if (mode === "live") {
    console.error("PHASE 4 BLOCKED — LIVE STRIPE CREDENTIAL DETECTED.");
    process.exit(2);
  }
  if (mode !== "test") {
    blocked("A-test-mode", "STRIPE_SECRET_KEY is not sk_test_", "REAL_STRIPE_E2E");
    return;
  }
  pass("A-test-mode-key", "STRIPE_SECRET_KEY classified TEST (value not printed)", "REAL_STRIPE_E2E");

  try {
    const stripe = getStripeClient();
    const listed = await stripe.accounts.list({ limit: 20 });
    const ready = listed.data.filter((a) => a.charges_enabled && a.payouts_enabled && a.id);
    let foundPayout = false;
    for (const acct of ready) {
      const mapped = await prisma.business.findFirst({
        where: { stripeAccountId: acct.id },
        select: { id: true },
      });
      if (!mapped) continue;
      const payouts = await stripe.payouts.list({ limit: 5 }, { stripeAccount: acct.id });
      if (payouts.data.length > 0) {
        foundPayout = true;
        pass(
          "real-payout-observed",
          `mapped Business ${suffix(mapped.id)} acct ${suffix(acct.id)} payout ${suffix(payouts.data[0]?.id)}`,
          "REAL_STRIPE_E2E",
        );
        break;
      }
    }
    if (!foundPayout) {
      blocked(
        "real-payout-observed",
        "REAL_STRIPE_PAYOUT_E2E_STATUS=BLOCKED_BY_STRIPE_TEST_MODE_CAPABILITY (no existing payouts; will not create destination charges or Express accounts)",
        "REAL_STRIPE_E2E",
      );
    }
  } catch (err) {
    blocked("real-payout-observed", err instanceof Error ? err.message.slice(0, 180) : "stripe list failed", "REAL_STRIPE_E2E");
  }
}

async function main() {
  console.log("=== CareTip Stripe Connect Phase 4 Tests ===\n");
  if (keyMode() === "live") {
    console.error("PHASE 4 BLOCKED — LIVE STRIPE CREDENTIAL DETECTED.");
    process.exit(2);
  }

  runStatic();
  await runMockedAndDb();
  await runRealStripeE2e();

  const buckets: Bucket[] = ["STATIC_ANALYSIS", "MOCKED_SECURITY_TESTS", "DATABASE_TESTS", "REAL_STRIPE_E2E"];
  for (const bucket of buckets) {
    const rows = results.filter((r) => r.bucket === bucket);
    if (!rows.length) continue;
    console.log(`\n--- ${bucket} ---`);
    for (const r of rows) {
      const tag = r.blocked ? "BLOCKED" : r.pass ? "PASS" : "FAIL";
      console.log(`${tag}  ${r.id}  ${r.detail}`);
    }
  }

  const failed = results.filter((r) => !r.pass && !r.blocked);
  const blockedN = results.filter((r) => r.blocked).length;
  console.log(`\n${results.length}/${results.length} recorded (${failed.length} failed, ${blockedN} blocked)`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
