/**
 * Stripe Connect Instant Payouts — mocked eligibility/create + static guards.
 * Run: npm run test:stripe-connect-instant-payout
 *
 * Does not create live Stripe Instant Payouts. Does not claim Dashboard 2.5% is configured.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import type Stripe from "stripe";
import {
  OnboardingVerificationStatus,
  Role,
  StripeConnectStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import * as connectController from "../src/controllers/connect.controller.js";
import {
  __resetInstantPayoutStripeFnsForTests,
  __setInstantPayoutStripeFnsForTests,
  createInstantPayoutForBusiness,
  getInstantPayoutEligibilityForBusiness,
} from "../src/services/stripeConnectInstantPayout.service.js";
import { StripeConnectError } from "../src/services/stripeConnect.service.js";
import {
  handleConnectPayoutEvent,
  isConnectPayoutEventType,
  __setListPayoutBalanceTransactionsFnForTests,
} from "../src/services/stripeConnectPayout.service.js";

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
  const passwordHash = await bcrypt.hash("InstantPayoutTest!23", 4);
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
  const stripeAccountId = acct === null ? null : (acct ?? `acct_ip_${s}`);
  const biz = await prisma.business.create({
    data: {
      name: `Instant ${s}`,
      slug: `instant-${s}`,
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
  await prisma.stripeConnectInstantPayoutRequest.deleteMany({ where: { businessId: v.businessId } }).catch(() => undefined);
  await prisma.stripeConnectPayout.deleteMany({ where: { businessId: v.businessId } }).catch(() => undefined);
  await prisma.employee.deleteMany({ where: { id: v.employeeId } }).catch(() => undefined);
  await prisma.business.deleteMany({ where: { id: v.businessId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [v.managerId, v.employeeUserId] } } }).catch(() => undefined);
}

function mockReq(overrides: {
  user?: { userId: string; id?: string } | undefined;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): Request {
  return {
    user: overrides.user,
    query: overrides.query ?? {},
    params: {},
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

function eligibleStripeFns(opts?: { net?: number; gross?: number; destination?: string }) {
  const destination = opts?.destination ?? "ba_instant_de_1";
  const gross = opts?.gross ?? 10_000;
  const net = opts?.net ?? 9_750;
  return {
    retrieveAccount: async () => ({ country: "DE", payouts_enabled: true, charges_enabled: true }),
    retrieveBalance: async () =>
      ({
        object: "balance",
        available: [{ amount: gross, currency: "eur" }],
        pending: [{ amount: 0, currency: "eur" }],
        instant_available: [
          {
            amount: gross,
            currency: "eur",
            net_available: [{ amount: net, destination, source_types: { card: net } }],
          },
        ],
      }) as unknown as Stripe.Balance,
    listExternalAccounts: async () =>
      ({
        object: "list",
        data: [
          {
            id: destination,
            object: "bank_account",
            last4: "4242",
            available_payout_methods: ["standard", "instant"],
          },
        ],
        has_more: false,
      }) as unknown as Stripe.ApiList<Stripe.BankAccount | Stripe.Card>,
  };
}

function runStatic() {
  const srcRoot = join(backendRoot, "src");
  const srcFiles = walkSrcTs(srcRoot);
  const observationBlob = srcFiles
    .filter((p) => !p.replace(/\\/g, "/").endsWith("services/stripeConnectInstantPayout.service.ts"))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  const instantSvc = read("src/services/stripeConnectInstantPayout.service.ts");
  const routes = read("src/routes/connect.routes.ts");
  const controller = read("src/controllers/connect.controller.ts");
  const webhook = read("src/webhooks/stripe.webhook.ts");
  const ui = read(join("..", "src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx"));
  const en = read(join("..", "src/i18n/locales/en.json"));
  const de = read(join("..", "src/i18n/locales/de.json"));
  const schema = read("prisma/schema.prisma");
  const mobilePkg = read(join("..", "mobile/package.json"));

  if (observationBlob.includes(".payouts.create(") || /\.payouts\.create\s*\(/.test(observationBlob)) {
    fail("static-create-isolated", "payouts.create leaked outside Instant service");
  } else if (instantSvc.includes('method: "instant"') && instantSvc.includes("payouts.create")) {
    pass("static-create-isolated", "payouts.create is Instant-only with method=instant");
  } else {
    fail("static-create-isolated", "Instant service missing payouts.create method=instant");
  }

  if (
    routes.includes('router.post("/connect/instant-payout"') &&
    routes.includes("postMyInstantPayout") &&
    controller.includes("rejectInstantPayoutClientSteering") &&
    !controller.includes("req.body.amount")
  ) {
    pass("static-routes", "JWT Instant routes reject client amount/destination steering");
  } else {
    fail("static-routes", "Instant routes/controller wiring incomplete");
  }

  if (
    instantSvc.includes("expand: [\"instant_available.net_available\"]") &&
    instantSvc.includes("available_payout_methods") &&
    instantSvc.includes("feeConfigured") &&
    !instantSvc.includes("0.025") &&
    !instantSvc.includes("* 0.025")
  ) {
    pass("static-fees", "Uses Stripe net_available; no homemade 2.5% subtraction");
  } else {
    fail("static-fees", "Fee implementation does not match Stripe application-fee model");
  }

  if (
    webhook.includes("handleConnectPayoutEvent") &&
    isConnectPayoutEventType("payout.paid") &&
    isConnectPayoutEventType("payout.failed")
  ) {
    pass("static-webhooks", "Existing Connect payout webhooks cover Instant lifecycle events");
  } else {
    fail("static-webhooks", "Payout webhook coverage missing");
  }

  if (
    schema.includes("model StripeConnectInstantPayoutRequest") &&
    schema.includes("model StripeConnectPayout") &&
    ui.includes("createInstantPayout") &&
    ui.includes("confirmCta") &&
    en.includes('"ctaAmount"') &&
    de.includes('"ctaAmount"') &&
    !en.includes("Platform Instant application fee") &&
    !de.includes("Platform Instant application fee") &&
    JSON.parse(en).common.cancel &&
    JSON.parse(de).common.cancel &&
    ui.includes("const sendCents = eligibility.instantAvailableNetCents") &&
    !ui.includes("showFee ? eligibility.instantAvailableGrossCents")
  ) {
    pass("static-ui-i18n", "Payouts panel + EN/DE Instant copy + common.cancel present");
  } else {
    fail("static-ui-i18n", "UI or i18n Instant keys missing");
  }

  if (mobilePkg.includes('"expo": "~54.0.0"') && mobilePkg.includes('"react-native": "0.81.5"')) {
    pass("static-expo", "Native app is Expo SDK 54 / RN 0.81.5; Instant remains web-only");
  } else {
    fail("static-expo", "Unexpected mobile package versions");
  }
}

async function runMocked() {
  __setListPayoutBalanceTransactionsFnForTests(async () => []);
  const venue = await createVenue("ok");
  const venueB = await createVenue("iso");
  const disconnected = await createVenue("disc", null);
  let createCalls = 0;
  try {
    __setInstantPayoutStripeFnsForTests({
      ...eligibleStripeFns(),
      createInstantPayout: async (args) => {
        createCalls += 1;
        if (args.amountCents !== 9_750) throw new Error(`unexpected amount ${args.amountCents}`);
        if (args.destination !== "ba_instant_de_1") throw new Error("unexpected destination");
        if (args.currency !== "eur") throw new Error("unexpected currency");
        return {
          id: "po_test_instant_ok",
          object: "payout",
          amount: args.amountCents,
          arrival_date: Math.floor(Date.now() / 1000),
          automatic: false,
          created: Math.floor(Date.now() / 1000),
          currency: "eur",
          description: null,
          destination: args.destination,
          failure_code: null,
          failure_message: null,
          livemode: false,
          metadata: {},
          method: "instant",
          source_type: "card",
          status: "pending",
          type: "bank_account",
        } as Stripe.Payout;
      },
    });

    const elig = await getInstantPayoutEligibilityForBusiness(venue.businessId);
    if (elig.eligible && elig.feeConfigured && elig.instantAvailableNetCents === 9_750 && elig.platformFeeCents === 250) {
      pass("elig-ok", "Eligible DE Express mock: net 9750, platform fee 250 from Stripe net_available");
    } else {
      fail("elig-ok", JSON.stringify(elig));
    }

    const created = await createInstantPayoutForBusiness({
      businessId: venue.businessId,
      idempotencyKey: "idem_instant_ok_aaaaaaaa",
    });
    const replay = await createInstantPayoutForBusiness({
      businessId: venue.businessId,
      idempotencyKey: "idem_instant_ok_aaaaaaaa",
    });
    if (createCalls === 1 && created.payout.id === replay.payout.id && created.payout.method === "instant") {
      pass("create-idempotent", "Same idempotency key does not call Stripe twice");
    } else {
      fail("create-idempotent", `calls=${createCalls} ids ${created.payout.id} vs ${replay.payout.id}`);
    }

    if (elig.balancesRetrieved === true && elig.availableCents === 10_000) {
      pass("elig-standard-balances", "Standard available comes from Stripe balance.available");
    } else {
      fail("elig-standard-balances", JSON.stringify(elig));
    }

    await prisma.business.update({
      where: { id: venue.businessId },
      data: { stripePayoutsEnabled: false },
    });
    __setInstantPayoutStripeFnsForTests({
      ...eligibleStripeFns(),
      retrieveAccount: async () => ({ country: "DE", payouts_enabled: false, charges_enabled: true }),
      retrieveBalance: async () =>
        ({
          object: "balance",
          available: [{ amount: 1234, currency: "eur" }],
          pending: [{ amount: 5678, currency: "eur" }],
          instant_available: [{ amount: 900, currency: "eur" }],
        }) as unknown as Stripe.Balance,
    });
    const disabledBal = await getInstantPayoutEligibilityForBusiness(venue.businessId);
    if (
      !disabledBal.eligible &&
      disabledBal.reason === "payouts_disabled" &&
      disabledBal.balancesRetrieved === true &&
      disabledBal.availableCents === 1234 &&
      disabledBal.pendingCents === 5678
    ) {
      pass("elig-payouts-disabled-keeps-standard-balances", "Instant-ineligible still returns Stripe available/pending");
    } else {
      fail("elig-payouts-disabled-keeps-standard-balances", JSON.stringify(disabledBal));
    }
    await prisma.business.update({
      where: { id: venue.businessId },
      data: { stripePayoutsEnabled: true },
    });

    __setInstantPayoutStripeFnsForTests({
      ...eligibleStripeFns(),
      createInstantPayout: async (args) => {
        createCalls += 1;
        return {
          id: "po_test_instant_ok",
          object: "payout",
          amount: args.amountCents,
          arrival_date: Math.floor(Date.now() / 1000),
          automatic: false,
          created: Math.floor(Date.now() / 1000),
          currency: "eur",
          description: null,
          destination: args.destination,
          failure_code: null,
          failure_message: null,
          livemode: false,
          metadata: {},
          method: "instant",
          source_type: "card",
          status: "pending",
          type: "bank_account",
        } as Stripe.Payout;
      },
    });

    const paidEvent = {
      id: `evt_ip_paid_${Date.now()}`,
      object: "event",
      api_version: "2025-02-24.acacia",
      created: Math.floor(Date.now() / 1000) + 5,
      type: "payout.paid",
      livemode: false,
      pending_webhooks: 1,
      request: null,
      account: venue.stripeAccountId,
      data: {
        object: {
          ...({} as Stripe.Payout),
          id: "po_test_instant_ok",
          object: "payout",
          amount: 9750,
          currency: "eur",
          status: "paid",
          method: "instant",
          created: Math.floor(Date.now() / 1000),
          arrival_date: Math.floor(Date.now() / 1000),
        },
      },
    } as Stripe.Event;
    const hook = await handleConnectPayoutEvent(paidEvent);
    const after = await prisma.stripeConnectPayout.findFirst({
      where: { stripePayoutId: "po_test_instant_ok", businessId: venue.businessId },
    });
    if (hook.matched && after?.status === "paid") {
      pass("webhook-paid", "Existing payout.paid handler updates Instant payout status");
    } else {
      fail("webhook-paid", `matched=${hook.matched} status=${after?.status}`);
    }

    const disc = await getInstantPayoutEligibilityForBusiness(disconnected.businessId);
    if (!disc.eligible && disc.reason === "not_connected") {
      pass("elig-disconnected", "No acct_ → not_connected");
    } else {
      fail("elig-disconnected", JSON.stringify(disc));
    }

    __setInstantPayoutStripeFnsForTests({
      ...eligibleStripeFns(),
      listExternalAccounts: async () =>
        ({
          object: "list",
          data: [
            {
              id: "ba_standard_only",
              object: "bank_account",
              last4: "0000",
              available_payout_methods: ["standard"],
            },
          ],
          has_more: false,
        }) as unknown as Stripe.ApiList<Stripe.BankAccount | Stripe.Card>,
      retrieveBalance: async () =>
        ({
          object: "balance",
          available: [{ amount: 5000, currency: "eur" }],
          pending: [],
          instant_available: [{ amount: 5000, currency: "eur" }],
        }) as unknown as Stripe.Balance,
    });
    const noDest = await getInstantPayoutEligibilityForBusiness(venueB.businessId);
    if (!noDest.eligible && noDest.reason === "no_instant_destination") {
      pass("elig-no-instant-method", "standard-only external account is not Instant-eligible");
    } else {
      fail("elig-no-instant-method", JSON.stringify(noDest));
    }

    try {
      await createInstantPayoutForBusiness({
        businessId: venueB.businessId,
        idempotencyKey: "idem_instant_fail_bbbbbbbb",
      });
      fail("create-ineligible", "ineligible create should throw");
    } catch (err) {
      if (err instanceof StripeConnectError && String(err.code).includes("NO_INSTANT_DESTINATION")) {
        pass("create-ineligible", "Create blocked without Instant destination");
      } else {
        fail("create-ineligible", String(err));
      }
    }

    __setInstantPayoutStripeFnsForTests({
      retrieveAccount: async () => ({ country: "BR", payouts_enabled: true, charges_enabled: true }),
      retrieveBalance: async () =>
        ({
          object: "balance",
          available: [{ amount: 2222, currency: "eur" }],
          pending: [{ amount: 1111, currency: "eur" }],
          instant_available: [],
        }) as unknown as Stripe.Balance,
      listExternalAccounts: async () =>
        ({ object: "list", data: [], has_more: false }) as unknown as Stripe.ApiList<Stripe.BankAccount | Stripe.Card>,
    });
    const br = await getInstantPayoutEligibilityForBusiness(venueB.businessId);
    if (
      !br.eligible &&
      br.reason === "country_unsupported" &&
      br.balancesRetrieved === true &&
      br.availableCents === 2222 &&
      br.pendingCents === 1111
    ) {
      pass("elig-country", "Unsupported connected-account country is not treated as eligible");
    } else {
      fail("elig-country", JSON.stringify(br));
    }

    const resSteer = mockRes();
    await connectController.postMyInstantPayout(
      mockReq({
        user: { userId: venue.managerId },
        body: { idempotencyKey: "idem_steer_cccccccccccc", amountCents: 1, stripeAccountId: venueB.stripeAccountId },
      }),
      resSteer,
    );
    if (resSteer.statusCode === 400) {
      pass("http-steering", "Client amount/account steering rejected");
    } else {
      fail("http-steering", `status=${resSteer.statusCode}`);
    }

    const resUnauth = mockRes();
    await connectController.getMyInstantPayoutEligibility(mockReq({}), resUnauth);
    if (resUnauth.statusCode === 401) {
      pass("http-unauth", "Eligibility requires authentication");
    } else {
      fail("http-unauth", `status=${resUnauth.statusCode}`);
    }

    const resEmp = mockRes();
    await connectController.getMyInstantPayoutEligibility(
      mockReq({ user: { userId: venue.employeeUserId } }),
      resEmp,
    );
    if (resEmp.statusCode === 404) {
      pass("http-employee", "Employee JWT has no manager Business Instant eligibility");
    } else {
      fail("http-employee", `status=${resEmp.statusCode} body=${JSON.stringify(resEmp.body)}`);
    }
  } finally {
    __setListPayoutBalanceTransactionsFnForTests(null);
    __resetInstantPayoutStripeFnsForTests();
    await destroyVenue(venue);
    await destroyVenue(venueB);
    await destroyVenue(disconnected);
  }
}

async function main() {
  runStatic();
  await runMocked();
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id} — ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
