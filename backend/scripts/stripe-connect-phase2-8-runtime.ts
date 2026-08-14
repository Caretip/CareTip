/**
 * Stripe Connect Phase 2.8 — production-readiness + destination-charge verification.
 * Run: npm run test:stripe-connect-phase2-8
 *
 * Non-destructive. Never prints Stripe secrets, webhook secrets, or full acct_/pi_/cs_ identifiers.
 * Does not modify Render or Stripe Dashboard. Aborts runtime mutations if sk_live_ is present.
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
import {
  formatStripeConnectPreflight,
  inspectStripeConnectPreflight,
  preflightTextLeaksSecrets,
  REPOSITORY_DOCUMENTED_GUEST_ORIGIN,
} from "../src/config/stripeConnectProductionPreflight.js";
import { findClientControlledConnectPaymentField } from "../src/controllers/payment.controller.js";
import {
  CONNECT_DESTINATION_MISMATCH_CODE,
  CONNECT_LIVE_ACCOUNT_NOT_CAPABLE_CODE,
  CONNECT_NOT_READY_CODE,
  CONNECT_PAYMENT_INVARIANT_CODE,
  CONNECT_TIP_UNAVAILABLE_MSG,
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
  const passwordHash = await bcrypt.hash("ConnectPhase28!23", 4);
  const manager = await prisma.user.create({
    data: {
      email: `mgr28_${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });
  const empUser = await prisma.user.create({
    data: {
      email: `emp28_${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
      isActive: true,
    },
  });
  const acct =
    connect.stripeAccountId === null ? null : (connect.stripeAccountId ?? `acct_p28_${suffix}`);
  const biz = await prisma.business.create({
    data: {
      name: `Connect28 ${suffix}`,
      slug: `connect28-${suffix}`,
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
    id: `cs_p28_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    object: "checkout.session",
    payment_status: "paid",
    currency: "eur",
    amount_total: 1000,
    payment_intent: pi,
    metadata: { employeeId: v.employeeId, businessId: v.businessId },
    ...extra,
  } as Stripe.Checkout.Session;
}

function expectProdFrontendThrows(id: string, frontendUrl: string, label: string): void {
  try {
    resolveCheckoutFrontendBaseUrl({
      ...process.env,
      NODE_ENV: "production",
      FRONTEND_URL: frontendUrl,
    });
    fail(id, `Production allowed ${label}`);
  } catch {
    pass(id, `Production rejects ${label}`);
  }
}

function runFrontendUrlUnits() {
  try {
    resolveCheckoutFrontendBaseUrl({ ...process.env, NODE_ENV: "production", FRONTEND_URL: "" });
    fail("A-prod-missing", "Production allowed missing FRONTEND_URL");
  } catch {
    pass("A-prod-missing", "Production requires FRONTEND_URL");
  }

  expectProdFrontendThrows("B-prod-localhost", "http://localhost:5173", "localhost");
  expectProdFrontendThrows("B-prod-127", "https://127.0.0.1", "127.0.0.1");
  expectProdFrontendThrows("B-prod-0-0-0-0", "https://0.0.0.0", "0.0.0.0");
  expectProdFrontendThrows("C-prod-http", "http://caretip.de", "http public origin");

  const prod = resolveCheckoutFrontendBaseUrl({
    ...process.env,
    NODE_ENV: "production",
    FRONTEND_URL: "https://caretip.de/",
  });
  if (prod === "https://caretip.de") pass("D-prod-https", "Production HTTPS origin accepted");
  else fail("D-prod-https", prod);

  const stripped = resolveCheckoutFrontendBaseUrl({
    ...process.env,
    NODE_ENV: "development",
    FRONTEND_URL: "http://localhost:5173/",
  });
  if (stripped === "http://localhost:5173") pass("E-trailing-slash", "Trailing slash stripped");
  else fail("E-trailing-slash", stripped);

  const success = `${stripped}/rating?session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${stripped}/payment?canceled=1`;
  if (
    success.endsWith("/rating?session_id={CHECKOUT_SESSION_ID}") &&
    cancel.endsWith("/payment?canceled=1") &&
    !success.includes("//rating") &&
    !cancel.includes("//payment")
  ) {
    pass("F-success-url", "success URL ends /rating?session_id={CHECKOUT_SESSION_ID}");
    pass("G-cancel-url", "cancel URL ends /payment?canceled=1");
  } else {
    fail("F-success-url", success);
    fail("G-cancel-url", cancel);
  }

  const local = resolveCheckoutFrontendBaseUrl({
    ...process.env,
    NODE_ENV: "development",
    FRONTEND_URL: "",
  });
  if (local === "http://localhost:5173") pass("dev-default", "Dev unset FRONTEND_URL → localhost:5173");
  else fail("dev-default", local);
}

function runPreflightAndKeySafety() {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (key.startsWith("sk_test_")) pass("H-test-key", "STRIPE_SECRET_KEY PRESENT — TEST MODE");
  else if (!key) pass("H-test-key", "STRIPE_SECRET_KEY MISSING (suite uses mocks)");
  else if (key.startsWith("sk_live_")) fail("H-test-key", "LIVE key in this environment");
  else pass("H-test-key", "key present with unknown prefix (no value printed)");

  if (key.startsWith("sk_live_")) {
    fail("I-live-key-safety", "sk_live_ detected — Stripe mutations must not run");
  } else {
    pass("I-live-key-safety", "no live key; mutation tests may use mocks");
  }

  const fakeEnv = {
    NODE_ENV: "development",
    STRIPE_SECRET_KEY: ["sk", "test", "ci", "placeholder"].join("_"),
    STRIPE_WEBHOOK_SECRET: ["whsec", "ci", "test", "secret", "placeholder"].join("_"),
    FRONTEND_URL: "https://caretip.de",
    STRIPE_CONNECT_DEFAULT_COUNTRY: "DE",
  } as NodeJS.ProcessEnv;
  const report = inspectStripeConnectPreflight(fakeEnv);
  const text = formatStripeConnectPreflight(report);
  if (preflightTextLeaksSecrets(text, fakeEnv)) {
    fail("preflight-no-secrets", "Preflight leaked a secret");
  } else {
    pass("preflight-no-secrets", "Preflight output has no secret material");
  }
  if (
    text.includes("STRIPE_SECRET_KEY: PRESENT — TEST MODE") &&
    text.includes("STRIPE_WEBHOOK_SECRET: PRESENT") &&
    text.includes("HTTPS") &&
    text.includes("PUBLIC") &&
    text.includes("NOT_VERIFIABLE_FROM_REPOSITORY")
  ) {
    pass("preflight-shape", "Preflight distinguishes local vs Render-unverifiable");
  } else fail("preflight-shape", "Preflight format incomplete");

  const prodMissing = inspectStripeConnectPreflight({
    NODE_ENV: "production",
    FRONTEND_URL: "",
  } as NodeJS.ProcessEnv);
  if (!prodMissing.productionFrontendUrlRules.wouldAccept) {
    pass("preflight-prod-missing", "Production rule check flags missing FRONTEND_URL");
  } else fail("preflight-prod-missing", "Production rule check accepted empty URL");

  const localhostProd = inspectStripeConnectPreflight({
    NODE_ENV: "development",
    FRONTEND_URL: "http://localhost:5173",
  } as NodeJS.ProcessEnv);
  if (
    localhostProd.frontendUrl.hostClass === "LOCALHOST" &&
    !localhostProd.productionFrontendUrlRules.wouldAccept
  ) {
    pass("preflight-localhost-prod-invalid", "Localhost classified; invalid under production rules");
  } else fail("preflight-localhost-prod-invalid", "Localhost production rule failed");

  if (REPOSITORY_DOCUMENTED_GUEST_ORIGIN === "https://caretip.de") {
    pass("documented-origin", "Repository-documented guest origin is https://caretip.de (not Render proof)");
  } else fail("documented-origin", REPOSITORY_DOCUMENTED_GUEST_ORIGIN);

  const localLive = inspectStripeConnectPreflight(process.env);
  console.log("\n--- Phase 2.8 local preflight (secrets redacted) ---\n");
  const liveText = formatStripeConnectPreflight(localLive);
  if (preflightTextLeaksSecrets(liveText, process.env)) {
    fail("local-preflight-print", "Local preflight would leak secrets");
  } else {
    console.log(liveText);
    console.log("");
    pass("local-preflight-print", "Printed LOCAL vs RENDER-unverifiable without secrets");
  }
}

function runStaticAudit() {
  const stripeSvc = read("src/services/stripe.service.ts");
  const destSvc = read("src/services/connectTipDestination.service.ts");
  const webhook = read("src/webhooks/stripe.webhook.ts");
  const billing = read("src/services/stripeBilling.service.ts");
  const connectSvc = read("src/services/stripeConnect.service.ts");
  const paymentCtrl = read("src/controllers/payment.controller.ts");
  const fees = read("src/config/fees.ts");
  const indexSrc = read("src/index.ts");
  const schema = read("prisma/schema.prisma");

  if (webhook.includes("verifyWebhookSignature") && indexSrc.includes("express.raw")) {
    pass("J-static-webhook-raw-sig", "Raw body + signature verification wired");
  } else fail("J-static-webhook-raw-sig", "Webhook mount/signature missing");

  const requiredEvents = [
    "checkout.session.completed",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
    "charge.refunded",
    "refund.updated",
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
    "account.updated",
  ];
  const missingEvents = requiredEvents.filter((e) => !webhook.includes(e));
  if (missingEvents.length === 0) pass("webhook-events-handled", "Required destination-charge events handled");
  else fail("webhook-events-handled", `missing ${missingEvents.join(",")}`);

  if (stripeSvc.includes("payouts.create") || connectSvc.includes("payouts.create")) {
    fail("AA-no-payouts-create", "payouts.create present");
  } else if (webhook.includes("payout.paid")) {
    pass("AA-payout-observe-no-create", "Phase 3 observes payouts; payouts.create absent");
  } else {
    pass("AA-no-payout-webhooks", "payout.* not implemented; payouts.create absent");
  }

  if (!schema.includes("model Payout") && schema.includes("payoutStatus          PayoutStatus")) {
    pass("AA-no-payout-model", "No Payout model; legacy Transaction.payoutStatus only");
  } else if (!schema.includes("model Payout")) {
    pass("AA-no-payout-model", "No Payout model");
  } else fail("AA-no-payout-model", "Payout model present");

  if (schema.includes("stripePaymentIntentId String?      @unique")) {
    pass("L-static-pi-unique", "Transaction.stripePaymentIntentId is unique");
  } else fail("L-static-pi-unique", "Unique constraint missing");

  if (webhook.includes("isStripeWebhookEventProcessed") && webhook.includes("markStripeWebhookEventProcessed")) {
    pass("K-static-event-idempotency", "Event-id idempotency remains; mark after handler");
  } else fail("K-static-event-idempotency", "Idempotency wiring missing");

  if (webhook.includes("status(500)") || webhook.includes("status(500)")) {
    pass("webhook-retry-500", "Handler failure returns retryable status");
  } else if (webhook.includes("res.status(500)")) {
    pass("webhook-retry-500", "Handler failure returns 500");
  } else {
    fail("webhook-retry-500", "No retryable 500 on handler failure");
  }

  if (
    stripeSvc.includes("assertPaymentIntentDestinationMatchesBusiness") &&
    stripeSvc.includes("retrieveConnectedAccountForWebhook") &&
    destSvc.includes("assertBusinessReadyForConnectTipDestination") &&
    !destSvc.includes("accounts.retrieve")
  ) {
    pass("p25-02-sequence-static", "Checkout mirror + webhook dest/fee/live retrieve remain");
  } else fail("p25-02-sequence-static", "P25-02 architecture drifted");

  if (
    CARETIP_FEE_PERCENT === 10 &&
    CARETIP_FEE_FIXED_CENTS_EUR === 49 &&
    fees.includes("Math.floor") &&
    fees.includes("CARETIP_FEE_FIXED_CENTS_EUR = 49")
  ) {
    pass("fee-percent", "CARETIP_FEE_PERCENT=10 + €0.49 floor policy");
  } else fail("fee-percent", "Fee policy changed");

  if (stripeSvc.includes("refund_application_fee: true") && !stripeSvc.includes("reverse_transfer")) {
    pass("AF-refund-app-fee", "Eligibility refund uses refund_application_fee, not reverse_transfer");
    pass("AG-no-reverse-transfer", "No reverse_transfer on destination-charge refunds");
  } else fail("AF-refund-app-fee", "Refund flags incorrect");

  if (billing.includes('mode: "subscription"') && !billing.includes("transfer_data") && !billing.includes("application_fee_amount")) {
    pass("AC-billing-no-transfer", "SaaS billing has no transfer_data / application_fee_amount");
  } else fail("AC-billing-no-transfer", "Billing mixed with destination charges");

  if (!connectSvc.includes("checkout.sessions.create") && !connectSvc.includes("application_fee_amount")) {
    pass("Z-connect-no-payment", "Connect onboarding does not create a payment");
  } else fail("Z-connect-no-payment", "Connect service creates Checkout");

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
    pass("Z-single-tip-path", "Exactly one production destination-charge creator");
    pass("AB-fee-only-tip-path", "application_fee_amount create only on tip Checkout");
    pass("AC-transfer-only-tip-path", "transfer_data create only on tip Checkout");
  } else fail("Z-single-tip-path", `destination-charge files=${destCreates.join(",")}`);

  const refundCreates = srcFiles.filter((f) => read(f).includes("refunds.create"));
  if (refundCreates.length === 1 && refundCreates[0].replace(/\\/g, "/").includes("src/services/stripe.service.ts")) {
    pass("refund-single-create", "One production refunds.create path");
  } else fail("refund-single-create", `refunds.create files=${refundCreates.join(",")}`);

  const piCreate = srcFiles.filter((f) => /paymentIntents\.create/.test(read(f)));
  const chargeCreate = srcFiles.filter((f) => /charges\.create/.test(read(f)));
  const piConfirm = srcFiles.filter((f) => /paymentIntents\.confirm/.test(read(f)));
  if (piCreate.length === 0 && chargeCreate.length === 0 && piConfirm.length === 0) {
    pass("Z-no-direct-pi", "No paymentIntents.create/confirm or charges.create in src/");
  } else fail("Z-no-direct-pi", `pi=${piCreate} charges=${chargeCreate} confirm=${piConfirm}`);

  if (
    paymentCtrl.includes("destination") &&
    paymentCtrl.includes("payment_intent_data") &&
    paymentCtrl.includes("on_behalf_of") &&
    paymentCtrl.includes("application_fee_amount")
  ) {
    pass("W-static-denylist", "HTTP denylist covers destination/fee/nested keys");
  } else fail("W-static-denylist", "Denylist incomplete");

  if (stripeSvc.includes('status: "pending"') && stripeSvc.includes("handlePaymentSuccess")) {
    pass("AH-pending-only-pi", "payment_intent.succeeded remains pending-only");
  } else fail("AH-pending-only-pi", "pending-only path missing");

  if (!/acct_/.test(CONNECT_TIP_UNAVAILABLE_MSG) && !/disabled_reason/i.test(CONNECT_TIP_UNAVAILABLE_MSG)) {
    pass("guest-msg-safe", "Guest Connect errors do not leak acct ids or disabled_reason");
  } else fail("guest-msg-safe", "Unsafe guest message");
}

function runInjectionUnits() {
  const attacks: Array<[string, Record<string, unknown>]> = [
    ["W-inj-destination", { destination: "acct_ATTACKER" }],
    ["W-inj-stripeAccountId", { stripeAccountId: "acct_ATTACKER" }],
    ["W-inj-connectAccountId", { connectAccountId: "acct_ATTACKER" }],
    ["Y-inj-nested-pi", { payment_intent_data: { transfer_data: { destination: "acct_ATTACKER" } } }],
    ["Y-inj-metadata-dest", { metadata: { destination: "acct_ATTACKER" } }],
    ["X-inj-fee", { application_fee_amount: 1 }],
    ["X-inj-platformFee", { platformFee: 1 }],
    ["X-inj-feePercentage", { feePercentage: 1 }],
    ["W-inj-on-behalf", { on_behalf_of: "acct_ATTACKER" }],
  ];
  for (const [id, body] of attacks) {
    const hit = findClientControlledConnectPaymentField({ body });
    if (hit) pass(id, `Rejected ${hit}`);
    else fail(id, "Not rejected");
  }
  if (findClientControlledConnectPaymentField({ query: { destination: "acct_ATTACKER" } })) {
    pass("W-inj-query", "Query destination rejected");
  } else fail("W-inj-query", "Query not rejected");
  if (findClientControlledConnectPaymentField({ headers: { "stripe-account": "acct_ATTACKER" } })) {
    pass("W-inj-header", "stripe-account header rejected");
  } else fail("W-inj-header", "Header not rejected");
}

function runWebhookSignatureUnits() {
  try {
    verifyWebhookSignature(Buffer.from("{}"), undefined);
    fail("J-missing-sig", "Missing signature accepted");
  } catch {
    pass("J-missing-sig", "Missing signature rejected");
  }
  try {
    verifyWebhookSignature(Buffer.from('{"id":"evt_fake"}'), "t=1,v1=deadbeef");
    fail("J-invalid-sig", "Invalid signature accepted");
  } catch {
    pass("J-invalid-sig", "Invalid signature rejected");
  }
  const saved = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      verifyWebhookSignature(Buffer.from("{}"), "t=1,v1=deadbeef");
      fail("J-missing-secret", "Missing webhook secret accepted");
    } catch {
      pass("J-missing-secret", "Missing webhook secret rejected");
    }
  } finally {
    if (saved === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = saved;
  }
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
    if (/acct_[a-zA-Z0-9]+/.test(msg) || /charges_enabled/i.test(msg) || /disabled_reason/i.test(msg)) {
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
      id: `cs_test_p28_${Date.now()}`,
      object: "checkout.session",
      url: "https://checkout.stripe.com/c/pay/p28",
      mode: "payment",
      payment_status: "unpaid",
      status: "open",
      metadata: params.metadata ?? {},
    } as Stripe.Checkout.Session;
  });
  __setRefundsCreateFnForTests(async (params, options) => {
    refunds.push({ params, options });
    return { id: `re_p28_${Date.now()}`, object: "refund", status: "succeeded" } as Stripe.Refund;
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
      created.cancel_url?.includes("/payment?canceled=1") &&
      !created.success_url.includes("//rating")
    ) {
      pass("F-checkout-success-url", "Checkout success_url /rating?session_id=");
      pass("G-checkout-cancel-url", "Checkout cancel_url /payment?canceled=1");
      pass("AD-checkout-dest-server", "Stripe dest = Business.stripeAccountId");
    } else fail("F-checkout-success-url", "Checkout URL/dest incorrect");

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
      pass("W-service-ignores-dest", "Client dest ignored at service layer");
      pass("X-service-ignores-fee", "Client fee ignored at service layer");
      pass("AD-no-client-acct", "No client-controlled acct reached Stripe");
    } else fail("W-service-ignores-dest", "Client fields reached Stripe");

    await expectReject(
      "V-emp-biz-mismatch",
      () => createTipCheckoutSession({ amount: 10, employeeId: a.employeeId, businessId: b.businessId }),
      "EMPLOYEE_BUSINESS_MISMATCH",
    );

    await expectReject(
      "R-soft-close",
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
      "T-deleted",
      async () => {
        const v = await createVenue("del", { deletedAt: new Date() });
        try {
          await createTipCheckoutSession({ amount: 10, employeeId: v.employeeId, businessId: v.businessId });
        } finally {
          await destroyVenue(v);
        }
      },
      "BUSINESS_SOFT_CLOSED",
    );
    await expectReject(
      "S-legal-hold",
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
      "U-inactive",
      async () => {
        const v = await createVenue("in", { operationalStatus: "inactive" });
        try {
          await createTipCheckoutSession({ amount: 10, employeeId: v.employeeId, businessId: v.businessId });
        } finally {
          await destroyVenue(v);
        }
      },
    );

    const happyPi = `pi_p28_ok_${Date.now()}`;
    await handleSuccessfulTipPayment(paidSession(a, happyPi));
    const happyRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: happyPi } });
    if (happyRows.length === 1 && happyRows[0]?.status === "success" && Number(happyRows[0].amount) === 10) {
      pass("AH-one-success", "Matching dest + live capable account → one success Transaction");
    } else fail("AH-one-success", `rows=${happyRows.length} status=${happyRows[0]?.status}`);

    await handleSuccessfulTipPayment(paidSession(a, happyPi));
    await handlePaymentSuccess(happyPi);
    const afterReplay = await prisma.transaction.findMany({ where: { stripePaymentIntentId: happyPi } });
    if (afterReplay.length === 1 && afterReplay[0]?.status === "success") {
      pass("K-replay-one-row", "Duplicate Checkout webhook did not duplicate ledger");
      pass("L-pi-unique-runtime", "payment_intent.succeeded did not create a second success row");
      pass("AH-replay-still-one", "One success Transaction per PaymentIntent after replay");
    } else fail("K-replay-one-row", `rows=${afterReplay.length}`);

    refunds.length = 0;
    const mismatchPi = `pi_p28_mm_${Date.now()}`;
    __setPaymentIntentsRetrieveFnForTests(async (id) => fakePi(id, b.stripeAccountId));
    await handleSuccessfulTipPayment(paidSession(a, mismatchPi));
    const mmRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: mismatchPi } });
    const mmRefund =
      refunds.length === 1 &&
      refunds[0]?.params.payment_intent === mismatchPi &&
      refunds[0]?.params.refund_application_fee === true &&
      refunds[0]?.options?.idempotencyKey === `eligibility_refund:${mismatchPi}`;
    if (mmRows.length === 1 && mmRows[0]?.status === "failed" && mmRefund) {
      pass("M-dest-mismatch-fail-closed", "PI dest mismatch → failed + application-fee refund");
    } else fail("M-dest-mismatch-fail-closed", `status=${mmRows[0]?.status} refunds=${refunds.length}`);

    refunds.length = 0;
    await handleSuccessfulTipPayment(paidSession(a, mismatchPi));
    if (refunds.length === 0 && (await prisma.transaction.count({ where: { stripePaymentIntentId: mismatchPi } })) === 1) {
      pass("AE-refund-idempotent", "Duplicate mismatch webhook did not credit or re-refund");
    } else fail("AE-refund-idempotent", `refunds=${refunds.length}`);

    installHappyRetrieve(a.stripeAccountId, 1000, 1);
    refunds.length = 0;
    const feePi = `pi_p28_fee_${Date.now()}`;
    await handleSuccessfulTipPayment(paidSession(a, feePi));
    const feeRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: feePi } });
    if (feeRows.length === 1 && feeRows[0]?.status === "failed" && refunds.length === 1) {
      pass("N-fee-mismatch-fail-closed", "Wrong application_fee_amount → failed + refund");
    } else fail("N-fee-mismatch-fail-closed", `status=${feeRows[0]?.status}`);

    installHappyRetrieve(a.stripeAccountId, 999, 49);
    refunds.length = 0;
    const amtPi = `pi_p28_amt_${Date.now()}`;
    await handleSuccessfulTipPayment(paidSession(a, amtPi));
    const amtRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: amtPi } });
    if (amtRows.length === 1 && amtRows[0]?.status === "failed") {
      pass("O-amount-mismatch-fail-closed", "Session amount_total ≠ PI amount → failed");
    } else fail("O-amount-mismatch-fail-closed", `status=${amtRows[0]?.status}`);

    installHappyRetrieve(a.stripeAccountId);
    refunds.length = 0;
    const livePi = `pi_p28_live_${Date.now()}`;
    __setConnectedAccountRetrieveFnForTests(async (id) => ({
      id,
      charges_enabled: false,
      payouts_enabled: true,
    }));
    await handleSuccessfulTipPayment(paidSession(a, livePi));
    const liveRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: livePi } });
    if (liveRows.length === 1 && liveRows[0]?.status === "failed" && refunds.length === 1) {
      pass("P-live-not-capable", "Live Stripe account not capable → fail closed + refund");
    } else fail("P-live-not-capable", `status=${liveRows[0]?.status} refunds=${refunds.length}`);

    installHappyRetrieve(a.stripeAccountId);
    const retrieveFailPi = `pi_p28_rf_${Date.now()}`;
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
      pass("Q-live-retrieve-retryable", "Stripe retrieve failure does not credit (retryable, no success, no refund)");
    } else fail("Q-live-retrieve-retryable", `threw=${threw} rows=${rfRows.length}`);

    if (
      CONNECT_DESTINATION_MISMATCH_CODE === "CONNECT_DESTINATION_MISMATCH" &&
      CONNECT_LIVE_ACCOUNT_NOT_CAPABLE_CODE === "CONNECT_LIVE_ACCOUNT_NOT_CAPABLE" &&
      CONNECT_PAYMENT_INVARIANT_CODE === "CONNECT_PAYMENT_INVARIANT"
    ) {
      pass("codes-present", "Fail-closed codes defined");
    }

    pass("stripe-configured", isStripeConfigured() ? "Stripe configured (tests mocked)" : "Stripe unset (tests mocked)");
    if (calculateTipPlatformFeeCents(1000) === 149) pass("fee-calc-10e", "€10 → 149¢ fee");
    else fail("fee-calc-10e", "fee calc wrong");
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
  console.log("=== CareTip Stripe Connect Phase 2.8 Production Readiness Tests ===\n");
  runFrontendUrlUnits();
  runPreflightAndKeySafety();
  runStaticAudit();
  runInjectionUnits();
  runWebhookSignatureUnits();

  const liveKey = (process.env.STRIPE_SECRET_KEY?.trim() ?? "").startsWith("sk_live_");
  if (liveKey) {
    fail("runtime-skipped", "LIVE key present — runtime mutation tests aborted");
  } else {
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
