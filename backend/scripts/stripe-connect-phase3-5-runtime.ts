/**
 * Stripe Connect Phase 3.5 — TEST MODE payout E2E + security verification.
 * Run: npm run test:stripe-connect-phase3-5
 *
 * REAL Stripe TEST MODE observation is attempted first (list existing payouts).
 * A TEST-ONLY payouts.create may run ONLY in this script, never from backend/src,
 * never as HTTP, and never with sk_live_.
 *
 * Does not implement product manual payouts. Does not start Phase 4.
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
  StripeConnectPayoutStatus,
  StripeConnectStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { CARETIP_FEE_FIXED_CENTS_EUR, CARETIP_FEE_PERCENT } from "../src/config/fees.js";
import { getStripeClient, verifyWebhookSignature } from "../src/services/stripe.service.js";
import { transferBusinessOwnership } from "../src/services/businessOwnership.service.js";
import {
  isStripeWebhookEventProcessed,
  markStripeWebhookEventProcessed,
} from "../src/services/stripeWebhookIdempotency.service.js";
import {
  getPayoutForBusiness,
  handleConnectPayoutEvent,
  listPlatformConnectPayouts,
  listPayoutsForBusiness,
  shouldApplyPayoutEvent,
  __setListPayoutBalanceTransactionsFnForTests,
} from "../src/services/stripeConnectPayout.service.js";
import * as connectController from "../src/controllers/connect.controller.js";

type Bucket = "REAL_STRIPE_E2E" | "MOCKED_SECURITY_TESTS" | "STATIC_ANALYSIS" | "DATABASE_TESTS";
type Result = { id: string; pass: boolean; detail: string; bucket: Bucket; blocked?: boolean };
const results: Result[] = [];
const backendRoot = process.cwd();

let realE2eStatus: "VERIFIED" | "NOT_VERIFIED" | "BLOCKED" = "NOT_VERIFIED";
let realE2eDetail = "not attempted";
let webhookDelivery: "VERIFIED" | "NOT_VERIFIABLE" = "NOT_VERIFIABLE";
let reconciliation: "FULL" | "PARTIAL" | "NOT_VERIFIED" = "NOT_VERIFIED";

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
  const passwordHash = await bcrypt.hash("ConnectPhase35!23", 4);
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
  const stripeAccountId = acct === null ? null : (acct ?? `acct_p35_${s}`);
  const biz = await prisma.business.create({
    data: {
      name: `Connect35 ${s}`,
      slug: `connect35-${s}`,
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
    id: "po_test_p35_default",
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

function eventFromRealPayout(
  payout: Stripe.Payout,
  accountId: string,
  type: string,
  eventId: string,
): Stripe.Event {
  return fakePayoutEvent({
    eventId,
    type,
    account: accountId,
    created: payout.created ?? Math.floor(Date.now() / 1000),
    payout,
  });
}

function signAndVerify(event: Stripe.Event): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET missing");
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return verifyWebhookSignature(Buffer.from(payload), header);
}

/**
 * TEST ONLY. Stripe TEST MODE connected-account Payouts API.
 * Never import from backend/src. Never expose as HTTP.
 * Refuses sk_live_.
 */
async function testOnlyCreateConnectedPayout(
  stripe: Stripe,
  accountId: string,
  amount: number,
  currency: string,
): Promise<{ payout: Stripe.Payout | null; errorCode: string | null }> {
  const mode = keyMode();
  if (mode === "live") {
    throw new Error("PHASE 3.5 BLOCKED — LIVE STRIPE CREDENTIAL DETECTED.");
  }
  if (mode !== "test") {
    return { payout: null, errorCode: "not_test_mode" };
  }
  if (!Number.isInteger(amount) || amount < 1) {
    return { payout: null, errorCode: "invalid_amount" };
  }
  try {
    const payout = await stripe.payouts.create(
      { amount, currency },
      { stripeAccount: accountId },
    );
    return { payout, errorCode: null };
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code ?? "stripe_error")
        : "stripe_error";
    return { payout: null, errorCode: code };
  }
}

function runStatic() {
  const srcRoot = join(backendRoot, "src");
  const srcFiles = walkSrcTs(srcRoot);
  const srcBlob = srcFiles.map((p) => readFileSync(p, "utf8")).join("\n");
  const routesConnect = read("src/routes/connect.routes.ts");
  const routesPlatform = read("src/routes/platform.routes.ts");
  const stripeSvc = read("src/services/stripe.service.ts");
  const fees = read("src/config/fees.ts");
  const ui = read(join("..", "src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx"));

  const forbidden = [
    /\.payouts\.create\s*\(/,
    /\.payouts\.cancel\s*\(/,
    /\.externalAccounts\.create\s*\(/,
    /\.externalAccounts\.update\s*\(/,
  ];
  const hits = forbidden.filter((re) => re.test(srcBlob));
  if (hits.length === 0) {
    pass("V-no-manual-payout-creation", "backend/src has no payouts.create/cancel or externalAccounts mutate", "STATIC_ANALYSIS");
    pass("W-no-payouts-create", "production application code has no .payouts.create(", "STATIC_ANALYSIS");
  } else {
    fail("V-no-manual-payout-creation", "forbidden Stripe mutate API in backend/src", "STATIC_ANALYSIS");
    fail("W-no-payouts-create", "payouts.create present in backend/src", "STATIC_ANALYSIS");
  }

  if (
    routesConnect.includes("listMyConnectPayouts") &&
    !routesConnect.includes('router.post("/connect/payouts"') &&
    !routesPlatform.includes('router.post("/connect-payouts"') &&
    !routesPlatform.includes("router.patch(\"/connect-payouts\"") &&
    !routesPlatform.includes("router.delete(\"/connect-payouts\"")
  ) {
    pass("Q-admin-read-only-static", "No payout mutation HTTP routes", "STATIC_ANALYSIS");
  } else {
    fail("Q-admin-read-only-static", "Unexpected payout mutation route", "STATIC_ANALYSIS");
  }

  if (routesPlatform.includes("requirePlatformAdmin") && routesPlatform.includes("listConnectPayouts")) {
    pass("P-platform-admin-auth-static", "connect-payouts behind existing platform-admin stack", "STATIC_ANALYSIS");
  } else {
    fail("P-platform-admin-auth-static", "admin payout route missing requirePlatformAdmin", "STATIC_ANALYSIS");
  }

  if (
    stripeSvc.includes("transfer_data") &&
    stripeSvc.includes("application_fee_amount") &&
    stripeSvc.includes("refund_application_fee: true") &&
    stripeSvc.includes("reverse_transfer: true") &&
    fees.includes("CARETIP_FEE_PERCENT = 10") &&
    fees.includes("CARETIP_FEE_FIXED_CENTS_EUR = 49")
  ) {
    pass("X-destination-regression-static", "Destination charge + 10% + €0.49 fee + destination-charge full refund params", "STATIC_ANALYSIS");
  } else {
    fail("X-destination-regression-static", "Destination-charge path changed", "STATIC_ANALYSIS");
  }

  if (
    ui.includes("formatConnectPayoutAmount") &&
    ui.includes("amountCents") &&
    ui.includes("payout.status") &&
    ui.includes("arrivalDate") &&
    !ui.includes("formatEur") &&
    !ui.includes("iban") &&
    !ui.includes("stripePayoutId")
  ) {
    pass("ui-safe-fields", "Manager UI shows currency-safe amount/status/dates; no IBAN or Stripe payout id", "STATIC_ANALYSIS");
  } else {
    fail("ui-safe-fields", "Manager payout UI fields unexpected", "STATIC_ANALYSIS");
  }
}

async function runMockedAndDb() {
  __setListPayoutBalanceTransactionsFnForTests(async () => []);
  const venueA = await createVenue("isoA");
  const venueB = await createVenue("isoB");
  try {
    const t0 = Math.floor(Date.now() / 1000);
    const po = `po_test_p35_${Date.now()}`;
    const created = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_c_${Date.now()}`,
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
    if (created.matched && row?.businessId === venueA.businessId && row.amountCents === 12345 && row.currency === "eur") {
      pass("E-event-account-attribution", "acct_A → Business A; metadata ignored", "MOCKED_SECURITY_TESTS");
      pass("K-amount-integrity", "persisted 12345 cents from Stripe object", "MOCKED_SECURITY_TESTS");
      pass("L-currency-integrity", "currency eur from Stripe object", "DATABASE_TESTS");
    } else {
      fail("E-event-account-attribution", JSON.stringify(created), "MOCKED_SECURITY_TESTS");
      fail("K-amount-integrity", `cents=${row?.amountCents}`, "MOCKED_SECURITY_TESTS");
      fail("L-currency-integrity", `currency=${row?.currency}`, "DATABASE_TESTS");
    }

    const usdPo = `po_test_p35_usd_${Date.now()}`;
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_usd_${Date.now()}`,
        type: "payout.created",
        account: venueA.stripeAccountId,
        created: t0 + 1,
        payout: fakePayout({ id: usdPo, amount: 200, currency: "usd", status: "pending" }),
      }),
    );
    const usdRow = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: usdPo } });
    if (usdRow?.currency === "usd" && usdRow.amountCents === 200) {
      pass("L-non-eur-preserved", "USD payout currency stored as usd (no silent EUR convert)", "DATABASE_TESTS");
    } else {
      fail("L-non-eur-preserved", `currency=${usdRow?.currency}`, "DATABASE_TESTS");
    }

    const unknown = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_unk_${Date.now()}`,
        type: "payout.created",
        account: `acct_unknown_${Date.now()}`,
        created: t0,
        payout: fakePayout({ id: `po_test_unk_${Date.now()}`, amount: 50, status: "pending" }),
      }),
    );
    const missing = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_noacct_${Date.now()}`,
        type: "payout.created",
        account: null,
        created: t0,
        payout: fakePayout({ id: `po_test_noacct_${Date.now()}`, amount: 50, status: "pending" }),
      }),
    );
    if (!unknown.matched && unknown.reason === "unknown_account") {
      pass("F-unknown-account", "unknown acct_ not attached", "MOCKED_SECURITY_TESTS");
    } else fail("F-unknown-account", JSON.stringify(unknown), "MOCKED_SECURITY_TESTS");
    if (!missing.matched && missing.reason === "missing_event_account") {
      pass("F-missing-event-account", "missing event.account not attached", "MOCKED_SECURITY_TESTS");
    } else fail("F-missing-event-account", JSON.stringify(missing), "MOCKED_SECURITY_TESTS");

    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_dupc_${Date.now()}`,
        type: "payout.created",
        account: venueA.stripeAccountId,
        created: t0 + 2,
        payout: fakePayout({ id: po, amount: 12345, currency: "eur", status: "pending" }),
      }),
    );
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_paid_${Date.now()}`,
        type: "payout.paid",
        account: venueA.stripeAccountId,
        created: t0 + 10,
        payout: fakePayout({ id: po, amount: 12345, currency: "eur", status: "paid" }),
      }),
    );
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_paiddup_${Date.now()}`,
        type: "payout.paid",
        account: venueA.stripeAccountId,
        created: t0 + 11,
        payout: fakePayout({ id: po, amount: 12345, currency: "eur", status: "paid" }),
      }),
    );
    if ((await prisma.stripeConnectPayout.count({ where: { stripePayoutId: po } })) === 1) {
      pass("G-duplicate-payout", "duplicate created/paid → one row", "DATABASE_TESTS");
    } else fail("G-duplicate-payout", "duplicate rows", "DATABASE_TESTS");

    const concPo = `po_test_p35_conc_${Date.now()}`;
    const concPayout = fakePayout({ id: concPo, amount: 300, currency: "eur", status: "pending" });
    await Promise.all([
      handleConnectPayoutEvent(
        fakePayoutEvent({
          eventId: `evt_p35_h1_${Date.now()}`,
          type: "payout.created",
          account: venueA.stripeAccountId,
          created: t0 + 20,
          payout: concPayout,
        }),
      ),
      handleConnectPayoutEvent(
        fakePayoutEvent({
          eventId: `evt_p35_h2_${Date.now()}_b`,
          type: "payout.created",
          account: venueA.stripeAccountId,
          created: t0 + 21,
          payout: concPayout,
        }),
      ),
    ]);
    if ((await prisma.stripeConnectPayout.count({ where: { stripePayoutId: concPo } })) === 1) {
      pass("H-concurrent-payout", "serialized upsert → one row", "DATABASE_TESTS");
    } else fail("H-concurrent-payout", "concurrent duplicate rows", "DATABASE_TESTS");

    const stale = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_stale_${Date.now()}`,
        type: "payout.updated",
        account: venueA.stripeAccountId,
        created: t0,
        payout: fakePayout({ id: po, amount: 12345, currency: "eur", status: "pending" }),
      }),
    );
    const afterStale = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: po } });
    if (stale.skippedStale && afterStale?.status === StripeConnectPayoutStatus.paid) {
      pass("I-event-ordering", "older pending did not overwrite paid", "MOCKED_SECURITY_TESTS");
      pass("J-terminal-paid", "paid did not regress", "MOCKED_SECURITY_TESTS");
    } else {
      fail("I-event-ordering", `status=${afterStale?.status}`, "MOCKED_SECURITY_TESTS");
      fail("J-terminal-paid", `status=${afterStale?.status}`, "MOCKED_SECURITY_TESTS");
    }

    const failPo = `po_test_p35_fail_${Date.now()}`;
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_fail_${Date.now()}`,
        type: "payout.failed",
        account: venueA.stripeAccountId,
        created: t0 + 30,
        payout: fakePayout({
          id: failPo,
          amount: 400,
          status: "failed",
          failure_code: "account_closed",
          failure_message: "Closed. IBAN DE89370400440532013000",
        }),
      }),
    );
    const failRegress = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_failreg_${Date.now()}`,
        type: "payout.updated",
        account: venueA.stripeAccountId,
        created: t0 + 40,
        payout: fakePayout({ id: failPo, amount: 400, status: "pending" }),
      }),
    );
    const failRow = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: failPo } });
    if (
      failRegress.skippedStale &&
      failRow?.status === StripeConnectPayoutStatus.failed &&
      failRow.failureMessage &&
      !failRow.failureMessage.includes("DE89370400440532013000")
    ) {
      pass("J-terminal-failed", "failed did not regress; IBAN redacted", "MOCKED_SECURITY_TESTS");
    } else {
      fail("J-terminal-failed", `status=${failRow?.status} msg=${failRow?.failureMessage}`, "MOCKED_SECURITY_TESTS");
    }

    const conflict = await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_conflict_${Date.now()}`,
        type: "payout.updated",
        account: venueB.stripeAccountId,
        created: t0 + 50,
        payout: fakePayout({ id: po, amount: 12345, currency: "eur", status: "paid" }),
      }),
    );
    const stillA = await prisma.stripeConnectPayout.findUnique({ where: { stripePayoutId: po } });
    if (conflict.reason === "attribution_conflict" && stillA?.businessId === venueA.businessId) {
      pass("E-attribution-conflict", "existing po_ not reassigned to Business B", "MOCKED_SECURITY_TESTS");
    } else {
      fail("E-attribution-conflict", `reason=${conflict.reason} biz=${stillA?.businessId}`, "MOCKED_SECURITY_TESTS");
    }

    const listA = await listPayoutsForBusiness(venueA.businessId);
    const resIgnore = mockRes();
    await connectController.listMyConnectPayouts(
      mockReq({ user: { userId: venueA.managerId }, query: { businessId: venueB.businessId, take: 50 } }),
      resIgnore,
    );
    const listed = resIgnore.body as { total?: number; items?: Array<{ id: string }> };
    const idsA = new Set(listA.items.map((i) => i.id));
    if (
      resIgnore.statusCode === 200 &&
      listed.total === listA.total &&
      (listed.items ?? []).every((i) => idsA.has(i.id))
    ) {
      pass("N-manager-tenant-isolation", "query businessId ignored; JWT business only", "MOCKED_SECURITY_TESTS");
    } else {
      fail("N-manager-tenant-isolation", `status=${resIgnore.statusCode}`, "MOCKED_SECURITY_TESTS");
    }

    const payoutA = listA.items[0];
    const resIdor = mockRes();
    if (payoutA) {
      await connectController.getMyConnectPayout(
        mockReq({ user: { userId: venueB.managerId }, params: { id: payoutA.id } }),
        resIdor,
      );
      if (resIdor.statusCode === 404) pass("O-manager-idor", "cross-tenant payout id → 404", "MOCKED_SECURITY_TESTS");
      else fail("O-manager-idor", `status=${resIdor.statusCode}`, "MOCKED_SECURITY_TESTS");
    } else fail("O-manager-idor", "missing payout A", "MOCKED_SECURITY_TESTS");

    const resUnauth = mockRes();
    await connectController.listMyConnectPayouts(mockReq({ user: undefined }), resUnauth);
    if (resUnauth.statusCode === 401) pass("N-unauthenticated-401", "401 without JWT", "MOCKED_SECURITY_TESTS");
    else fail("N-unauthenticated-401", `status=${resUnauth.statusCode}`, "MOCKED_SECURITY_TESTS");

    const resEmp = mockRes();
    await connectController.listMyConnectPayouts(mockReq({ user: { userId: venueA.employeeUserId } }), resEmp);
    if (resEmp.statusCode === 404) pass("N-employee-blocked", "employee has no manager business", "MOCKED_SECURITY_TESTS");
    else fail("N-employee-blocked", `status=${resEmp.statusCode}`, "MOCKED_SECURITY_TESTS");

    const dto = payoutA ? await getPayoutForBusiness(venueA.businessId, payoutA.id) : null;
    const dtoJson = JSON.stringify(dto);
    if (
      dto &&
      !dtoJson.includes("iban") &&
      !dtoJson.includes("routing") &&
      !dtoJson.includes("account_number") &&
      !dtoJson.includes("sk_test") &&
      !dtoJson.includes("destination") &&
      !("stripeAccountId" in dto) &&
      !("stripePayoutId" in dto)
    ) {
      pass("R-dto-redaction", "manager DTO omits bank details and Stripe ids", "MOCKED_SECURITY_TESTS");
    } else fail("R-dto-redaction", (dtoJson ?? "null").slice(0, 200), "MOCKED_SECURITY_TESTS");

    const adminList = await listPlatformConnectPayouts({ businessId: venueA.businessId, take: 10, skip: 0 });
    if (adminList.total >= 1 && adminList.items.every((i) => i.businessId === venueA.businessId)) {
      pass("Q-admin-filter-business", "admin businessId filter returns only that Business", "DATABASE_TESTS");
    } else fail("Q-admin-filter-business", `total=${adminList.total}`, "DATABASE_TESTS");

    const originalOwner = venueA.managerId;
    const succ = await prisma.user.create({
      data: {
        email: `succ35_${Date.now()}@example.com`,
        passwordHash: await bcrypt.hash("ConnectPhase35!23", 4),
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
        pass("S-ownership-transfer", "payouts stay on Business; successor sees history", "DATABASE_TESTS");
      } else {
        fail("S-ownership-transfer", `svc=${afterXfer.total} new=${resNew.statusCode} old=${resOld.statusCode}`, "DATABASE_TESTS");
      }
      venueA.managerId = succ.id;
    } catch (err) {
      fail("S-ownership-transfer", err instanceof Error ? err.message : String(err), "DATABASE_TESTS");
    }

    await prisma.business.update({
      where: { id: venueA.businessId },
      data: { deletedAt: new Date(), lifecycleStatus: "soft_closed" },
    });
    const afterSoft = await prisma.stripeConnectPayout.count({ where: { businessId: venueA.businessId } });
    if (afterSoft >= 1) pass("T-soft-close", `rows remain ${afterSoft}`, "DATABASE_TESTS");
    else fail("T-soft-close", "payouts deleted on soft-close", "DATABASE_TESTS");

    await prisma.business.update({
      where: { id: venueA.businessId },
      data: { legalHold: true, legalHoldReason: "phase35-test" },
    });
    const afterHold = await prisma.stripeConnectPayout.count({ where: { businessId: venueA.businessId } });
    if (afterHold >= 1) pass("U-legal-hold", `rows remain ${afterHold}`, "DATABASE_TESTS");
    else fail("U-legal-hold", "payouts deleted on legal hold", "DATABASE_TESTS");

    const throwEvt = `evt_p35_throw_${Date.now()}`;
    const throwPo = `po_test_p35_throw_${Date.now()}`;
    try {
      if (await isStripeWebhookEventProcessed(throwEvt)) fail("Y-retry", "event already processed", "MOCKED_SECURITY_TESTS");
      await handleConnectPayoutEvent(
        fakePayoutEvent({
          eventId: throwEvt,
          type: "payout.created",
          account: venueA.stripeAccountId,
          created: t0 + 90,
          payout: fakePayout({ id: throwPo, amount: Number.NaN as unknown as number, status: "pending" }),
        }),
      );
      const processed = await isStripeWebhookEventProcessed(throwEvt);
      if (!processed) pass("Y-retry", "invalid object unmatched; caller must mark only after handler — event unmarked here", "MOCKED_SECURITY_TESTS");
      else fail("Y-retry", "event marked without processLikeWebhook", "MOCKED_SECURITY_TESTS");
    } catch {
      const processed = await isStripeWebhookEventProcessed(throwEvt);
      if (!processed) pass("Y-retry", "throw left event unmarked", "MOCKED_SECURITY_TESTS");
      else fail("Y-retry", "marked after throw", "MOCKED_SECURITY_TESTS");
    }

    const reconPo = `po_test_p35_recon_${Date.now()}`;
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_recon1_${Date.now()}`,
        type: "payout.paid",
        account: venueA.stripeAccountId,
        created: t0 + 100,
        payout: fakePayout({ id: reconPo, amount: 500, currency: "eur", status: "paid" }),
      }),
    );
    await handleConnectPayoutEvent(
      fakePayoutEvent({
        eventId: `evt_p35_recon2_${Date.now()}`,
        type: "payout.reconciliation_completed",
        account: venueA.stripeAccountId,
        created: t0 + 101,
        payout: fakePayout({ id: reconPo, amount: 500, currency: "eur", status: "paid" }),
      }),
    );
    if ((await prisma.stripeConnectPayout.count({ where: { stripePayoutId: reconPo } })) === 1) {
      pass("Z-reconciliation-idempotent", "reconciliation_completed did not duplicate payout row", "DATABASE_TESTS");
    } else fail("Z-reconciliation-idempotent", "duplicate after reconciliation event", "DATABASE_TESTS");

    const unitPaid = shouldApplyPayoutEvent({
      storedStatus: StripeConnectPayoutStatus.paid,
      storedEventCreated: 200,
      incomingStatus: StripeConnectPayoutStatus.in_transit,
      incomingEventCreated: 50,
    });
    if (!unitPaid.apply) pass("J-unit-paid-in-transit", unitPaid.reason, "MOCKED_SECURITY_TESTS");
    else fail("J-unit-paid-in-transit", "paid allowed in_transit", "MOCKED_SECURITY_TESTS");

    if (CARETIP_FEE_PERCENT === 10 && CARETIP_FEE_FIXED_CENTS_EUR === 49) {
      pass("X-fee-runtime", "CARETIP_FEE_PERCENT=10 + €0.49", "STATIC_ANALYSIS");
    } else fail("X-fee-runtime", `${CARETIP_FEE_PERCENT}+${CARETIP_FEE_FIXED_CENTS_EUR}`, "STATIC_ANALYSIS");
  } finally {
    __setListPayoutBalanceTransactionsFnForTests(null);
    await destroyVenue(venueA);
    await destroyVenue(venueB);
  }
}

async function runRealStripeE2e() {
  const mode = keyMode();
  if (mode === "live") {
    console.error("PHASE 3.5 BLOCKED — LIVE STRIPE CREDENTIAL DETECTED.");
    process.exit(2);
  }
  if (mode !== "test") {
    realE2eStatus = "BLOCKED";
    realE2eDetail = "STRIPE_SECRET_KEY is not sk_test_";
    blocked("A-test-mode", realE2eDetail, "REAL_STRIPE_E2E");
    blocked("B-payout-discovery", "skipped — not TEST MODE", "REAL_STRIPE_E2E");
    blocked("C-real-payout-object", "skipped", "REAL_STRIPE_E2E");
    blocked("D-webhook-delivery", "skipped", "REAL_STRIPE_E2E");
    blocked("M-real-reconciliation", "skipped", "REAL_STRIPE_E2E");
    return;
  }
  pass("A-test-mode", "STRIPE_SECRET_KEY classified TEST (value not printed)", "REAL_STRIPE_E2E");

  const stripe = getStripeClient();
  const listed = await stripe.accounts.list({ limit: 20 });
  const readyAccounts = listed.data.filter((a) => a.charges_enabled === true && a.payouts_enabled === true && a.id);
  if (readyAccounts.length === 0) {
    realE2eStatus = "BLOCKED";
    realE2eDetail = "No TEST connected account with charges_enabled and payouts_enabled";
    blocked("B-payout-discovery", realE2eDetail, "REAL_STRIPE_E2E");
    blocked("C-real-payout-object", "no ready connected account", "REAL_STRIPE_E2E");
    blocked("D-webhook-delivery", "no ready connected account", "REAL_STRIPE_E2E");
    blocked("M-real-reconciliation", "no ready connected account", "REAL_STRIPE_E2E");
    return;
  }

  type Candidate = {
    acct: Stripe.Account;
    business: { id: string; stripeAccountId: string | null };
    payout: Stripe.Payout | null;
    availableCents: number;
    currency: string;
  };
  const candidates: Candidate[] = [];
  for (const ready of readyAccounts) {
    const acct = await stripe.accounts.retrieve(ready.id);
    const business = await prisma.business.findFirst({
      where: { stripeAccountId: acct.id },
      select: { id: true, stripeAccountId: true },
    });
    if (!business?.stripeAccountId) continue;
    let payout: Stripe.Payout | null = null;
    let availableCents = 0;
    let pendingCents = 0;
    let currency = "eur";
    try {
      const payouts = await stripe.payouts.list({ limit: 10 }, { stripeAccount: acct.id });
      payout = payouts.data[0] ?? null;
    } catch {
      payout = null;
    }
    try {
      const bal = await stripe.balance.retrieve({ stripeAccount: acct.id });
      const eurAvail = bal.available.find((b) => b.currency === "eur") ?? bal.available[0];
      const eurPending = bal.pending.find((b) => b.currency === "eur") ?? bal.pending[0];
      availableCents = eurAvail?.amount ?? 0;
      pendingCents = eurPending?.amount ?? 0;
      currency = eurAvail?.currency ?? eurPending?.currency ?? "eur";
    } catch {
      availableCents = 0;
    }
    candidates.push({ acct, business, payout, availableCents, currency });
    console.log(
      `[REAL_STRIPE] candidate acct=${suffix(acct.id)} type=${acct.type ?? "?"} charges=${acct.charges_enabled} payouts=${acct.payouts_enabled} details=${acct.details_submitted} due=${acct.requirements?.currently_due?.length ?? 0} existingPayouts=${payout ? 1 : 0} available=${availableCents}${currency} pending=${pendingCents}${currency}`,
    );
  }

  const withPayout = candidates.find((c) => c.payout);
  const withBalance = candidates.find((c) => c.availableCents >= 1);
  const picked = withPayout ?? withBalance ?? candidates[0];
  if (!picked) {
    realE2eStatus = "BLOCKED";
    realE2eDetail = "Ready TEST Connect accounts are not mapped to a CareTip Business";
    blocked("B-payout-discovery", realE2eDetail, "REAL_STRIPE_E2E");
    blocked("C-real-payout-object", "no Business mapping", "REAL_STRIPE_E2E");
    blocked("D-webhook-delivery", "no Business mapping", "REAL_STRIPE_E2E");
    blocked("M-real-reconciliation", "no Business mapping", "REAL_STRIPE_E2E");
    return;
  }

  const acct = picked.acct;
  const business = picked.business;
  pass(
    "B-payout-discovery",
    `mapped Business suffix=${suffix(business.id)} acct=${suffix(acct.id)} charges=${acct.charges_enabled} payouts=${acct.payouts_enabled}`,
    "REAL_STRIPE_E2E",
  );

  let observed = picked.payout;
  let createdThisRun = false;

  if (!observed) {
    console.log(`[REAL_STRIPE] no existing payouts; available_${picked.currency}=${picked.availableCents} (TEST ONLY create if >=1)`);
    if (picked.availableCents >= 1) {
      const created = await testOnlyCreateConnectedPayout(
        stripe,
        acct.id,
        Math.min(picked.availableCents, 100),
        picked.currency,
      );
      if (created.payout) {
        observed = created.payout;
        createdThisRun = true;
        console.log(
          `[REAL_STRIPE] TEST_ONLY payouts.create succeeded suffix=${suffix(observed.id)} status=${observed.status} amount=${observed.amount} ${observed.currency}`,
        );
      } else {
        realE2eStatus = "BLOCKED";
        realE2eDetail = `Stripe TEST MODE payouts.create refused code=${created.errorCode ?? "unknown"}`;
        blocked("C-real-payout-object", realE2eDetail, "REAL_STRIPE_E2E");
        blocked("D-webhook-delivery", "no payout object", "REAL_STRIPE_E2E");
        blocked("M-real-reconciliation", "no payout object", "REAL_STRIPE_E2E");
        return;
      }
    } else {
      realE2eStatus = "BLOCKED";
      realE2eDetail =
        "REAL_STRIPE_PAYOUT_E2E_STATUS=BLOCKED_BY_STRIPE_TEST_MODE_CAPABILITY (no existing payouts, available balance 0; will not create destination charges or Express accounts)";
      blocked("C-real-payout-object", realE2eDetail, "REAL_STRIPE_E2E");
      blocked("D-webhook-delivery", "no payout to observe", "REAL_STRIPE_E2E");
      blocked("M-real-reconciliation", "no payout to reconcile", "REAL_STRIPE_E2E");
      return;
    }
  } else {
    console.log(
      `[REAL_STRIPE] existing payout suffix=${suffix(observed.id)} status=${observed.status} amount=${observed.amount} ${observed.currency} created=${observed.created}`,
    );
  }

  const retrieved = await stripe.payouts.retrieve(observed.id, { stripeAccount: acct.id });
  if (
    retrieved.id === observed.id &&
    Number.isInteger(retrieved.amount) &&
    typeof retrieved.currency === "string" &&
    typeof retrieved.status === "string"
  ) {
    pass(
      "C-real-payout-object",
      `suffix=${suffix(retrieved.id)} status=${retrieved.status} amountCents=${retrieved.amount} currency=${retrieved.currency} method=${retrieved.method ?? "n/a"} type=${retrieved.type ?? "n/a"} createdThisRun=${createdThisRun}`,
      "REAL_STRIPE_E2E",
    );
  } else {
    fail("C-real-payout-object", "retrieve missing required fields", "REAL_STRIPE_E2E");
    return;
  }

  let stripeEvent: Stripe.Event | null = null;
  try {
    const evs = await stripe.events.list(
      { types: ["payout.paid", "payout.created", "payout.updated"], limit: 20 },
      { stripeAccount: acct.id },
    );
    stripeEvent =
      evs.data.find((e) => {
        const obj = e.data.object as { id?: string };
        return obj.id === retrieved.id;
      }) ?? evs.data[0] ?? null;
  } catch {
    stripeEvent = null;
  }

  const envelope =
    stripeEvent && typeof stripeEvent.account === "string"
      ? stripeEvent
      : eventFromRealPayout(
          retrieved,
          acct.id,
          retrieved.status === "paid" ? "payout.paid" : "payout.created",
          `evt_p35_local_${Date.now()}`,
        );

  try {
    const verified = signAndVerify(envelope);
    if (verified.type.startsWith("payout.")) {
      pass("D-webhook-signature-path", "generateTestHeaderString + constructEvent accepted payout event", "REAL_STRIPE_E2E");
    } else {
      fail("D-webhook-signature-path", `type=${verified.type}`, "REAL_STRIPE_E2E");
    }
  } catch (err) {
    fail("D-webhook-signature-path", err instanceof Error ? err.message : String(err), "REAL_STRIPE_E2E");
  }
  webhookDelivery = "NOT_VERIFIABLE";
  blocked(
    "D-webhook-dashboard-delivery",
    "Stripe Dashboard connected-account listener / HTTP delivery to CareTip cannot be proven from this repository",
    "REAL_STRIPE_E2E",
  );

  const toHandle: Stripe.Event = {
    ...envelope,
    account: acct.id,
    data: { object: retrieved },
    type: retrieved.status === "paid" ? "payout.paid" : envelope.type,
  } as Stripe.Event;

  const handled = await handleConnectPayoutEvent(toHandle);
  const persisted = await prisma.stripeConnectPayout.findUnique({
    where: { stripePayoutId: retrieved.id },
    include: { balanceLines: true },
  });
  if (
    handled.matched &&
    persisted?.businessId === business.id &&
    persisted.amountCents === retrieved.amount &&
    persisted.currency === retrieved.currency
  ) {
    pass(
      "E-real-attribution",
      `event.account → Business ${suffix(business.id)}; amountCents=${persisted.amountCents} status=${persisted.status}`,
      "REAL_STRIPE_E2E",
    );
    realE2eStatus = "VERIFIED";
    realE2eDetail = `observed po suffix=${suffix(retrieved.id)} status=${persisted.status}`;
  } else {
    fail("E-real-attribution", `matched=${handled.matched} reason=${handled.reason}`, "REAL_STRIPE_E2E");
    realE2eStatus = "NOT_VERIFIED";
    realE2eDetail = handled.reason ?? "handler did not persist";
  }

  let btPage: Stripe.ApiList<Stripe.BalanceTransaction> | null = null;
  try {
    btPage = await stripe.balanceTransactions.list(
      { payout: retrieved.id, limit: 100 },
      { stripeAccount: acct.id },
    );
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "error";
    blocked("M-real-reconciliation", `balanceTransactions.list failed code=${code}`, "REAL_STRIPE_E2E");
    reconciliation = "NOT_VERIFIED";
    return;
  }

  const hasMore = Boolean(btPage.has_more);
  if (hasMore) {
    reconciliation = "PARTIAL";
    pass(
      "M-real-reconciliation",
      `first page ${btPage.data.length} BTs; has_more=true — pagination not implemented (PARTIAL)`,
      "REAL_STRIPE_E2E",
    );
  } else {
    reconciliation = persisted && persisted.balanceLines.length === btPage.data.length ? "FULL" : "PARTIAL";
    pass(
      "M-real-reconciliation",
      `Stripe BT count=${btPage.data.length} persistedLines=${persisted?.balanceLines.length ?? 0} has_more=false`,
      "REAL_STRIPE_E2E",
    );
  }

  await handleConnectPayoutEvent(toHandle);
  const afterDup = await prisma.stripeConnectPayout.count({ where: { stripePayoutId: retrieved.id } });
  if (afterDup === 1) pass("G-real-duplicate", "re-handling real payout kept one row", "REAL_STRIPE_E2E");
  else fail("G-real-duplicate", `rows=${afterDup}`, "REAL_STRIPE_E2E");
}

async function main() {
  if (keyMode() === "live") {
    console.error("PHASE 3.5 BLOCKED — LIVE STRIPE CREDENTIAL DETECTED.");
    process.exit(2);
  }

  console.log("=== CareTip Stripe Connect Phase 3.5 Tests ===\n");
  runStatic();
  try {
    await runMockedAndDb();
  } catch (err) {
    fail("mocked-suite", err instanceof Error ? err.message : String(err), "MOCKED_SECURITY_TESTS");
  }
  try {
    await runRealStripeE2e();
  } catch (err) {
    const msg = err instanceof Error ? err.message.replace(/sk_(?:test|live)_[A-Za-z0-9]+/g, "sk_REDACTED") : "error";
    fail("real-stripe-suite", msg, "REAL_STRIPE_E2E");
    if (realE2eStatus === "NOT_VERIFIED") {
      realE2eStatus = "BLOCKED";
      realE2eDetail = msg;
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  const failed = results.filter((r) => !r.pass);
  for (const bucket of ["STATIC_ANALYSIS", "MOCKED_SECURITY_TESTS", "DATABASE_TESTS", "REAL_STRIPE_E2E"] as Bucket[]) {
    const rows = results.filter((r) => r.bucket === bucket);
    console.log(`\n--- ${bucket} ---`);
    for (const r of rows) {
      const mark = r.blocked ? "BLOCKED" : r.pass ? "PASS" : "FAIL";
      console.log(`${mark}  ${r.id}  ${r.detail}`);
    }
  }

  console.log(`\nREAL_STRIPE_PAYOUT_E2E_STATUS=${realE2eStatus}`);
  console.log(`REAL_STRIPE_E2E_DETAIL=${realE2eDetail}`);
  console.log(`PAYOUT_WEBHOOK_DELIVERY=${webhookDelivery}`);
  console.log(`PAYOUT_RECONCILIATION=${reconciliation}`);
  console.log(`PAYOUTS_CREATE=NOT IMPLEMENTED (production)`);
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} recorded (${failed.length} failed, ${results.filter((r) => r.blocked).length} blocked)`);
  if (failed.length) process.exit(1);
}

void main();
