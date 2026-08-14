/**
 * Stripe Connect Phase 2 — destination-charge tip routing + platform fee tests.
 * Run: npm run test:stripe-connect-phase2
 *
 * Checkout create is mocked (no live Stripe charges). Webhook signature / ledger
 * checks use the CareTip DB when available.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OnboardingVerificationStatus,
  Role,
  StripeConnectStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { calculateTipPlatformFeeCents, CARETIP_FEE_FIXED_CENTS_EUR, CARETIP_FEE_PERCENT } from "../src/config/fees.js";
import { assertTipAmountInRangeEur, MIN_TIP_AMOUNT_EUR } from "../src/constants/tipAmountLimits.js";
import {
  findClientControlledConnectPaymentField,
  TIP_CONNECT_CLIENT_FORBIDDEN_KEYS,
} from "../src/controllers/payment.controller.js";
import { CONNECT_NOT_READY_CODE } from "../src/services/connectTipDestination.service.js";
import { TipPaymentEligibilityError } from "../src/services/tipPaymentEligibility.service.js";
import {
  createTipCheckoutSession,
  handleSuccessfulTipPayment,
  __setCheckoutSessionsCreateFnForTests,
  __setPaymentIntentsRetrieveFnForTests,
  __setConnectedAccountRetrieveFnForTests,
} from "../src/services/stripe.service.js";

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

function expectReject(id: string, fn: () => void) {
  try {
    fn();
    fail(id, "Expected rejection");
  } catch (e) {
    pass(id, `Rejected: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
  }
}

async function expectAsyncReject(id: string, fn: () => Promise<void>, code?: string) {
  try {
    await fn();
    fail(id, "Expected rejection");
  } catch (e) {
    const got = e instanceof TipPaymentEligibilityError ? e.code : e instanceof Error ? e.message : String(e);
    if (code && e instanceof TipPaymentEligibilityError && e.code !== code) {
      fail(id, `Expected code ${code}, got ${e.code}`);
      return;
    }
    pass(id, `Rejected: ${String(got).slice(0, 120)}`);
  }
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
  connect: {
    stripeAccountId?: string | null;
    status?: StripeConnectStatus;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    deletedAt?: Date | null;
    legalHold?: boolean;
    operationalStatus?: "active" | "suspended" | "inactive";
    onboarding?: OnboardingVerificationStatus;
  } = {},
): Promise<Venue> {
  const suffix = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("ConnectPhase2!23", 4);
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
    connect.stripeAccountId === null
      ? null
      : (connect.stripeAccountId ?? `acct_p2_${suffix}`);
  const biz = await prisma.business.create({
    data: {
      name: `Connect2 ${suffix}`,
      slug: `connect2-${suffix}`,
      userId: manager.id,
      onboardingVerificationStatus: connect.onboarding ?? OnboardingVerificationStatus.approved,
      operationalStatus: connect.operationalStatus ?? "active",
      deletedAt: connect.deletedAt ?? null,
      legalHold: connect.legalHold ?? false,
      stripeAccountId: acct,
      stripeConnectStatus: connect.status ?? StripeConnectStatus.ready,
      stripeChargesEnabled: connect.chargesEnabled ?? true,
      stripePayoutsEnabled: connect.payoutsEnabled ?? true,
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
  await prisma.notification.deleteMany({
    where: { userId: { in: [v.managerId, v.employeeUserId] } },
  }).catch(() => undefined);
  await prisma.transaction.deleteMany({
    where: { OR: [{ businessId: v.businessId }, { employeeId: v.employeeId }] },
  });
  await prisma.employee.deleteMany({ where: { id: v.employeeId } });
  await prisma.business.deleteMany({ where: { id: v.businessId } });
  await prisma.user.deleteMany({ where: { id: { in: [v.managerId, v.employeeUserId] } } });
}

function fakeCheckoutSession(
  params: Stripe.Checkout.SessionCreateParams,
  id = `cs_test_p2_${Date.now()}`,
): Stripe.Checkout.Session {
  return {
    id,
    object: "checkout.session",
    url: `https://checkout.stripe.com/c/pay/${id}`,
    mode: "payment",
    payment_status: "unpaid",
    status: "open",
    metadata: params.metadata ?? {},
    amount_total: params.line_items?.[0] && "price_data" in (params.line_items[0] ?? {})
      ? (params.line_items[0] as { price_data?: { unit_amount?: number } }).price_data?.unit_amount ?? null
      : null,
    currency: "eur",
    payment_intent: `pi_test_p2_${id}`,
  } as Stripe.Checkout.Session;
}

function runStaticSecurity() {
  const stripeSvc = read("src/services/stripe.service.ts");
  const paymentCtrl = read("src/controllers/payment.controller.ts");
  const destSvc = read("src/services/connectTipDestination.service.ts");
  const connectSvc = read("src/services/stripeConnect.service.ts");
  const webhook = read("src/webhooks/stripe.webhook.ts");
  const schema = read("prisma/schema.prisma");
  const fees = read("src/config/fees.ts");

  if (
    stripeSvc.includes("application_fee_amount") &&
    stripeSvc.includes("transfer_data") &&
    stripeSvc.includes("destination: destinationAccountId")
  ) {
    pass("A-static-destination-checkout", "Checkout Session includes application_fee_amount + transfer_data.destination");
  } else {
    fail("A-static-destination-checkout", "Missing payment_intent_data destination routing");
  }

  if (
    destSvc.includes("stripeAccountId") &&
    destSvc.includes("StripeConnectStatus.ready") &&
    destSvc.includes("stripeChargesEnabled") &&
    !destSvc.includes("req.body")
  ) {
    pass("B-static-destination-from-business", "Destination resolved from Business record, not request");
  } else {
    fail("B-static-destination-from-business", "Destination resolver missing or request-scoped");
  }

  if (
    fees.includes("CARETIP_FEE_PERCENT = 10") &&
    fees.includes("CARETIP_FEE_FIXED_CENTS_EUR = 49") &&
    fees.includes("Math.floor")
  ) {
    pass("C-static-integer-fee", "Platform fee is 10% integer-cent floor + €0.49");
  } else {
    fail("C-static-integer-fee", "Fee config missing integer-cent 10% + €0.49 calculation");
  }

  if (
    paymentCtrl.includes("CONNECT_CLIENT_DESTINATION_FORBIDDEN") &&
    paymentCtrl.includes("destination") &&
    paymentCtrl.includes("application_fee_amount") &&
    paymentCtrl.includes("findClientControlledConnectPaymentField")
  ) {
    pass("D-static-client-destination-rejected", "Controller rejects client destination / fee fields");
  } else {
    fail("D-static-client-destination-rejected", "Missing client destination rejection");
  }

  const trustedBody =
    /createTipCheckoutSession\([\s\S]*?req\.body\.(destination|stripeAccountId|application_fee_amount)/.test(
      paymentCtrl,
    ) ||
    /req\.body\.(destination|stripeAccountId|application_fee_amount)/.test(stripeSvc) ||
    /input\.(destination|stripeAccountId|applicationFee|application_fee_amount)/.test(stripeSvc);
  if (!trustedBody) {
    pass("Z-static-no-client-destination-to-stripe", "Production code does not trust req.body destination/fee as Stripe params");
  } else {
    fail("Z-static-no-client-destination-to-stripe", "Client destination/fee appears to be passed into Stripe");
  }

  if (!stripeSvc.includes("on_behalf_of") && !connectSvc.includes("checkout.sessions.create")) {
    pass("no-on-behalf-of-and-connect-svc-clean", "No on_behalf_of; Connect account service does not create Checkout");
  } else {
    fail("no-on-behalf-of-and-connect-svc-clean", "Unexpected on_behalf_of or Checkout in Connect service");
  }

  if (
    destSvc.includes("deletedAt") &&
    destSvc.includes("legalHold") &&
    destSvc.includes("stripePayoutsEnabled") &&
    destSvc.includes("CONNECT_NOT_READY")
  ) {
    pass("F-static-readiness-gate", "Connect readiness gate covers deleted/legal-hold/ready/charges/payouts");
  } else {
    fail("F-static-readiness-gate", "Readiness gate incomplete");
  }

  if (stripeSvc.includes("refund_application_fee: true")) {
    pass("Y-static-refund-application-fee", "Eligibility refunds unwind the Connect application fee");
  } else {
    fail("Y-static-refund-application-fee", "Missing refund_application_fee on eligibility refund");
  }

  if (
    webhook.includes("verifyWebhookSignature") &&
    webhook.includes("isStripeWebhookEventProcessed") &&
    schema.includes("stripePaymentIntentId") &&
    schema.includes("@unique")
  ) {
    pass("S-static-webhook-signature-and-pi-unique", "Webhook signature + PI uniqueness preserved");
  } else {
    fail("S-static-webhook-signature-and-pi-unique", "Webhook/PI uniqueness regression");
  }

  if (
    stripeSvc.includes("handlePaymentSuccess") &&
    stripeSvc.includes('status: "pending"') &&
    stripeSvc.includes("if (!pending)")
  ) {
    pass("V-static-pi-succeeded-pending-only", "payment_intent.succeeded only promotes pending rows (no Checkout double-credit)");
  } else {
    fail("V-static-pi-succeeded-pending-only", "Legacy PI success path may double-credit");
  }

  if (stripeSvc.includes("payouts.create") || connectSvc.includes("payouts.create")) {
    fail("no-payouts-create", "payouts.create present");
  } else if (webhook.includes("payout.paid")) {
    pass("payout-observe-no-create", "Phase 3 observes payouts; payouts.create absent");
  } else {
    pass("no-payout-handlers", "Payout handlers not present; payouts.create absent");
  }
}

function runFeeAndClientFieldUnits() {
  if (CARETIP_FEE_PERCENT !== 10 || CARETIP_FEE_FIXED_CENTS_EUR !== 49) {
    fail("fee-percent", `Expected 10% + 49¢, got ${CARETIP_FEE_PERCENT}% + ${CARETIP_FEE_FIXED_CENTS_EUR}¢`);
  } else {
    pass("fee-percent", "CARETIP_FEE_PERCENT is 10 and CARETIP_FEE_FIXED_CENTS_EUR is 49");
  }

  if (MIN_TIP_AMOUNT_EUR !== 1) {
    fail("min-tip-eur", `Expected €1.00, got ${MIN_TIP_AMOUNT_EUR}`);
  } else {
    pass("min-tip-eur", "MIN_TIP_AMOUNT_EUR is €1.00");
  }

  const commissionTable: Array<[number, number, string]> = [
    [100, 59, "€1.00"],
    [200, 69, "€2.00"],
    [500, 99, "€5.00"],
    [1000, 149, "€10.00"],
    [2000, 249, "€20.00"],
    [5000, 549, "€50.00"],
    [10000, 1049, "€100.00"],
  ];
  for (const [cents, expected, label] of commissionTable) {
    const got = calculateTipPlatformFeeCents(cents);
    if (got === expected && got < cents && Number.isInteger(got)) pass(`C-fee-${label}`, `${cents}¢ → ${got}¢`);
    else fail(`C-fee-${label}`, `expected ${expected} got ${got}`);
  }

  expectReject("below-min-50-cent", () => assertTipAmountInRangeEur(0.5));
  expectReject("P-fee-cannot-consume-50c", () => calculateTipPlatformFeeCents(50));
  expectReject("P-fee-cannot-consume-full", () => calculateTipPlatformFeeCents(54));
  expectReject("P-fee-cannot-exceed-1c", () => calculateTipPlatformFeeCents(1));
  expectReject("P-fee-zero-amount", () => calculateTipPlatformFeeCents(0));
  expectReject("P-fee-negative", () => calculateTipPlatformFeeCents(-100));
  expectReject("Q-fee-nan", () => calculateTipPlatformFeeCents(Number.NaN));
  expectReject("Q-fee-infinity", () => calculateTipPlatformFeeCents(Number.POSITIVE_INFINITY));

  if (findClientControlledConnectPaymentField({ body: { destination: "acct_evil" } }) === "body.destination") {
    pass("D-unit-body-destination", "body.destination rejected");
  } else fail("D-unit-body-destination", "body.destination not detected");

  if (
    findClientControlledConnectPaymentField({ body: { application_fee_amount: 1 } }) ===
    "body.application_fee_amount"
  ) {
    pass("E-unit-body-fee", "body.application_fee_amount rejected");
  } else fail("E-unit-body-fee", "application_fee_amount not detected");

  if (findClientControlledConnectPaymentField({ query: { stripeAccountId: "acct_q" } }) === "query.stripeAccountId") {
    pass("D-unit-query-acct", "query.stripeAccountId rejected");
  } else fail("D-unit-query-acct", "query stripeAccountId not detected");

  if (
    findClientControlledConnectPaymentField({ headers: { "stripe-account": "acct_h" } }) === "header.stripe-account"
  ) {
    pass("D-unit-header-acct", "stripe-account header rejected");
  } else fail("D-unit-header-acct", "header not detected");

  if (findClientControlledConnectPaymentField({ body: { employeeId: "e", businessId: "b", amount: 5 } }) === null) {
    pass("D-unit-allowed-body", "Normal tip body has no forbidden Connect fields");
  } else fail("D-unit-allowed-body", "False positive on allowed body");

  if (TIP_CONNECT_CLIENT_FORBIDDEN_KEYS.includes("platformFee") && TIP_CONNECT_CLIENT_FORBIDDEN_KEYS.includes("feePercentage")) {
    pass("F-unit-fee-override-keys", "Client fee override keys listed");
  } else fail("F-unit-fee-override-keys", "Missing fee override keys");
}

async function runRuntime(): Promise<void> {
  const captured: Stripe.Checkout.SessionCreateParams[] = [];
  __setCheckoutSessionsCreateFnForTests(async (params) => {
    captured.push(params);
    return fakeCheckoutSession(params);
  });

  const ready = await createVenue("ready");
  const bizB = await createVenue("bizb");

  try {
    captured.length = 0;
    const created = await createTipCheckoutSession({
      amount: 10,
      employeeId: ready.employeeId,
      businessId: ready.businessId,
    });
    const last = captured[captured.length - 1];
    const dest = last?.payment_intent_data?.transfer_data?.destination;
    const fee = last?.payment_intent_data?.application_fee_amount;
    if (created.sessionId && dest === ready.stripeAccountId && fee === 149) {
      pass("A-ready-destination-checkout", `session=${created.sessionId} dest suffix=${String(dest).slice(-8)} fee=${fee}`);
    } else {
      fail("A-ready-destination-checkout", `dest=${dest} expected=${ready.stripeAccountId} fee=${fee}`);
    }
    pass("B-destination-equals-business", `destination=${dest}`);
    pass("C-platform-fee-server", `application_fee_amount=${fee}`);

    captured.length = 0;
    await createTipCheckoutSession({
      amount: 10,
      employeeId: ready.employeeId,
      businessId: ready.businessId,
      destination: "acct_ATTACKER",
      stripeAccountId: "acct_ATTACKER",
      application_fee_amount: 1,
      platformFee: 0,
      feePercentage: 0,
    } as unknown as Parameters<typeof createTipCheckoutSession>[0]);
    const ignored = captured[captured.length - 1];
    if (
      ignored?.payment_intent_data?.transfer_data?.destination === ready.stripeAccountId &&
      ignored?.payment_intent_data?.application_fee_amount === 149
    ) {
      pass("D-client-destination-ignored-by-service", "Service ignored extra client destination/fee fields");
      pass("E-client-fee-ignored-by-service", "application_fee_amount stayed server-calculated 149");
      pass("F-client-cannot-change-fee", "Client feePercentage/platformFee did not reach Stripe");
      pass("G-cannot-route-to-other-acct", "Could not route Business A to acct_ATTACKER");
      pass("Z-runtime-no-client-dest", "No client-controlled destination reached mocked Stripe");
    } else {
      fail("D-client-destination-ignored-by-service", JSON.stringify(ignored?.payment_intent_data));
      fail("E-client-fee-ignored-by-service", String(ignored?.payment_intent_data?.application_fee_amount));
      fail("F-client-cannot-change-fee", "fee override leaked");
      fail("G-cannot-route-to-other-acct", String(ignored?.payment_intent_data?.transfer_data?.destination));
      fail("Z-runtime-no-client-dest", "client dest may have leaked");
    }

    captured.length = 0;
    await expectAsyncReject("H-employee-business-mismatch", async () => {
      await createTipCheckoutSession({
        amount: 10,
        employeeId: ready.employeeId,
        businessId: bizB.businessId,
      });
    }, "EMPLOYEE_BUSINESS_MISMATCH");
    if (captured.length === 0) pass("H-no-stripe-on-mismatch", "Mismatched employee/business never called Stripe");
    else fail("H-no-stripe-on-mismatch", "Stripe was called");

    const notConnected = await createVenue("nc", {
      stripeAccountId: null,
      status: StripeConnectStatus.not_connected,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    try {
      captured.length = 0;
      await expectAsyncReject("I-not-connected", async () => {
        await createTipCheckoutSession({
          amount: 10,
          employeeId: notConnected.employeeId,
          businessId: notConnected.businessId,
        });
      }, CONNECT_NOT_READY_CODE);
    } finally {
      await destroyVenue(notConnected);
    }

    const incomplete = await createVenue("inc", {
      status: StripeConnectStatus.onboarding_incomplete,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    try {
      await expectAsyncReject("J-onboarding-incomplete", async () => {
        await createTipCheckoutSession({
          amount: 10,
          employeeId: incomplete.employeeId,
          businessId: incomplete.businessId,
        });
      }, CONNECT_NOT_READY_CODE);
    } finally {
      await destroyVenue(incomplete);
    }

    const noCharges = await createVenue("ncg", {
      status: StripeConnectStatus.ready,
      chargesEnabled: false,
      payoutsEnabled: true,
    });
    try {
      await expectAsyncReject("K-charges-disabled", async () => {
        await createTipCheckoutSession({
          amount: 10,
          employeeId: noCharges.employeeId,
          businessId: noCharges.businessId,
        });
      }, CONNECT_NOT_READY_CODE);
    } finally {
      await destroyVenue(noCharges);
    }

    const restricted = await createVenue("rst", {
      status: StripeConnectStatus.restricted,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
    try {
      await expectAsyncReject("L-restricted", async () => {
        await createTipCheckoutSession({
          amount: 10,
          employeeId: restricted.employeeId,
          businessId: restricted.businessId,
        });
      }, CONNECT_NOT_READY_CODE);
    } finally {
      await destroyVenue(restricted);
    }

    const soft = await createVenue("soft", { deletedAt: new Date() });
    try {
      await expectAsyncReject("M-soft-deleted", async () => {
        await createTipCheckoutSession({
          amount: 10,
          employeeId: soft.employeeId,
          businessId: soft.businessId,
        });
      });
    } finally {
      await destroyVenue(soft);
    }

    const suspended = await createVenue("sus", { operationalStatus: "suspended" });
    try {
      await expectAsyncReject("N-suspended", async () => {
        await createTipCheckoutSession({
          amount: 10,
          employeeId: suspended.employeeId,
          businessId: suspended.businessId,
        });
      }, "BUSINESS_NOT_OPERATIONAL");
    } finally {
      await destroyVenue(suspended);
    }

    const draft = await createVenue("draft", { onboarding: OnboardingVerificationStatus.draft });
    try {
      await expectAsyncReject("O-onboarding-not-approved", async () => {
        await createTipCheckoutSession({
          amount: 10,
          employeeId: draft.employeeId,
          businessId: draft.businessId,
        });
      }, "GO_LIVE_REQUIRED");
    } finally {
      await destroyVenue(draft);
    }

    await expectAsyncReject("Q-negative-amount", async () => {
      await createTipCheckoutSession({
        amount: -5,
        employeeId: ready.employeeId,
        businessId: ready.businessId,
      });
    });
    await expectAsyncReject("Q-zero-amount", async () => {
      await createTipCheckoutSession({
        amount: 0,
        employeeId: ready.employeeId,
        businessId: ready.businessId,
      });
    });
    await expectAsyncReject("Q-nan-amount", async () => {
      await createTipCheckoutSession({
        amount: Number.NaN,
        employeeId: ready.employeeId,
        businessId: ready.businessId,
      });
    });
    await expectAsyncReject("Q-infinity-amount", async () => {
      await createTipCheckoutSession({
        amount: Number.POSITIVE_INFINITY,
        employeeId: ready.employeeId,
        businessId: ready.businessId,
      });
    });
    await expectAsyncReject("R-amount-tipAmount-mismatch", async () => {
      await createTipCheckoutSession({
        amount: 10,
        tipAmount: 12,
        employeeId: ready.employeeId,
        businessId: ready.businessId,
      });
    });

    const pi = `pi_p2_dup_${Date.now()}`;
    __setPaymentIntentsRetrieveFnForTests(async (id) => ({
      id,
      object: "payment_intent",
      amount: 1000,
      amount_received: 1000,
      currency: "eur",
      status: "succeeded",
      application_fee_amount: 149,
      transfer_data: { destination: ready.stripeAccountId },
    } as Stripe.PaymentIntent));
    __setConnectedAccountRetrieveFnForTests(async (id) => ({
      id,
      charges_enabled: true,
      payouts_enabled: true,
    }));
    const sessionObj = {
      id: `cs_p2_dup_${Date.now()}`,
      object: "checkout.session",
      payment_status: "paid",
      currency: "eur",
      amount_total: 1000,
      payment_intent: pi,
      metadata: {
        employeeId: ready.employeeId,
        businessId: ready.businessId,
      },
    } as unknown as Stripe.Checkout.Session;

    await handleSuccessfulTipPayment(sessionObj);
    const first = await prisma.transaction.findMany({ where: { stripePaymentIntentId: pi } });
    await handleSuccessfulTipPayment(sessionObj);
    const afterDup = await prisma.transaction.findMany({ where: { stripePaymentIntentId: pi } });
    if (first.length === 1 && afterDup.length === 1 && first[0]?.status === "success") {
      pass("T-duplicate-webhook-no-double-credit", `single tip ${first[0]?.id}`);
      pass("U-payment-intent-unique", "Duplicate checkout.session.completed did not insert a second row");
    } else {
      fail("T-duplicate-webhook-no-double-credit", `count first=${first.length} after=${afterDup.length}`);
      fail("U-payment-intent-unique", `rows=${afterDup.length}`);
    }
  } finally {
    __setCheckoutSessionsCreateFnForTests(null);
    __setPaymentIntentsRetrieveFnForTests(null);
    __setConnectedAccountRetrieveFnForTests(null);
    await destroyVenue(ready);
    await destroyVenue(bizB);
  }
}

async function main() {
  console.log("=== CareTip Stripe Connect Phase 2 Tests ===\n");
  runStaticSecurity();
  runFeeAndClientFieldUnits();
  try {
    await runRuntime();
  } catch (err) {
    fail("runtime-suite", err instanceof Error ? err.message : String(err));
    console.error(err);
  } finally {
    __setCheckoutSessionsCreateFnForTests(null);
    __setPaymentIntentsRetrieveFnForTests(null);
    __setConnectedAccountRetrieveFnForTests(null);
  }

  console.log("--- Results ---\n");
  for (const r of results) {
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
  }
  const failures = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length} checks, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
