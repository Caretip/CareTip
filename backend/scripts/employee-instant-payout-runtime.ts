/**
 * Employee Instant Payout — mocked Stripe + HTTP steering.
 * Run: npm run test:employee-instant-payout
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import type Stripe from "stripe";
import { Role, StripeConnectStatus } from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS } from "../src/config/employeeInstantPayout.js";
import * as employeeConnectController from "../src/controllers/employeeConnect.controller.js";
import {
  createEmployeeInstantPayoutForUser,
  getEmployeeInstantPayoutEligibilityForUser,
} from "../src/services/employeeInstantPayout.service.js";
import {
  __resetInstantPayoutStripeFnsForTests,
  __setInstantPayoutStripeFnsForTests,
} from "../src/services/stripeConnectInstantPayout.service.js";
import { StripeConnectError } from "../src/services/stripeConnect.service.js";
import {
  __setEmployeeStripePayoutListFnForTests,
  listEmployeeStripeBankPayoutsForUser,
} from "../src/services/employeeStripeBankPayouts.service.js";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();

function pass(id: string, detail: string) {
  results.push({ id, pass: true, detail });
}
function fail(id: string, detail: string) {
  results.push({ id, pass: false, detail });
}

type Venue = {
  managerId: string;
  employeeUserId: string;
  otherUserId: string;
  businessId: string;
  employeeId: string;
  otherEmployeeId: string;
  stripeAccountId: string;
};

async function createVenue(): Promise<Venue> {
  const s = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("EmpInstant!23", 4);
  const manager = await prisma.user.create({
    data: { email: `mgr_eip_${s}@example.com`, passwordHash, role: Role.MANAGER, emailVerified: true },
  });
  const empUser = await prisma.user.create({
    data: { email: `emp_eip_${s}@example.com`, passwordHash, role: Role.EMPLOYEE, emailVerified: true, isActive: true },
  });
  const otherUser = await prisma.user.create({
    data: { email: `emp2_eip_${s}@example.com`, passwordHash, role: Role.EMPLOYEE, emailVerified: true, isActive: true },
  });
  const biz = await prisma.business.create({
    data: {
      name: `EIP ${s}`,
      slug: `eip-${s}`,
      userId: manager.id,
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
  const other = await prisma.employee.create({
    data: {
      name: `Other ${s}`,
      jobTitle: "Server",
      businessId: biz.id,
      userId: otherUser.id,
      isActive: true,
      activationStatus: "active",
    },
  });
  const stripeAccountId = `acct_eip_${s}`;
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: emp.id,
      stripeAccountId,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: other.id,
      stripeAccountId: `acct_eip_o_${s}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  return {
    managerId: manager.id,
    employeeUserId: empUser.id,
    otherUserId: otherUser.id,
    businessId: biz.id,
    employeeId: emp.id,
    otherEmployeeId: other.id,
    stripeAccountId,
  };
}

async function destroyVenue(v: Venue): Promise<void> {
  await prisma.employeeInstantPayoutRequest.deleteMany({ where: { employeeId: { in: [v.employeeId, v.otherEmployeeId] } } });
  await prisma.employeeTipPayable.deleteMany({ where: { employeeId: { in: [v.employeeId, v.otherEmployeeId] } } });
  await prisma.transaction.deleteMany({ where: { businessId: v.businessId } });
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: { in: [v.employeeId, v.otherEmployeeId] } } });
  await prisma.employee.deleteMany({ where: { businessId: v.businessId } });
  await prisma.business.deleteMany({ where: { id: v.businessId } });
  await prisma.user.deleteMany({ where: { id: { in: [v.managerId, v.employeeUserId, v.otherUserId] } } });
}

function mockReq(overrides: {
  user?: { userId: string; id?: string };
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

function eligibleFns(opts: { net: number; gross?: number; destination?: string }) {
  const destination = opts.destination ?? "ba_emp_instant_1";
  const gross = opts.gross ?? Math.round(opts.net / 0.975);
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
            net_available: [{ amount: opts.net, destination, source_types: { card: opts.net } }],
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
            last4: "1234",
            available_payout_methods: ["standard", "instant"],
          },
        ],
        has_more: false,
      }) as unknown as Stripe.ApiList<Stripe.BankAccount | Stripe.Card>,
  };
}

function runStatic() {
  const empSvc = readFileSync(join(backendRoot, "src/services/employeeInstantPayout.service.ts"), "utf8");
  const bizSvc = readFileSync(join(backendRoot, "src/services/stripeConnectInstantPayout.service.ts"), "utf8");
  const cfg = readFileSync(join(backendRoot, "src/config/employeeInstantPayout.ts"), "utf8");
  if (EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS === 3000 && cfg.includes("EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS")) {
    pass("min-constant", "Employee Instant floor is 3000 cents in config");
  } else {
    fail("min-constant", String(EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS));
  }
  if (!empSvc.includes("payouts.create") && bizSvc.includes('method: "instant"')) {
    pass("create-isolated", "Employee Instant reuses connected-account create; no extra payouts.create");
  } else {
    fail("create-isolated", "payouts.create isolation broken");
  }
  if (!empSvc.includes("* 0.025") && !empSvc.includes("0.025") && empSvc.includes("stripe_platform_pricing")) {
    pass("no-double-fee", "Employee Instant does not homemade-subtract 2.5%");
  } else {
    fail("no-double-fee", "fee calculation unexpected");
  }
  if (!empSvc.includes("ingestStripePayoutObjectForBusiness")) {
    pass("not-business-payout-table", "Employee Instant does not write StripeConnectPayout");
  } else {
    fail("not-business-payout-table", "business payout ingest leaked");
  }
  const instantCard = readFileSync(join(backendRoot, "../src/app/components/employee/EmployeeInstantPayoutCard.tsx"), "utf8");
  const instantUi = readFileSync(
    join(backendRoot, "../src/app/components/employee/employeeInstantPayoutPresentation.ts"),
    "utf8",
  );
  const instantApi = readFileSync(join(backendRoot, "../src/app/lib/api.ts"), "utf8");
  if (
    instantUi.includes('reason === "below_minimum"') &&
    instantUi.includes('return "threshold"') &&
    instantCard.includes("employeeInstantShowCta") &&
    instantCard.includes('data-instant-cta') &&
    instantCard.includes("disabled={!ctaEnabled}")
  ) {
    pass("ui-below-min-cta", "Connect Instant CTA stays visible when below minimum");
  } else {
    fail("ui-below-min-cta", "below-minimum CTA presentation missing");
  }
  if (
    !instantCard.includes("displayedFeeBps") &&
    instantUi.includes("Do not use displayedFeeBps") &&
    !instantCard.includes("* 0.025") &&
    !instantCard.includes("0.975")
  ) {
    pass("ui-no-second-fee", "Employee Instant UI does not use displayedFeeBps or homemade 2.5%");
  } else {
    fail("ui-no-second-fee", "frontend fee presentation unsafe");
  }
  const createSnippet = instantApi.slice(
    instantApi.indexOf("export async function createEmployeeInstantPayout"),
    instantApi.indexOf("export async function listEmployeeStripeBankPayouts"),
  );
  if (createSnippet.includes("body: JSON.stringify({ idempotencyKey })")) {
    pass("ui-no-client-steering", "Employee Instant POST body is idempotencyKey only");
  } else {
    fail("ui-no-client-steering", "client Instant POST contract changed");
  }
}

async function main() {
  runStatic();
  const venue = await createVenue();
  try {
    __setInstantPayoutStripeFnsForTests({
      ...eligibleFns({ net: 2999 }),
      createInstantPayout: async () => {
        throw new Error("should not create at 29.99");
      },
    });
    const under = await getEmployeeInstantPayoutEligibilityForUser(venue.employeeUserId);
    if (!under.eligible && under.reason === "below_minimum" && under.minPayoutCents === 3000) {
      pass("elig-29.99", "€29.99 is below employee Instant minimum");
    } else {
      fail("elig-29.99", JSON.stringify(under));
    }
    try {
      await createEmployeeInstantPayoutForUser({
        userId: venue.employeeUserId,
        idempotencyKey: "idem_emp_under_aaaaaaa1",
      });
      fail("create-29.99", "should reject");
    } catch (err) {
      if (err instanceof StripeConnectError && err.code.includes("BELOW_MINIMUM")) {
        pass("create-29.99", "Create rejected under €30");
      } else {
        fail("create-29.99", String(err));
      }
    }

    let created = 0;
    __setInstantPayoutStripeFnsForTests({
      ...eligibleFns({ net: 3000, gross: 3077 }),
      createInstantPayout: async (args) => {
        created += 1;
        if (args.destination !== "ba_emp_instant_1") throw new Error("wrong dest");
        if (args.amountCents !== 3000) throw new Error(`amount ${args.amountCents}`);
        return { id: "po_emp_30", amount: 3000, currency: "eur", status: "paid", method: "instant" } as Stripe.Payout;
      },
    });
    const atMin = await getEmployeeInstantPayoutEligibilityForUser(venue.employeeUserId);
    if (atMin.eligible && atMin.instantAvailableNetCents === 3000 && atMin.platformFeeCents === 77) {
      pass("elig-30.00", "€30.00 eligible using Stripe net_available");
    } else {
      fail("elig-30.00", JSON.stringify(atMin));
    }
    const first = await createEmployeeInstantPayoutForUser({
      userId: venue.employeeUserId,
      idempotencyKey: "idem_emp_30_bbbbbbbb",
    });
    const replay = await createEmployeeInstantPayoutForUser({
      userId: venue.employeeUserId,
      idempotencyKey: "idem_emp_30_bbbbbbbb",
    });
    if (first.payout.amountCents === 3000 && replay.payout.requestId === first.payout.requestId && created === 1) {
      pass("create-30-idempotent", "€30 create is idempotent");
    } else {
      fail("create-30-idempotent", JSON.stringify({ first, replay, created }));
    }

    __setInstantPayoutStripeFnsForTests({
      ...eligibleFns({ net: 3001, gross: 3078 }),
      createInstantPayout: async (args) => {
        created += 1;
        return {
          id: `po_emp_${args.amountCents}`,
          amount: args.amountCents,
          currency: "eur",
          status: "paid",
          method: "instant",
        } as Stripe.Payout;
      },
    });
    const over = await getEmployeeInstantPayoutEligibilityForUser(venue.employeeUserId);
    if (over.eligible && over.instantAvailableNetCents === 3001) {
      pass("elig-30.01", "€30.01 eligible");
    } else {
      fail("elig-30.01", JSON.stringify(over));
    }

    __setInstantPayoutStripeFnsForTests({
      retrieveAccount: async () => ({ country: "DE", payouts_enabled: true, charges_enabled: true }),
      retrieveBalance: async () =>
        ({
          object: "balance",
          available: [{ amount: 0, currency: "eur" }],
          pending: [],
          instant_available: [{ amount: 0, currency: "eur", net_available: [] }],
        }) as unknown as Stripe.Balance,
      listExternalAccounts: async () =>
        ({
          object: "list",
          data: [{ id: "ba_emp_instant_1", object: "bank_account", last4: "1234", available_payout_methods: ["instant"] }],
          has_more: false,
        }) as unknown as Stripe.ApiList<Stripe.BankAccount | Stripe.Card>,
    });
    const zero = await getEmployeeInstantPayoutEligibilityForUser(venue.employeeUserId);
    if (!zero.eligible && (zero.reason === "zero_balance" || zero.reason === "below_minimum")) {
      pass("elig-zero", "Zero Stripe Instant balance is not eligible");
    } else {
      fail("elig-zero", JSON.stringify(zero));
    }

    __setInstantPayoutStripeFnsForTests({
      ...eligibleFns({ net: 5000 }),
      createInstantPayout: async () => {
        throw Object.assign(new Error("stripe down"), { code: "api_error" });
      },
    });
    try {
      await createEmployeeInstantPayoutForUser({
        userId: venue.employeeUserId,
        idempotencyKey: "idem_emp_fail_cccccccc",
      });
      fail("stripe-failure", "should throw");
    } catch (err) {
      if (err instanceof StripeConnectError && err.httpStatus === 502) {
        pass("stripe-failure", "Stripe create failure mapped to 502");
      } else {
        fail("stripe-failure", String(err));
      }
    }

    const otherElig = await getEmployeeInstantPayoutEligibilityForUser(venue.otherUserId);
    if (otherElig.connected) {
      pass("wrong-employee-own-account", "Other employee resolves their own Stripe account, not Jordan’s");
    } else {
      fail("wrong-employee-own-account", JSON.stringify(otherElig));
    }

    const steer = mockRes();
    await employeeConnectController.postMyEmployeeInstantPayout(
      mockReq({
        user: { userId: venue.employeeUserId },
        body: {
          idempotencyKey: "idem_steer_eeeeeeeeeeee",
          destination: "ba_attacker",
          employeeId: venue.otherEmployeeId,
          stripeAccountId: venue.stripeAccountId,
          amount: 9999,
          fee: 250,
        },
      }),
      steer,
    );
    if (steer.statusCode === 400) {
      pass("http-steering", "Client destination/employee/amount rejected");
    } else {
      fail("http-steering", `status=${steer.statusCode}`);
    }

    const mgr = mockRes();
    await employeeConnectController.getMyEmployeeInstantPayout(
      mockReq({ user: { userId: venue.managerId } }),
      mgr,
    );
    if (mgr.statusCode === 400 || mgr.statusCode === 403 || mgr.statusCode === 404) {
      pass("http-manager-blocked", "Manager cannot use employee Instant as the employee");
    } else {
      fail("http-manager-blocked", `status=${mgr.statusCode} ${JSON.stringify(mgr.body)}`);
    }

    __setEmployeeStripePayoutListFnForTests(async (acct) => {
      if (acct !== venue.stripeAccountId) {
        return { object: "list", data: [], has_more: false } as unknown as Stripe.ApiList<Stripe.Payout>;
      }
      return {
        object: "list",
        has_more: false,
        data: [
          {
            id: "po_emp_hist_1",
            amount: 3000,
            currency: "eur",
            status: "paid",
            method: "instant",
            created: 1_700_000_000,
            arrival_date: 1_700_086_400,
          },
        ],
      } as unknown as Stripe.ApiList<Stripe.Payout>;
    });
    const ownHist = await listEmployeeStripeBankPayoutsForUser(venue.employeeUserId);
    const otherHist = await listEmployeeStripeBankPayoutsForUser(venue.otherUserId);
    if (ownHist.items.length === 1 && ownHist.items[0].amountCents === 3000 && otherHist.items.length === 0) {
      pass("history-own-only", "Employee sees only own Stripe payout list");
    } else {
      fail("history-own-only", JSON.stringify({ ownHist, otherHist }));
    }
    if (ownHist.items[0]?.arrivalDate === new Date(1_700_086_400 * 1000).toISOString()) {
      pass("history-arrival-date", "Bank payout list exposes Stripe arrival_date");
    } else {
      fail("history-arrival-date", JSON.stringify(ownHist.items[0]));
    }

    const emptyHist = mockRes();
    await employeeConnectController.getMyEmployeeStripeBankPayouts(
      mockReq({ user: { userId: venue.otherUserId }, query: { employeeId: venue.employeeId } }),
      emptyHist,
    );
    if (emptyHist.statusCode === 400) {
      pass("history-no-employeeId", "History rejects client employeeId");
    } else {
      fail("history-no-employeeId", `status=${emptyHist.statusCode}`);
    }

    const bizPayouts = await prisma.stripeConnectPayout.count({ where: { businessId: venue.businessId } });
    if (bizPayouts === 0) {
      pass("no-business-payout-rows", "Employee Instant did not create Business payout rows");
    } else {
      fail("no-business-payout-rows", String(bizPayouts));
    }
  } finally {
    __resetInstantPayoutStripeFnsForTests();
    __setEmployeeStripePayoutListFnForTests(null);
    await destroyVenue(venue);
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id} — ${r.detail}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
