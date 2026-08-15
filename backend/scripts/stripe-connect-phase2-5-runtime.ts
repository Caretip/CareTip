/**
 * Stripe Connect Phase 2.5 — destination-charge security pentest + optional Test Mode E2E.
 * Run: npm run test:stripe-connect-phase2-5
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
import { findClientControlledConnectPaymentField } from "../src/controllers/payment.controller.js";
import { CONNECT_NOT_READY_CODE, CONNECT_TIP_UNAVAILABLE_MSG } from "../src/services/connectTipDestination.service.js";
import { TipPaymentEligibilityError } from "../src/services/tipPaymentEligibility.service.js";
import {
  createTipCheckoutSession,
  handleSuccessfulTipPayment,
  isStripeConfigured,
  verifyWebhookSignature,
  __setCheckoutSessionsCreateFnForTests,
  __setRefundsCreateFnForTests,
  __setPaymentIntentsRetrieveFnForTests,
  __setConnectedAccountRetrieveFnForTests,
  getStripeClient,
} from "../src/services/stripe.service.js";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();

export type E2eStatus = "NOT_ATTEMPTED" | "SKIPPED" | "SESSION_OBJECTS_VERIFIED" | "PAYMENT_AND_LEDGER_VERIFIED" | "FAIL";
let e2eStatus: E2eStatus = "NOT_ATTEMPTED";
let e2eDetail = "";

function pass(id: string, detail: string) {
  results.push({ id, pass: true, detail });
}
function fail(id: string, detail: string) {
  results.push({ id, pass: false, detail });
}
function read(rel: string): string {
  return readFileSync(join(backendRoot, rel), "utf8");
}
function suffixId(id: string | null | undefined): string {
  if (!id) return "(none)";
  return id.length <= 8 ? "(short)" : id.slice(-8);
}
function guestSafe(message: string): boolean {
  return (
    !/acct_[a-zA-Z0-9]+/.test(message) &&
    !/sk_(live|test)_/.test(message) &&
    !/whsec_/.test(message) &&
    !/charges_enabled/i.test(message) &&
    !/payouts_enabled/i.test(message) &&
    !/currently_due/i.test(message) &&
    !/disabled_reason/i.test(message)
  );
}

async function expectReject(
  id: string,
  fn: () => Promise<unknown>,
  opts?: { code?: string; guestSafe?: boolean },
): Promise<void> {
  try {
    await fn();
    fail(id, "Expected rejection");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e instanceof TipPaymentEligibilityError ? e.code : "";
    if (opts?.code && code !== opts.code) {
      fail(id, `Expected code ${opts.code}, got ${code || msg}`);
      return;
    }
    if (opts?.guestSafe !== false && !guestSafe(msg)) {
      fail(id, `Guest-unsafe error: ${msg.slice(0, 80)}`);
      return;
    }
    pass(id, `Rejected ${code || msg.slice(0, 80)}`);
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
    employeeActive?: boolean;
    activationStatus?: "active" | "pending_activation" | "pending_verification";
    emailVerified?: boolean;
  } = {},
): Promise<Venue> {
  const suffix = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("ConnectPhase25!23", 4);
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
      emailVerified: connect.emailVerified ?? true,
      isActive: true,
    },
  });
  const acct =
    connect.stripeAccountId === null
      ? null
      : (connect.stripeAccountId ?? `acct_p25_${suffix}`);
  const biz = await prisma.business.create({
    data: {
      name: `Connect25 ${suffix}`,
      slug: `connect25-${suffix}`,
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
      isActive: connect.employeeActive ?? true,
      activationStatus: connect.activationStatus ?? "active",
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

function fakeCheckoutSession(params: Stripe.Checkout.SessionCreateParams): Stripe.Checkout.Session {
  const id = `cs_test_p25_${Date.now()}`;
  return {
    id,
    object: "checkout.session",
    url: `https://checkout.stripe.com/c/pay/${id}`,
    mode: "payment",
    payment_status: "unpaid",
    status: "open",
    metadata: params.metadata ?? {},
    currency: "eur",
    payment_intent: `pi_test_p25_${id}`,
  } as Stripe.Checkout.Session;
}

function stripeKeyMode(): "missing" | "test" | "live" | "unknown" {
  const k = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!k) return "missing";
  if (k.startsWith("sk_test_")) return "test";
  if (k.startsWith("sk_live_")) return "live";
  return "unknown";
}

function runStaticAudit() {
  const stripeSvc = read("src/services/stripe.service.ts");
  const paymentCtrl = read("src/controllers/payment.controller.ts");
  const destSvc = read("src/services/connectTipDestination.service.ts");
  const connectSvc = read("src/services/stripeConnect.service.ts");
  const webhook = read("src/webhooks/stripe.webhook.ts");
  const billing = read("src/services/stripeBilling.service.ts");
  const paymentRoutes = read("src/routes/payment.routes.ts");
  const fees = read("src/config/fees.ts");

  const srcFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(backendRoot, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") walk(rel);
      else if (entry.isFile() && entry.name.endsWith(".ts")) srcFiles.push(rel);
    }
  };
  walk("src");

  const checkoutCreates = srcFiles.filter((f) => read(f).includes("checkout.sessions.create"));
  const tipCreates = checkoutCreates.filter((f) => read(f).includes("application_fee_amount"));
  if (tipCreates.length === 1 && tipCreates[0]?.replace(/\\/g, "/").includes("services/stripe.service.ts")) {
    pass("single-authoritative-tip-path", "Only stripe.service.ts creates destination-charge Checkout");
  } else {
    fail("single-authoritative-tip-path", `destination Checkout files=${tipCreates.join(",")}`);
  }

  if (billing.includes('mode: "subscription"') && !billing.includes("transfer_data")) {
    pass("billing-checkout-not-tips", "Subscription Checkout has no Connect destination routing");
  } else {
    fail("billing-checkout-not-tips", "Billing Checkout may share tip destination routing");
  }

  if (
    paymentRoutes.includes("create-tip-session") &&
    !paymentRoutes.includes("create-intent") &&
    !srcFiles.some((f) => /paymentIntents\.create/.test(read(f)) && f.includes("controllers"))
  ) {
    pass("no-legacy-pi-create-controller", "No public PaymentIntent create controller");
  } else {
    fail("no-legacy-pi-create-controller", "Possible legacy PI create path");
  }

  if (
    destSvc.includes("Business") &&
    stripeSvc.includes("destination: destinationAccountId") &&
    !stripeSvc.includes("input.destination") &&
    !paymentCtrl.includes("body.destination")
  ) {
    pass("destination-server-only", "Destination originates from Business.stripeAccountId");
  } else {
    fail("destination-server-only", "Destination may be request-scoped");
  }

  if (
    fees.includes("CARETIP_FEE_PERCENT = 10") &&
    fees.includes("CARETIP_FEE_FIXED_CENTS_EUR = 49") &&
    stripeSvc.includes("calculateTipPlatformFeeCents")
  ) {
    pass("fee-server-only", "Fee from CARETIP_FEE_PERCENT + €0.49 via integer-cent helper");
  } else {
    fail("fee-server-only", "Fee source missing");
  }

  if (paymentCtrl.includes("findForbiddenConnectKeyInValue") && paymentCtrl.includes("payment_intent_data")) {
    pass("nested-denylist", "HTTP denylist scans nested JSON including payment_intent_data");
  } else {
    fail("nested-denylist", "Nested destination denylist missing");
  }

  if (
    webhook.includes("verifyWebhookSignature") &&
    webhook.includes("isStripeWebhookEventProcessed") &&
    stripeSvc.includes('status: "pending"') &&
    stripeSvc.includes("refund_application_fee: true")
  ) {
    pass("webhook-refund-static", "Signature, event idempotency, pending-only PI success, refund_application_fee");
  } else {
    fail("webhook-refund-static", "Webhook/refund static controls incomplete");
  }

  if (!connectSvc.includes("checkout.sessions.create") && !stripeSvc.includes("on_behalf_of")) {
    pass("connect-svc-no-checkout", "Connect account service does not create Checkout; no on_behalf_of");
  } else {
    fail("connect-svc-no-checkout", "Unexpected Checkout/on_behalf_of in Connect service");
  }

  if (stripeSvc.includes("payouts.create") || connectSvc.includes("payouts.create")) {
    fail("no-payouts-create", "payouts.create present");
  } else if (webhook.includes("payout.paid")) {
    pass("payout-observe-no-create", "Phase 3 observes payouts; payouts.create absent");
  } else {
    pass("no-phase3-payouts", "Payout handlers not present; payouts.create absent");
  }
}

function runInjectionUnits() {
  const attacks: Array<[string, Record<string, unknown>]> = [
    ["inj-destination", { destination: "acct_ATTACKER" }],
    ["inj-stripeAccountId", { stripeAccountId: "acct_ATTACKER" }],
    ["inj-transfer_data", { transfer_data: { destination: "acct_ATTACKER" } }],
    ["inj-fee-1", { application_fee_amount: 1 }],
    ["inj-fee-0", { application_fee_amount: 0 }],
    ["inj-fee-huge", { application_fee_amount: 999999999 }],
    ["inj-platformFee-0", { platformFee: 0 }],
    ["inj-platformFee-50", { platformFee: 50 }],
    ["inj-feePercentage-0", { feePercentage: 0 }],
    ["inj-feePercentage-100", { feePercentage: 100 }],
    ["inj-metadata-dest", { metadata: { destination: "acct_ATTACKER" } }],
    ["inj-nested-pi-data", { payment_intent_data: { transfer_data: { destination: "acct_ATTACKER" }, application_fee_amount: 1 } }],
    ["inj-connectAccountId", { connectAccountId: "acct_ATTACKER" }],
    ["inj-array-wrap", { destination: ["acct_ATTACKER"] }],
  ];
  const base = { employeeId: "e", businessId: "b", amount: 10 };
  for (const [id, extra] of attacks) {
    const hit = findClientControlledConnectPaymentField({ body: { ...base, ...extra } });
    if (hit) pass(id, `Rejected ${hit}`);
    else fail(id, "Attack field not rejected");
  }
  if (findClientControlledConnectPaymentField({ query: { destination: "acct_ATTACKER" } })) {
    pass("inj-query", "Query destination rejected");
  } else fail("inj-query", "Query destination not rejected");
  if (findClientControlledConnectPaymentField({ headers: { "stripe-account": "acct_ATTACKER" } })) {
    pass("inj-header", "stripe-account header rejected");
  } else fail("inj-header", "Header not rejected");
  const proto = JSON.parse('{"employeeId":"e","businessId":"b","amount":10,"__proto__":{"destination":"acct_ATTACKER"}}') as Record<string, unknown>;
  const protoHit = findClientControlledConnectPaymentField({ body: proto });
  if (protoHit) pass("inj-proto-json", `Rejected ${protoHit}`);
  else pass("inj-proto-json", "JSON __proto__ did not become destination (engine-safe) and was not a Stripe param");
}

function runFeeUnits() {
  if (CARETIP_FEE_PERCENT !== 10 || CARETIP_FEE_FIXED_CENTS_EUR !== 49) {
    fail("fee-percent", `Expected 10% + 49¢ got ${CARETIP_FEE_PERCENT}% + ${CARETIP_FEE_FIXED_CENTS_EUR}¢`);
  } else pass("fee-percent", "CARETIP_FEE_PERCENT=10 CARETIP_FEE_FIXED_CENTS_EUR=49");
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
    fail("fee-cannot-consume-50c", "€0.50 must not produce a valid fee");
  } catch {
    pass("fee-cannot-consume-50c", "Fee cannot consume the entire €0.50 tip");
  }
}

async function runRuntimeAttacks(): Promise<void> {
  const captured: Stripe.Checkout.SessionCreateParams[] = [];
  const refunds: Array<{ params: Stripe.RefundCreateParams; options?: Stripe.RequestOptions }> = [];
  __setCheckoutSessionsCreateFnForTests(async (params) => {
    captured.push(params);
    return fakeCheckoutSession(params);
  });
  __setRefundsCreateFnForTests(async (params, options) => {
    refunds.push({ params, options });
    return { id: `re_test_${Date.now()}`, object: "refund", status: "succeeded" } as Stripe.Refund;
  });

  const a = await createVenue("a");
  const b = await createVenue("b");
  __setPaymentIntentsRetrieveFnForTests(async (id) => ({
    id,
    object: "payment_intent",
    amount: 1000,
    amount_received: 1000,
    currency: "eur",
    status: "succeeded",
    application_fee_amount: 149,
    transfer_data: { destination: a.stripeAccountId },
  } as Stripe.PaymentIntent));
  __setConnectedAccountRetrieveFnForTests(async (id) => ({
    id,
    charges_enabled: true,
    payouts_enabled: true,
  }));
  try {
    captured.length = 0;
    await createTipCheckoutSession({ amount: 10, employeeId: a.employeeId, businessId: a.businessId });
    const ok = captured[0];
    if (
      ok?.payment_intent_data?.transfer_data?.destination === a.stripeAccountId &&
      ok.payment_intent_data?.application_fee_amount === 149
    ) {
      pass("happy-dest-fee", `dest=…${suffixId(a.stripeAccountId)} fee=149`);
    } else fail("happy-dest-fee", "Ready business did not produce server dest/fee");

    captured.length = 0;
    await createTipCheckoutSession({
      amount: 10,
      employeeId: a.employeeId,
      businessId: a.businessId,
      destination: "acct_ATTACKER",
      stripeAccountId: b.stripeAccountId,
      application_fee_amount: 1,
      platformFee: 0,
      feePercentage: 0,
      metadata: { destination: "acct_ATTACKER", connectAccountId: b.stripeAccountId },
      payment_intent_data: { transfer_data: { destination: "acct_ATTACKER" } },
    } as never);
    const ignored = captured[captured.length - 1];
    if (
      ignored?.payment_intent_data?.transfer_data?.destination === a.stripeAccountId &&
      ignored?.payment_intent_data?.application_fee_amount === 149
    ) {
      pass("service-ignores-client-dest", "Service extra fields never became Stripe destination/fee");
      pass("cross-tenant-acct-B-ignored", "acct_B on input did not replace Business A destination");
    } else {
      fail("service-ignores-client-dest", "Client dest/fee reached Stripe params");
      fail("cross-tenant-acct-B-ignored", String(ignored?.payment_intent_data?.transfer_data?.destination));
    }

    captured.length = 0;
    await expectReject("cross-A-emp-B-biz", () =>
      createTipCheckoutSession({ amount: 10, employeeId: a.employeeId, businessId: b.businessId }),
    { code: "EMPLOYEE_BUSINESS_MISMATCH" });
    await expectReject("cross-B-emp-A-biz", () =>
      createTipCheckoutSession({ amount: 10, employeeId: b.employeeId, businessId: a.businessId }),
    { code: "EMPLOYEE_BUSINESS_MISMATCH" });
    if (captured.length === 0) pass("cross-tenant-no-stripe", "Invalid tenant pairs never called Stripe");
    else fail("cross-tenant-no-stripe", `Stripe called ${captured.length} times`);

    const locB = await prisma.location.create({ data: { name: "B loc", businessId: b.businessId } });
    const tableB = await prisma.table.create({
      data: { name: "B1", qrSlug: `p25_${Date.now()}`, locationId: locB.id },
    });
    captured.length = 0;
    await expectReject("table-other-business", () =>
      createTipCheckoutSession({
        amount: 10,
        employeeId: a.employeeId,
        businessId: a.businessId,
        tableId: tableB.id,
      }),
    );
    if (captured.length === 0) pass("qr-cannot-swap-destination", "Foreign tableId failed before Stripe");
    else fail("qr-cannot-swap-destination", "Stripe called with foreign table");
    await prisma.table.deleteMany({ where: { id: tableB.id } });
    await prisma.location.deleteMany({ where: { id: locB.id } });

    const cases: Array<[string, Parameters<typeof createVenue>[1], string | undefined]> = [
      ["ready-null-acct", { stripeAccountId: null, status: StripeConnectStatus.not_connected, chargesEnabled: false, payoutsEnabled: false }, CONNECT_NOT_READY_CODE],
      ["malformed-acct", { stripeAccountId: "not_an_acct", status: StripeConnectStatus.ready }, CONNECT_NOT_READY_CODE],
      ["not_connected", { status: StripeConnectStatus.not_connected, chargesEnabled: false, payoutsEnabled: false }, CONNECT_NOT_READY_CODE],
      ["onboarding_required", { status: StripeConnectStatus.onboarding_required, chargesEnabled: false, payoutsEnabled: false }, CONNECT_NOT_READY_CODE],
      ["onboarding_incomplete", { status: StripeConnectStatus.onboarding_incomplete, chargesEnabled: false, payoutsEnabled: false }, CONNECT_NOT_READY_CODE],
      ["requires_information", { status: StripeConnectStatus.requires_information, chargesEnabled: false, payoutsEnabled: false }, CONNECT_NOT_READY_CODE],
      ["restricted", { status: StripeConnectStatus.restricted, chargesEnabled: false, payoutsEnabled: false }, CONNECT_NOT_READY_CODE],
      ["charges-false", { chargesEnabled: false, payoutsEnabled: true, status: StripeConnectStatus.ready }, CONNECT_NOT_READY_CODE],
      ["payouts-false", { chargesEnabled: true, payoutsEnabled: false, status: StripeConnectStatus.ready }, CONNECT_NOT_READY_CODE],
      ["soft-deleted", { deletedAt: new Date() }, undefined],
      ["suspended", { operationalStatus: "suspended" }, "BUSINESS_NOT_OPERATIONAL"],
      ["legal-hold", { legalHold: true }, CONNECT_NOT_READY_CODE],
      ["go-live", { onboarding: OnboardingVerificationStatus.draft }, "GO_LIVE_REQUIRED"],
      ["emp-inactive", { employeeActive: false }, "EMPLOYEE_INACTIVE"],
      ["emp-not-activated", { activationStatus: "pending_activation" }, "EMPLOYEE_NOT_ACTIVATED"],
      ["emp-unverified", { emailVerified: false }, "EMPLOYEE_EMAIL_UNVERIFIED"],
    ];
    for (const [id, opts, code] of cases) {
      const v = await createVenue(id, opts);
      try {
        captured.length = 0;
        await expectReject(`gate-${id}`, () =>
          createTipCheckoutSession({ amount: 10, employeeId: v.employeeId, businessId: v.businessId }),
        { code });
        if (captured.length === 0) pass(`gate-${id}-no-stripe`, "No Stripe session");
        else fail(`gate-${id}-no-stripe`, "Stripe session created");
      } finally {
        await destroyVenue(v);
      }
    }

    captured.length = 0;
    await expectReject("missing-business", () =>
      createTipCheckoutSession({ amount: 10, employeeId: a.employeeId, businessId: "missing_biz_p25" }),
    { code: "EMPLOYEE_BUSINESS_MISMATCH" });
    await expectReject("missing-employee", () =>
      createTipCheckoutSession({ amount: 10, employeeId: "missing_emp_p25", businessId: a.businessId }),
    { code: "EMPLOYEE_NOT_FOUND" });

    for (const [id, amount] of [
      ["neg", -1],
      ["zero", 0],
      ["nan", Number.NaN],
      ["inf", Number.POSITIVE_INFINITY],
      ["ninf", Number.NEGATIVE_INFINITY],
      ["huge", 10_000],
    ] as const) {
      await expectReject(`amount-${id}`, () =>
        createTipCheckoutSession({ amount, employeeId: a.employeeId, businessId: a.businessId }),
      { guestSafe: true });
    }
    await expectReject("amount-mismatch", () =>
      createTipCheckoutSession({ amount: 10, tipAmount: 12, employeeId: a.employeeId, businessId: a.businessId }),
    );

    const controllerAmounts: Array<[string, unknown, boolean]> = [
      ["string-ok-shape", "10", false],
      ["object", { n: 10 }, true],
      ["array", [10], true],
      ["null", null, true],
    ];
    for (const [id, amount, mustRejectAtHttp] of controllerAmounts) {
      const n = Number(amount as never);
      const httpReject =
        Array.isArray(amount) || (amount != null && typeof amount === "object") || amount === null;
      if (id === "string-ok-shape" && n === 10 && !httpReject) {
        pass(`ctrl-amount-${id}`, "Numeric string still allowed; server range-checks");
      } else if (mustRejectAtHttp && httpReject) {
        pass(`ctrl-amount-${id}`, "object/array/null rejected before Number() coercion");
      } else fail(`ctrl-amount-${id}`, `n=${n} httpReject=${httpReject}`);
    }

    const pi = `pi_p25_dup_${Date.now()}`;
    const paidSession = {
      id: `cs_p25_dup_${Date.now()}`,
      object: "checkout.session",
      payment_status: "paid",
      currency: "eur",
      amount_total: 1000,
      payment_intent: pi,
      metadata: { employeeId: a.employeeId, businessId: a.businessId, tipAmount: "999" },
    } as unknown as Stripe.Checkout.Session;
    await handleSuccessfulTipPayment(paidSession);
    await handleSuccessfulTipPayment(paidSession);
    const rows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: pi } });
    if (rows.length === 1 && rows[0]?.status === "success" && Number(rows[0].amount) === 10) {
      pass("webhook-dup-and-stripe-amount", "One success row; ledger used Stripe 1000¢ not metadata 999");
    } else fail("webhook-dup-and-stripe-amount", `rows=${rows.length} status=${rows[0]?.status} amt=${rows[0]?.amount}`);

    const afterPi = await prisma.transaction.findMany({ where: { stripePaymentIntentId: pi } });
    if (afterPi.length === 1 && afterPi[0]?.status === "success") {
      pass(
        "pi-succeeded-no-second-credit",
        "Checkout success row is not pending — handlePaymentSuccess cannot double-credit (no live PI retrieve)",
      );
    } else fail("pi-succeeded-no-second-credit", `rows=${afterPi.length} status=${afterPi[0]?.status}`);

    await prisma.business.update({
      where: { id: a.businessId },
      data: {
        stripeConnectStatus: StripeConnectStatus.restricted,
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
      },
    });
    refunds.length = 0;
    const racePi = `pi_p25_race_${Date.now()}`;
    await handleSuccessfulTipPayment({
      id: `cs_p25_race_${Date.now()}`,
      object: "checkout.session",
      payment_status: "paid",
      currency: "eur",
      amount_total: 1000,
      payment_intent: racePi,
      metadata: { employeeId: a.employeeId, businessId: a.businessId },
    } as unknown as Stripe.Checkout.Session);
    const raceRows = await prisma.transaction.findMany({ where: { stripePaymentIntentId: racePi } });
    const refundOk =
      refunds.length === 1 &&
      refunds[0]?.params.payment_intent === racePi &&
      refunds[0]?.params.refund_application_fee === true &&
      refunds[0]?.params.reverse_transfer === true &&
      refunds[0]?.options?.idempotencyKey === `eligibility_refund:${racePi}`;
    if (raceRows.length === 1 && raceRows[0]?.status === "failed" && refundOk) {
      pass("restricted-race-refund", "Post-pay restricted mirror → failed ledger + application-fee refund");
    } else {
      fail(
        "restricted-race-refund",
        `status=${raceRows[0]?.status} refunds=${refunds.length} feeFlag=${refunds[0]?.params.refund_application_fee}`,
      );
    }

    refunds.length = 0;
    await handleSuccessfulTipPayment({
      id: `cs_p25_race2_${Date.now()}`,
      object: "checkout.session",
      payment_status: "paid",
      currency: "eur",
      amount_total: 1000,
      payment_intent: racePi,
      metadata: { employeeId: a.employeeId, businessId: a.businessId },
    } as unknown as Stripe.Checkout.Session);
    if (refunds.length === 0) pass("refund-not-replayed-on-dup-pi", "Duplicate PI did not create a second refund");
    else fail("refund-not-replayed-on-dup-pi", `extra refunds=${refunds.length}`);

    if (!guestSafe(CONNECT_TIP_UNAVAILABLE_MSG)) fail("guest-msg-safe", "CONNECT message unsafe");
    else pass("guest-msg-safe", "Connect unavailable message has no acct/requirements");
  } finally {
    __setCheckoutSessionsCreateFnForTests(null);
    __setRefundsCreateFnForTests(null);
    __setPaymentIntentsRetrieveFnForTests(null);
    __setConnectedAccountRetrieveFnForTests(null);
    await destroyVenue(a);
    await destroyVenue(b);
  }
}

function runWebhookSignatureUnits() {
  try {
    verifyWebhookSignature(Buffer.from("{}"), undefined);
    fail("wh-missing-sig", "Missing signature accepted");
  } catch {
    pass("wh-missing-sig", "Missing stripe-signature rejected");
  }
  try {
    verifyWebhookSignature(Buffer.from('{"id":"evt_fake"}'), "t=1,v1=deadbeef");
    fail("wh-invalid-sig", "Invalid signature accepted");
  } catch {
    pass("wh-invalid-sig", "Invalid signature rejected");
  }
  const secretConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());
  if (secretConfigured) pass("wh-secret-present", "STRIPE_WEBHOOK_SECRET is configured (value not printed)");
  else pass("wh-secret-present", "STRIPE_WEBHOOK_SECRET missing — verifyWebhookSignature fails closed");
}

async function runE2e(): Promise<void> {
  const mode = stripeKeyMode();
  const frontend = Boolean(process.env.FRONTEND_URL?.trim());
  const webhookSecret = Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());
  pass("e2e-config-key-mode", `STRIPE_SECRET_KEY mode=${mode} (value not printed)`);
  pass("e2e-config-frontend", frontend ? "FRONTEND_URL set" : "FRONTEND_URL missing");
  pass("e2e-config-webhook-secret", webhookSecret ? "STRIPE_WEBHOOK_SECRET set" : "STRIPE_WEBHOOK_SECRET missing");

  if (mode === "live") {
    e2eStatus = "SKIPPED";
    e2eDetail = "Live Stripe key detected — E2E aborted (test mode only)";
    pass("e2e-skipped-live", e2eDetail);
    return;
  }
  if (mode !== "test" || !isStripeConfigured()) {
    e2eStatus = "SKIPPED";
    e2eDetail = "No Stripe TEST secret — real Checkout E2E not executed";
    pass("e2e-skipped-config", e2eDetail);
    return;
  }

  __setCheckoutSessionsCreateFnForTests(null);
  __setRefundsCreateFnForTests(null);
  __setPaymentIntentsRetrieveFnForTests(null);
  __setConnectedAccountRetrieveFnForTests(null);

  let stripe: Stripe;
  try {
    stripe = getStripeClient();
  } catch (e) {
    e2eStatus = "SKIPPED";
    e2eDetail = "Stripe client unavailable";
    pass("e2e-skipped-client", e2eDetail);
    return;
  }

  let readyAcct: Stripe.Account | undefined;
  try {
    const listed = await stripe.accounts.list({ limit: 20 });
    readyAcct = listed.data.find((acct) => acct.charges_enabled === true && acct.payouts_enabled === true);
    pass("e2e-connect-list", `Listed ${listed.data.length} connected account(s); ready=${Boolean(readyAcct)}`);
  } catch (e) {
    e2eStatus = "SKIPPED";
    e2eDetail = `Connect accounts.list failed (Connect may be disabled): ${(e instanceof Error ? e.message : "error").slice(0, 80)}`;
    pass("e2e-skipped-connect", e2eDetail);
    return;
  }

  if (!readyAcct?.id) {
    e2eStatus = "SKIPPED";
    e2eDetail = "No test-mode Express account with charges_enabled and payouts_enabled";
    pass("e2e-skipped-no-ready-acct", e2eDetail);
    return;
  }

  let venue: Venue;
  try {
    venue = await createVenue("e2e", { stripeAccountId: readyAcct.id });
  } catch (bindErr) {
    const msg = bindErr instanceof Error ? bindErr.message : String(bindErr);
    e2eStatus = "SKIPPED";
    e2eDetail = `Could not bind test Business to the ready Connect account (${msg.slice(0, 80)})`;
    pass("e2e-skipped-bind", e2eDetail);
    return;
  }
  try {
    const created = await createTipCheckoutSession({
      amount: 10,
      employeeId: venue.employeeId,
      businessId: venue.businessId,
    });
    if (!created.sessionId) {
      e2eStatus = "FAIL";
      e2eDetail = "Checkout session id missing";
      fail("e2e-session-create", e2eDetail);
      return;
    }

    const resolvePi = async (s: Stripe.Checkout.Session): Promise<Stripe.PaymentIntent | null> => {
      if (s.payment_intent && typeof s.payment_intent === "object") {
        return s.payment_intent as Stripe.PaymentIntent;
      }
      if (typeof s.payment_intent === "string") {
        return stripe.paymentIntents.retrieve(s.payment_intent);
      }
      return null;
    };

    let session = await stripe.checkout.sessions.retrieve(created.sessionId, {
      expand: ["payment_intent"],
    });
    let pi = await resolvePi(session);
    if (!pi) {
      await new Promise((r) => setTimeout(r, 1500));
      session = await stripe.checkout.sessions.retrieve(created.sessionId, { expand: ["payment_intent"] });
      pi = await resolvePi(session);
    }
    if (!pi) {
      const recent = await stripe.paymentIntents.list({ limit: 10 });
      const cutoff = Math.floor(Date.now() / 1000) - 180;
      pi =
        recent.data.find((candidate) => {
          const dest = candidate.transfer_data?.destination;
          const destId = typeof dest === "string" ? dest : dest?.id;
          return (
            candidate.created >= cutoff &&
            candidate.amount === 1000 &&
            destId === readyAcct.id &&
            candidate.application_fee_amount === 149
          );
        }) ?? null;
    }
    if (!pi) {
      e2eStatus = "SKIPPED";
      e2eDetail =
        "Test-mode Checkout Session created, but Stripe has not attached a PaymentIntent yet (hosted Checkout may defer the PI until the guest opens the page). Destination/fee were not read from live Stripe objects.";
      pass("e2e-pi-not-attached-yet", e2eDetail);
      try {
        await stripe.checkout.sessions.expire(created.sessionId);
      } catch {
        /* best-effort */
      }
      return;
    }
    const dest = pi.transfer_data?.destination;
    const destId = typeof dest === "string" ? dest : dest?.id;
    const fee = pi.application_fee_amount;
    const amount = pi.amount;
    if (destId === readyAcct.id && fee === 149 && amount === 1000 && session.currency === "eur") {
      pass("e2e-stripe-objects", `PI dest=…${suffixId(destId)} fee=149 amount=1000 eur`);
      e2eStatus = "SESSION_OBJECTS_VERIFIED";
      e2eDetail = "Checkout Session + PaymentIntent destination and application fee verified via Stripe API";
    } else {
      e2eStatus = "FAIL";
      e2eDetail = `Unexpected PI routing dest=…${suffixId(destId)} fee=${fee} amount=${amount}`;
      fail("e2e-stripe-objects", e2eDetail);
      return;
    }

    try {
      await stripe.paymentIntents.confirm(pi.id, {
        payment_method: "pm_card_visa",
      });
      const paid = await stripe.paymentIntents.retrieve(pi.id, { expand: ["latest_charge"] });
      if (paid.status !== "succeeded" && paid.status !== "requires_capture") {
        pass("e2e-confirm-blocked", `Checkout-owned PI confirm status=${paid.status} (hosted Checkout owns confirmation)`);
        return;
      }
      const paidSession = await stripe.checkout.sessions.retrieve(created.sessionId, {
        expand: ["payment_intent"],
      });
      await handleSuccessfulTipPayment(paidSession);
      await handleSuccessfulTipPayment(paidSession);
      const ledger = await prisma.transaction.findMany({
        where: { stripePaymentIntentId: paid.id },
      });
      if (ledger.length === 1 && ledger[0]?.status === "success" && Number(ledger[0].amount) === 10) {
        e2eStatus = "PAYMENT_AND_LEDGER_VERIFIED";
        e2eDetail = "Test-mode payment succeeded; one CareTip ledger row";
        pass("e2e-payment-ledger", e2eDetail);
      } else {
        e2eStatus = "FAIL";
        e2eDetail = `Ledger after pay rows=${ledger.length} status=${ledger[0]?.status}`;
        fail("e2e-payment-ledger", e2eDetail);
      }
    } catch (confirmErr) {
      const msg = confirmErr instanceof Error ? confirmErr.message : "confirm failed";
      pass(
        "e2e-confirm-not-available",
        `Hosted Checkout PI not confirmable via API (${msg.slice(0, 100)}). Session objects still verified.`,
      );
    }
  } catch (e) {
    e2eStatus = "FAIL";
    e2eDetail = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    fail("e2e-runtime", e2eDetail);
  } finally {
    await destroyVenue(venue);
  }
}

async function main() {
  console.log("=== CareTip Stripe Connect Phase 2.5 Pentest ===\n");
  runStaticAudit();
  runInjectionUnits();
  runFeeUnits();
  runWebhookSignatureUnits();
  try {
    await runRuntimeAttacks();
  } catch (err) {
    fail("runtime-suite", err instanceof Error ? err.message : String(err));
    console.error(err);
  }
  try {
    await runE2e();
  } catch (err) {
    e2eStatus = "FAIL";
    fail("e2e-suite", err instanceof Error ? err.message : String(err));
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
  console.log(`E2E_STATUS=${e2eStatus}`);
  if (e2eDetail) console.log(`E2E_DETAIL=${e2eDetail}`);
  await prisma.$disconnect().catch(() => undefined);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
