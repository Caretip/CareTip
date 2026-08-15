/**
 * Stripe Connect Phase 2.7 — final destination-charge security hardening tests.
 * Run: npm run test:stripe-connect-phase2-7
 *
 * Never prints Stripe secrets, webhook secrets, or full acct_/pi_/cs_ identifiers.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync, readdirSync } from "node:fs";
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
import { resolveCheckoutFrontendBaseUrl } from "../src/config/frontendUrl.js";
import { findClientControlledConnectPaymentField } from "../src/controllers/payment.controller.js";
import {
  CONNECT_DESTINATION_MISMATCH_CODE,
  CONNECT_LIVE_ACCOUNT_NOT_CAPABLE_CODE,
  CONNECT_NOT_READY_CODE,
  CONNECT_PAYMENT_INVARIANT_CODE,
  CONNECT_TIP_UNAVAILABLE_MSG,
  destinationAccountIdFromPaymentIntent,
} from "../src/services/connectTipDestination.service.js";
import { TipPaymentEligibilityError } from "../src/services/tipPaymentEligibility.service.js";
import {
  createTipCheckoutSession,
  handlePaymentSuccess,
  handleSuccessfulTipPayment,
  isStripeConfigured,
  verifyWebhookSignature,
  __setCheckoutSessionsCreateFnForTests,
  __setRefundsCreateFnForTests,
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
  const passwordHash = await bcrypt.hash("ConnectPhase27!23", 4);
  const manager = await prisma.user.create({
    data: {
      email: `mgr27_${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });
  const empUser = await prisma.user.create({
    data: {
      email: `emp27_${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
      isActive: true,
    },
  });
  const acct =
    connect.stripeAccountId === null ? null : (connect.stripeAccountId ?? `acct_p27_${suffix}`);
  const biz = await prisma.business.create({
    data: {
      name: `Connect27 ${suffix}`,
      slug: `connect27-${suffix}`,
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
  await prisma.tipRefund.deleteMany({ where: { businessId: v.businessId } }).catch(() => undefined);
  await prisma.businessActivityEvent.deleteMany({ where: { businessId: v.businessId } }).catch(() => undefined);
  await prisma.transaction.deleteMany({
    where: { OR: [{ businessId: v.businessId }, { employeeId: v.employeeId }] },
  });
  await prisma.employee.deleteMany({ where: { id: v.employeeId } });
  await prisma.business.deleteMany({ where: { id: v.businessId } });
  await prisma.user.deleteMany({ where: { id: { in: [v.managerId, v.employeeUserId] } } });
}

function fakePi(id: string, dest: string, amount = 1000, fee = 149): Stripe.PaymentIntent {
  return {
    id,
    object: "payment_intent",
    amount,
    amount_received: amount,
    currency: "eur",
    status: "succeeded",
    application_fee_amount: fee,
    transfer_data: { destination: dest },
  } as Stripe.PaymentIntent;
}

function paidSession(v: Venue, pi: string, extra?: Partial<Stripe.Checkout.Session>): Stripe.Checkout.Session {
  return {
    id: `cs_p27_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    object: "checkout.session",
    payment_status: "paid",
    currency: "eur",
    amount_total: 1000,
    payment_intent: pi,
    metadata: { employeeId: v.employeeId, businessId: v.businessId },
    ...extra,
  } as Stripe.Checkout.Session;
}

function runStaticAudit() {
  const stripeSvc = read("src/services/stripe.service.ts");
  const destSvc = read("src/services/connectTipDestination.service.ts");
  const webhook = read("src/webhooks/stripe.webhook.ts");
  const billing = read("src/services/stripeBilling.service.ts");
  const connectSvc = read("src/services/stripeConnect.service.ts");
  const paymentCtrl = read("src/controllers/payment.controller.ts");
  const fees = read("src/config/fees.ts");
  const frontendUrl = read("src/config/frontendUrl.ts");
  const indexSrc = read("src/index.ts");

  if (stripeSvc.includes("assertPaymentIntentDestinationMatchesBusiness")) {
    pass("A-static-dest-reassert", "Webhook re-asserts PI destination vs Business.stripeAccountId");
  } else fail("A-static-dest-reassert", "Missing destination re-assertion");

  if (stripeSvc.includes("retrieveConnectedAccountForWebhook") || stripeSvc.includes("accounts.retrieve")) {
    pass("L-static-live-retrieve-webhook", "Webhook live Connect retrieve present");
  } else fail("L-static-live-retrieve-webhook", "No live accounts.retrieve on webhook path");

  if (
    destSvc.includes("assertBusinessReadyForConnectTipDestination") &&
    !destSvc.includes("accounts.retrieve")
  ) {
    pass("F-static-checkout-mirror", "Checkout gate remains CareTip mirror (no live retrieve in destination service)");
  } else fail("F-static-checkout-mirror", "Checkout destination service unexpectedly retrieves Stripe accounts");

  if (stripeSvc.includes("refund_application_fee: true") && stripeSvc.includes("reverse_transfer: true")) {
    pass("R-static-refund-app-fee", "Eligibility refund uses refund_application_fee + reverse_transfer");
  } else fail("R-static-refund-app-fee", "Refund flags incorrect");

  if (webhook.includes("verifyWebhookSignature") && indexSrc.includes("express.raw")) {
    pass("N-static-webhook-raw-sig", "Raw body + signature verification wired");
  } else fail("N-static-webhook-raw-sig", "Webhook mount/signature missing");

  if (webhook.includes("isStripeWebhookEventProcessed") && stripeSvc.includes("stripePaymentIntentId")) {
    pass("O-static-idempotency", "Event-id idempotency + PI uniqueness remain");
  } else fail("O-static-idempotency", "Idempotency wiring missing");

  if (stripeSvc.includes("status: \"pending\"") && stripeSvc.includes("handlePaymentSuccess")) {
    pass("P-static-pi-succeeded-pending", "payment_intent.succeeded remains pending-only");
  } else fail("P-static-pi-succeeded-pending", "pending-only path missing");

  if (stripeSvc.includes("payouts.create")) {
    fail("no-payouts-create", "payouts.create present");
  } else if (webhook.includes("payout.paid")) {
    pass("payout-observe-no-create", "Phase 3 observes payouts; payouts.create absent");
  } else {
    pass("no-payout-handlers", "payout.* not implemented; payouts.create absent");
  }

  if (billing.includes('mode: "subscription"') && !billing.includes("transfer_data")) {
    pass("V-static-billing-separate", "SaaS billing Checkout has no transfer_data");
  } else fail("V-static-billing-separate", "Billing may share destination routing");

  if (!connectSvc.includes("checkout.sessions.create") && !connectSvc.includes("application_fee_amount")) {
    pass("V-static-connect-no-checkout", "Connect onboarding service does not create tip Checkout");
  } else fail("V-static-connect-no-checkout", "Connect service creates Checkout");

  const srcFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(backendRoot, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") walk(rel);
      else if (entry.isFile() && entry.name.endsWith(".ts")) srcFiles.push(rel);
    }
  };
  walk("src");
  const destCreates = srcFiles.filter((f) => {
    const t = read(f);
    return (
      t.includes("payment_intent_data:") &&
      t.includes("application_fee_amount:") &&
      t.includes("transfer_data:") &&
      (t.includes("checkout.sessions.create") || t.includes("createCheckoutSession"))
    );
  });
  if (destCreates.length === 1 && destCreates[0].replace(/\\/g, "/").includes("src/services/stripe.service.ts")) {
    pass("V-single-tip-path", "Exactly one production destination-charge creator");
  } else fail("V-single-tip-path", `destination-charge files=${destCreates.join(",")}`);

  if (
    fees.includes("CARETIP_FEE_PERCENT = 10") &&
    fees.includes("CARETIP_FEE_FIXED_CENTS_EUR = 49")
  ) {
    pass("fee-percent", "CARETIP_FEE_PERCENT=10 CARETIP_FEE_FIXED_CENTS_EUR=49");
  } else fail("fee-percent", "Fee policy changed");

  if (
    paymentCtrl.includes("payment_intent_data") &&
    paymentCtrl.includes("on_behalf_of") &&
    paymentCtrl.includes("connectAccountId")
  ) {
    pass("C-static-nested-denylist", "HTTP denylist includes nested destination/fee keys");
  } else fail("C-static-nested-denylist", "Denylist incomplete");

  if (frontendUrl.includes("HTTPS") && frontendUrl.includes("localhost")) {
    pass("J-static-frontend-url", "Production FRONTEND_URL helper rejects localhost / requires HTTPS");
  } else fail("J-static-frontend-url", "frontendUrl helper missing production guards");

  if (webhook.includes("account.updated") && connectSvc.includes("shouldAcceptConnectAccountEvent")) {
    pass("T-static-stale-account-updated", "Stale account.updated guard remains");
  } else fail("T-static-stale-account-updated", "Stale webhook guard missing");

  const destId = destinationAccountIdFromPaymentIntent({
    transfer_data: { destination: "acct_expected" },
  } as Stripe.PaymentIntent);
  if (destId === "acct_expected") pass("A-unit-dest-extract", "PI destination extracted from transfer_data");
  else fail("A-unit-dest-extract", String(destId));
}

function runFeeUnits() {
  if (CARETIP_FEE_PERCENT !== 10 || CARETIP_FEE_FIXED_CENTS_EUR !== 49) {
    fail("fee-runtime", `Expected 10% + 49¢ got ${CARETIP_FEE_PERCENT}% + ${CARETIP_FEE_FIXED_CENTS_EUR}¢`);
  } else pass("fee-runtime", "Runtime fee constants 10% + €0.49");
  const table: Array<[number, number, string]> = [
    [100, 59, "€1.00"],
    [200, 69, "€2.00"],
    [500, 99, "€5.00"],
    [1000, 149, "€10.00"],
    [2000, 249, "€20.00"],
    [5000, 549, "€50.00"],
    [10000, 1049, "€100.00"],
    [9999, 1048, "€99.99"],
    [50000, 5049, "€500.00"],
  ];
  for (const [cents, expected, label] of table) {
    const got = calculateTipPlatformFeeCents(cents);
    if (got === expected && got < cents && Number.isInteger(got)) pass(`fee-${label}`, `${cents}¢ → ${got}¢`);
    else fail(`fee-${label}`, `expected ${expected} got ${got}`);
  }
  try {
    calculateTipPlatformFeeCents(50);
    fail("fee-cannot-consume-tip", "Fee helper accepted an amount it would consume");
  } catch {
    pass("fee-cannot-consume-tip", "Fee cannot consume the entire tip");
  }
}

function runFrontendUrlUnits() {
  const savedNode = process.env.NODE_ENV;
  const savedFront = process.env.FRONTEND_URL;
  try {
    const local = resolveCheckoutFrontendBaseUrl({ ...process.env, NODE_ENV: "development", FRONTEND_URL: "" });
    if (local === "http://localhost:5173") pass("J-dev-default-localhost", "Dev default is localhost:5173");
    else fail("J-dev-default-localhost", local);

    const stripped = resolveCheckoutFrontendBaseUrl({
      ...process.env,
      NODE_ENV: "development",
      FRONTEND_URL: "http://localhost:5173/",
    });
    if (stripped === "http://localhost:5173") pass("J-trailing-slash", "Trailing slash stripped");
    else fail("J-trailing-slash", stripped);

    const ratingBase = `${stripped}/rating?session_id={CHECKOUT_SESSION_ID}`;
    const cancelBase = `${stripped}/payment?canceled=1`;
    if (ratingBase.includes("/rating?") && cancelBase.includes("/payment?canceled=1") && !ratingBase.includes("//rating")) {
      pass("J-success-cancel-paths", "success /rating and cancel /payment?canceled=1");
    } else fail("J-success-cancel-paths", "path construction broken");

    try {
      resolveCheckoutFrontendBaseUrl({ ...process.env, NODE_ENV: "production", FRONTEND_URL: "" });
      fail("J-prod-missing", "Production allowed missing FRONTEND_URL");
    } catch {
      pass("J-prod-missing", "Production requires FRONTEND_URL");
    }
    try {
      resolveCheckoutFrontendBaseUrl({
        ...process.env,
        NODE_ENV: "production",
        FRONTEND_URL: "http://localhost:5173",
      });
      fail("J-prod-localhost", "Production allowed localhost FRONTEND_URL");
    } catch {
      pass("J-prod-localhost", "Production rejects localhost FRONTEND_URL");
    }
    try {
      resolveCheckoutFrontendBaseUrl({
        ...process.env,
        NODE_ENV: "production",
        FRONTEND_URL: "http://caretip.de",
      });
      fail("J-prod-http", "Production allowed http FRONTEND_URL");
    } catch {
      pass("J-prod-http", "Production requires HTTPS FRONTEND_URL");
    }
    const prod = resolveCheckoutFrontendBaseUrl({
      ...process.env,
      NODE_ENV: "production",
      FRONTEND_URL: "https://caretip.de/",
    });
    if (prod === "https://caretip.de") pass("J-prod-https", "Production HTTPS origin accepted");
    else fail("J-prod-https", prod);
  } finally {
    process.env.NODE_ENV = savedNode;
    if (savedFront === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = savedFront;
  }
}

function runInjectionUnits() {
  const attacks: Array<[string, Record<string, unknown>]> = [
    ["B-inj-destination", { destination: "acct_ATTACKER" }],
    ["B-inj-stripeAccountId", { stripeAccountId: "acct_ATTACKER" }],
    ["B-inj-connectAccountId", { connectAccountId: "acct_ATTACKER" }],
    ["C-inj-nested-pi", { payment_intent_data: { transfer_data: { destination: "acct_ATTACKER" } } }],
    ["C-inj-metadata-dest", { metadata: { destination: "acct_ATTACKER" } }],
    ["D-inj-fee", { application_fee_amount: 1 }],
    ["D-inj-on-behalf", { on_behalf_of: "acct_ATTACKER" }],
  ];
  for (const [id, body] of attacks) {
    const hit = findClientControlledConnectPaymentField({ body });
    if (hit) pass(id, `Rejected ${hit}`);
    else fail(id, "Not rejected");
  }
  if (findClientControlledConnectPaymentField({ query: { destination: "acct_ATTACKER" } })) {
    pass("B-inj-query", "Query destination rejected");
  } else fail("B-inj-query", "Query not rejected");
  if (findClientControlledConnectPaymentField({ headers: { "stripe-account": "acct_ATTACKER" } })) {
    pass("B-inj-header", "stripe-account header rejected");
  } else fail("B-inj-header", "Header not rejected");
}

function runWebhookSignatureUnits() {
  try {
    verifyWebhookSignature(Buffer.from("{}"), undefined);
    fail("N-missing-sig", "Missing signature accepted");
  } catch {
    pass("N-missing-sig", "Missing signature rejected");
  }
  try {
    verifyWebhookSignature(Buffer.from('{"id":"evt_fake"}'), "t=1,v1=deadbeef");
    fail("N-invalid-sig", "Invalid signature accepted");
  } catch {
    pass("N-invalid-sig", "Invalid signature rejected");
  }
  pass(
    "N-secret-configured",
    process.env.STRIPE_WEBHOOK_SECRET?.trim() ? "STRIPE_WEBHOOK_SECRET set" : "secret missing — verify fails closed",
  );
}

async function expectReject(id: string, fn: () => Promise<unknown>, code?: string): Promise<void> {
  try {
    await fn();
    fail(id, "Expected rejection");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const got = e instanceof TipPaymentEligibilityError ? e.code : "";
    if (code && got !== code) {
      fail(id, `Expected ${code} got ${got || msg}`);
      return;
    }
    if (/acct_[a-zA-Z0-9]+/.test(msg) || /charges_enabled/i.test(msg)) {
      fail(id, `Guest-unsafe error ${msg.slice(0, 60)}`);
      return;
    }
    pass(id, `Rejected ${got || msg.slice(0, 60)}`);
  }
}

async function runRuntime(): Promise<void> {
  const captured: Stripe.Checkout.SessionCreateParams[] = [];
  const refunds: Array<{ params: Stripe.RefundCreateParams; options?: Stripe.RequestOptions }> = [];
  __setCheckoutSessionsCreateFnForTests(async (params) => {
    captured.push(params);
    return {
      id: `cs_test_p27_${Date.now()}`,
      object: "checkout.session",
      url: "https://checkout.stripe.com/c/pay/p27",
      mode: "payment",
      payment_status: "unpaid",
      status: "open",
      metadata: params.metadata ?? {},
    } as Stripe.Checkout.Session;
  });
  __setRefundsCreateFnForTests(async (params, options) => {
    refunds.push({ params, options });
    return { id: `re_p27_${Date.now()}`, object: "refund", status: "succeeded" } as Stripe.Refund;
  });

  const a = await createVenue("a");
  const b = await createVenue("b");

  const installHappyRetrieve = (dest: string, amount = 1000, fee = 149) => {
    __setPaymentIntentsRetrieveFnForTests(async (id) => fakePi(id, dest, amount, fee));
    __setConnectedAccountRetrieveFnForTests(async (id) => ({
      id,
      charges_enabled: true,
      payouts_enabled: true,
    }));
  };
  installHappyRetrieve(a.stripeAccountId);

  try {
    captured.length = 0;
    await createTipCheckoutSession({ amount: 10, employeeId: a.employeeId, businessId: a.businessId });
    const created = captured[0];
    if (
      created?.payment_intent_data?.transfer_data?.destination === a.stripeAccountId &&
      created.payment_intent_data?.application_fee_amount === 149 &&
      created.success_url?.includes("/rating?session_id=") &&
      created.cancel_url?.includes("/payment?canceled=1")
    ) {
      pass("A-checkout-dest-fee", "Checkout dest=Business.stripeAccountId fee=149");
      pass("J-checkout-urls", "success_url /rating and cancel_url /payment?canceled=1");
    } else fail("A-checkout-dest-fee", "Checkout params incorrect");

    captured.length = 0;
    await createTipCheckoutSession({
      amount: 10,
      employeeId: a.employeeId,
      businessId: a.businessId,
      destination: b.stripeAccountId,
      stripeAccountId: b.stripeAccountId,
      application_fee_amount: 1,
      on_behalf_of: b.stripeAccountId,
    } as never);
    const ignored = captured[captured.length - 1];
    if (
      ignored?.payment_intent_data?.transfer_data?.destination === a.stripeAccountId &&
      ignored.payment_intent_data?.application_fee_amount === 149 &&
      !JSON.stringify(ignored.payment_intent_data).includes("on_behalf_of")
    ) {
      pass("B-service-ignores-client-dest", "Client dest/fee/on_behalf_of ignored");
      pass("X-no-client-fee", "application_fee_amount stayed 149");
      pass("W-no-client-acct", "Stripe dest remained Business A");
    } else fail("B-service-ignores-client-dest", "Client fields reached Stripe");

    await expectReject(
      "K-emp-biz-mismatch",
      () => createTipCheckoutSession({ amount: 10, employeeId: a.employeeId, businessId: b.businessId }),
      "EMPLOYEE_BUSINESS_MISMATCH",
    );

    await expectReject(
      "F-not-ready",
      async () => {
        const v = await createVenue("nr", { status: StripeConnectStatus.restricted });
        try {
          await createTipCheckoutSession({ amount: 10, employeeId: v.employeeId, businessId: v.businessId });
        } finally {
          await destroyVenue(v);
        }
      },
      CONNECT_NOT_READY_CODE,
    );
    await expectReject(
      "G-soft-close",
      async () => {
        const v = await createVenue("sc", { deletedAt: new Date(), operationalStatus: "inactive" });
        try {
          await createTipCheckoutSession({ amount: 10, employeeId: v.employeeId, businessId: v.businessId });
        } finally {
          await destroyVenue(v);
        }
      },
    );
    await expectReject(
      "H-legal-hold",
      async () => {
        const v = await createVenue("lh", { legalHold: true });
        try {
          await createTipCheckoutSession({ amount: 10, employeeId: v.employeeId, businessId: v.businessId });
        } finally {
          await destroyVenue(v);
        }
      },
      CONNECT_NOT_READY_CODE,
    );
    await expectReject(
      "I-suspended",
      async () => {
        const v = await createVenue("su", { operationalStatus: "suspended" });
        try {
          await createTipCheckoutSession({ amount: 10, employeeId: v.employeeId, businessId: v.businessId });
        } finally {
          await destroyVenue(v);
        }
      },
    );

    const happyPi = `pi_p27_ok_${Date.now()}`;
    await handleSuccessfulTipPayment(paidSession(a, happyPi));
    const happyRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: happyPi } });
    if (happyRows.length === 1 && happyRows[0]?.status === "success" && Number(happyRows[0].amount) === 10) {
      pass("happy-webhook-credit", "Matching dest + live capable account → one success €10");
    } else fail("happy-webhook-credit", `rows=${happyRows.length} status=${happyRows[0]?.status}`);

    await handleSuccessfulTipPayment(paidSession(a, happyPi));
    await handlePaymentSuccess(happyPi);
    const afterReplay = await prisma.transaction.findMany({ where: { stripePaymentIntentId: happyPi } });
    if (afterReplay.length === 1 && afterReplay[0]?.status === "success") {
      pass("O-replay-one-row", "Replay + payment_intent.succeeded did not duplicate");
      pass("P-pi-succeeded-no-second", "pending-only PI succeeded cannot double-credit success row");
    } else fail("O-replay-one-row", `rows=${afterReplay.length}`);

    refunds.length = 0;
    const mismatchPi = `pi_p27_mm_${Date.now()}`;
    __setPaymentIntentsRetrieveFnForTests(async (id) => fakePi(id, b.stripeAccountId));
    await handleSuccessfulTipPayment(paidSession(a, mismatchPi));
    const mmRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: mismatchPi } });
    const mmRefund =
      refunds.length === 1 &&
      refunds[0]?.params.payment_intent === mismatchPi &&
      refunds[0]?.params.refund_application_fee === true &&
      refunds[0]?.params.reverse_transfer === true &&
      refunds[0]?.options?.idempotencyKey === `eligibility_refund:${mismatchPi}`;
    if (mmRows.length === 1 && mmRows[0]?.status === "failed" && mmRefund) {
      pass("M-dest-mismatch-fail-closed", "PI dest acct_B vs Business A → failed + application-fee refund");
    } else {
      fail("M-dest-mismatch-fail-closed", `status=${mmRows[0]?.status} refunds=${refunds.length}`);
    }

    refunds.length = 0;
    await handleSuccessfulTipPayment(paidSession(a, mismatchPi));
    if (refunds.length === 0 && (await prisma.transaction.count({ where: { stripePaymentIntentId: mismatchPi } })) === 1) {
      pass("Q-mismatch-replay-no-success", "Duplicate mismatch webhook did not credit or re-refund");
    } else fail("Q-mismatch-replay-no-success", `refunds=${refunds.length}`);

    installHappyRetrieve(a.stripeAccountId);
    refunds.length = 0;
    await prisma.business.update({
      where: { id: a.businessId },
      data: { stripeConnectStatus: StripeConnectStatus.restricted, stripeChargesEnabled: false },
    });
    const stalePi = `pi_p27_stale_${Date.now()}`;
    await handleSuccessfulTipPayment(paidSession(a, stalePi));
    const staleRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: stalePi } });
    if (staleRows.length === 1 && staleRows[0]?.status === "failed" && refunds.length === 1) {
      pass("L-stale-mirror-restricted", "Restricted mirror after Checkout → failed + refund");
    } else fail("L-stale-mirror-restricted", `status=${staleRows[0]?.status}`);

    await prisma.business.update({
      where: { id: a.businessId },
      data: {
        stripeConnectStatus: StripeConnectStatus.ready,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      },
    });

    refunds.length = 0;
    const livePi = `pi_p27_live_${Date.now()}`;
    __setConnectedAccountRetrieveFnForTests(async (id) => ({
      id,
      charges_enabled: false,
      payouts_enabled: true,
    }));
    await handleSuccessfulTipPayment(paidSession(a, livePi));
    const liveRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: livePi } });
    if (liveRows.length === 1 && liveRows[0]?.status === "failed" && refunds.length === 1) {
      pass("L-live-retrieve-not-capable", "Live Stripe account not capable → fail closed + refund");
    } else fail("L-live-retrieve-not-capable", `status=${liveRows[0]?.status} refunds=${refunds.length}`);

    installHappyRetrieve(a.stripeAccountId);
    const retrieveFailPi = `pi_p27_rf_${Date.now()}`;
    __setConnectedAccountRetrieveFnForTests(async () => {
      throw new Error("stripe_unavailable");
    });
    let threw = false;
    try {
      await handleSuccessfulTipPayment(paidSession(a, retrieveFailPi));
    } catch {
      threw = true;
    }
    const rfRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: retrieveFailPi } });
    if (threw && rfRows.length === 0) {
      pass("L-live-retrieve-error-retryable", "Stripe retrieve failure does not credit (retryable, no success row)");
    } else fail("L-live-retrieve-error-retryable", `threw=${threw} rows=${rfRows.length}`);

    installHappyRetrieve(a.stripeAccountId, 1000, 1);
    refunds.length = 0;
    const feePi = `pi_p27_fee_${Date.now()}`;
    await handleSuccessfulTipPayment(paidSession(a, feePi));
    const feeRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: feePi } });
    if (feeRows.length === 1 && feeRows[0]?.status === "failed" && refunds.length === 1) {
      pass("D-fee-mismatch-fail-closed", "Wrong application_fee_amount → failed + refund");
    } else fail("D-fee-mismatch-fail-closed", `status=${feeRows[0]?.status}`);

    installHappyRetrieve(a.stripeAccountId, 999, 49);
    refunds.length = 0;
    const amtPi = `pi_p27_amt_${Date.now()}`;
    await handleSuccessfulTipPayment(paidSession(a, amtPi));
    const amtRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: amtPi } });
    if (amtRows.length === 1 && amtRows[0]?.status === "failed") {
      pass("E-amount-mismatch-fail-closed", "Session amount_total ≠ PI amount → failed");
    } else fail("E-amount-mismatch-fail-closed", `status=${amtRows[0]?.status}`);

    if (!/acct_/.test(CONNECT_TIP_UNAVAILABLE_MSG)) {
      pass("guest-msg-safe", "Guest Connect errors do not leak acct ids");
    } else fail("guest-msg-safe", "Unsafe guest message");

    if (
      CONNECT_DESTINATION_MISMATCH_CODE === "CONNECT_DESTINATION_MISMATCH" &&
      CONNECT_LIVE_ACCOUNT_NOT_CAPABLE_CODE === "CONNECT_LIVE_ACCOUNT_NOT_CAPABLE" &&
      CONNECT_PAYMENT_INVARIANT_CODE === "CONNECT_PAYMENT_INVARIANT"
    ) {
      pass("codes-present", "Fail-closed codes defined");
    }

    const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
    if (key.startsWith("sk_live_")) fail("I-test-mode", "Live Stripe key in this environment");
    else pass("I-test-mode", key.startsWith("sk_test_") ? "sk_test_ prefix" : "no live key");
    pass("stripe-configured", isStripeConfigured() ? "Stripe configured" : "Stripe unset (tests mocked)");
  } finally {
    __setCheckoutSessionsCreateFnForTests(null);
    __setRefundsCreateFnForTests(null);
    __setPaymentIntentsRetrieveFnForTests(null);
    __setConnectedAccountRetrieveFnForTests(null);
    await destroyVenue(a);
    await destroyVenue(b);
  }
}

async function main() {
  console.log("=== CareTip Stripe Connect Phase 2.7 Security Tests ===\n");
  runStaticAudit();
  runFeeUnits();
  runFrontendUrlUnits();
  runInjectionUnits();
  runWebhookSignatureUnits();
  try {
    await runRuntime();
  } catch (err) {
    fail("runtime-suite", err instanceof Error ? err.message : String(err));
    console.error(err);
  } finally {
    __setCheckoutSessionsCreateFnForTests(null);
    __setRefundsCreateFnForTests(null);
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
  await prisma.$disconnect().catch(() => undefined);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
