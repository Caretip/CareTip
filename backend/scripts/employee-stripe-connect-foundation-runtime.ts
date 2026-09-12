/**
 * Employee Stripe Connect foundation — ownership, isolation, webhooks.
 * Run: npm run test:employee-stripe-connect-foundation
 *
 * Does not call live Stripe. Does not change Checkout money routing.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EmployeeTipPayableStatus, Role, StripeConnectStatus } from "@prisma/client";
import type Stripe from "stripe";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  attributeStripeConnectAccount,
} from "../src/services/connectAccountOwnership.service.js";
import {
  deriveEmployeeRecipientConnectStatus,
  buildEmployeeRecipientAccountsV2CreateParams,
  createEmployeeConnectAccountLink,
  createEmployeeConnectLoginLink,
  handleEmployeeConnectAccountUpdated,
  resolveActiveEmployeeForConnect,
  __setEmployeeCreateV2AccountFnForTests,
  __setEmployeeCreateLoginLinkFnForTests,
} from "../src/services/employeeStripeConnect.service.js";
import {
  __setCreateV2AccountLinkFnForTests,
  StripeConnectError,
} from "../src/services/stripeConnect.service.js";
import { handleConnectPayoutEvent } from "../src/services/stripeConnectPayout.service.js";
import { toEmployeePayoutConnectionState } from "../src/lib/employeePayoutConnectState.js";
import { employeePayableActivityCents } from "../src/services/employeeTipPayable.service.js";
import {
  employeePayoutPrimaryCta,
  employeePayoutUiPhase,
  isEmployeePayoutReady,
} from "../../src/app/components/employee/employeePayoutAccountPresentation.ts";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();

function pass(id: string, detail: string) {
  results.push({ id, pass: true, detail });
}
function fail(id: string, detail: string) {
  results.push({ id, pass: false, detail });
}
function read(relPath: string): string {
  return readFileSync(join(backendRoot, relPath), "utf8");
}

function runStaticGuards() {
  const checkout = read("src/services/stripe.service.ts");
  const fees = read("src/config/fees.ts");
  const instant = read("src/services/stripeConnectInstantPayout.service.ts");
  const empSvc = read("src/services/employeeStripeConnect.service.ts");
  const ctrl = read("src/controllers/employeeConnect.controller.ts");
  const routes = read("src/routes/employeeConnect.routes.ts");
  const webhook = read("src/webhooks/stripe.webhook.ts");
  const payoutSvc = read("src/services/stripeConnectPayout.service.ts");
  const schema = read("prisma/schema.prisma");

  if (
    checkout.includes("resolveTipCheckoutRouting") &&
    checkout.includes("transfer_data") &&
    checkout.includes("assertCapturedTipConnect") &&
    !checkout.includes("createInstantPayoutForEmployee")
  ) {
    pass("checkout-uses-server-routing", "Checkout destination is server-resolved (employee, business, or platform hold)");
  } else {
    fail("checkout-uses-server-routing", "Checkout routing helper missing");
  }

  if (fees.includes("CARETIP_FEE_PERCENT") && fees.includes("CARETIP_FEE_FIXED_CENTS_EUR")) {
    pass("tip-fee-files-present", "Tip fee module still present");
  } else {
    fail("tip-fee-files-present", "Fee config missing");
  }

  if (
    instant.includes("createInstantPayoutForBusiness") &&
    !instant.includes("createInstantPayoutForEmployee")
  ) {
    pass("business-instant-untouched", "Employee Instant Payout not added to Business Instant service");
  } else {
    fail("business-instant-untouched", "Business Instant Payout service unexpectedly changed for employees");
  }

  if (
    empSvc.includes("card_payments") === false &&
    empSvc.includes("stripe_transfers") &&
    empSvc.includes("caretip_employee_id")
  ) {
    pass("recipient-create-params", "Employee V2 create is recipient/transfers, not card_payments");
  } else {
    fail("recipient-create-params", "Employee create params are not recipient-only");
  }

  const params = buildEmployeeRecipientAccountsV2CreateParams({
    country: "DE",
    contactEmail: "a@b.c",
    displayName: "Ada",
    employeeId: "emp_1",
    businessId: "biz_1",
  });
  const cfg = params.configuration as { merchant?: unknown; recipient?: unknown };
  if (!cfg.merchant && cfg.recipient) {
    pass("no-merchant-config", "Employee Accounts v2 body has recipient, not merchant");
  } else {
    fail("no-merchant-config", JSON.stringify(Object.keys(cfg ?? {})));
  }

  if (
    ctrl.includes("CONNECT_CLIENT_ACCOUNT_FORBIDDEN") &&
    ctrl.includes("employeeId") &&
    ctrl.includes("returnUrl")
  ) {
    pass("client-steering-rejected", "Employee connect controller rejects client ids and URLs");
  } else {
    fail("client-steering-rejected", "Missing steering rejection");
  }

  if (routes.includes("requireRole(Role.EMPLOYEE)") && routes.includes("employee-connect")) {
    pass("employee-only-routes", "Employee connect routes require EMPLOYEE role");
  } else {
    fail("employee-only-routes", "Routes missing EMPLOYEE guard");
  }

  if (
    routes.includes("/employee-connect/payables") &&
    ctrl.includes("getMyEmployeePayableActivity") &&
    ctrl.includes("listEmployeePayableActivityForEmployee")
  ) {
    pass("employee-payable-activity-route", "Read-only employee-scoped payable activity endpoint");
  } else {
    fail("employee-payable-activity-route", "Missing payables GET");
  }

  const payableSvc = read("src/services/employeeTipPayable.service.ts");
  const listStart = payableSvc.indexOf("export async function listEmployeePayableActivityForEmployee");
  const listFn = listStart >= 0 ? payableSvc.slice(listStart, listStart + 1600) : "";
  if (
    listFn.includes("activityCents") &&
    !listFn.includes("stripeTransferId") &&
    !listFn.includes("stripeAccountId") &&
    !listFn.includes("stripeDestinationAccountId")
  ) {
    pass("employee-activity-no-secrets", "Payable activity DTO omits Transfer IDs and acct ids");
  } else {
    fail("employee-activity-no-secrets", "Activity list helper missing or leaks Stripe ids");
  }

  if (
    webhook.includes("attributeStripeConnectAccount") &&
    webhook.includes("handleEmployeeConnectAccountUpdated")
  ) {
    pass("webhook-attribution", "account.updated attributes Business vs Employee");
  } else {
    fail("webhook-attribution", "Webhook attribution missing");
  }

  if (payoutSvc.includes("persistEmployeeConnectPayout") && payoutSvc.includes("employee_payout")) {
    pass("payout-employee-not-business-row", "Employee payout events persist to EmployeeStripePayout, not Business");
  } else {
    fail("payout-employee-not-business-row", "Payout handler missing employee persist branch");
  }

  if (schema.includes("model EmployeeStripeAccount") && schema.includes("employee_stripe_accounts")) {
    pass("schema-employee-stripe-account", "Dedicated EmployeeStripeAccount model present");
  } else {
    fail("schema-employee-stripe-account", "Model missing");
  }

  if (schema.includes("model EmployeeStripePayout") && schema.includes("employee_stripe_payouts")) {
    pass("schema-employee-stripe-payout", "Dedicated EmployeeStripePayout observation model present");
  } else {
    fail("schema-employee-stripe-payout", "EmployeeStripePayout model missing");
  }

  const webNav = read("../src/app/components/employee/employeeDashboardNav.ts");
  const settingsPage = read("../src/app/pages/employee/EmployeeSettingsPage.tsx");
  const payoutsPage = read("../src/app/pages/employee/EmployeePayoutsPage.tsx");
  const connectPage = read("../src/app/pages/employee/EmployeePaymentsConnectPage.tsx");
  const historyPage = read("../src/app/pages/employee/EmployeePayoutHistoryPage.tsx");
  const appRoutes = read("../src/app/routes.tsx");
  if (
    webNav.includes("EMPLOYEE_PAYMENTS_CONNECT_HREF") &&
    webNav.includes("dashboardNav.employee.payments") &&
    webNav.includes("dashboardNav.employee.paymentsConnect") &&
    webNav.includes("dashboardNav.employee.paymentsHistory") &&
    appRoutes.includes("EmployeePaymentsConnectPage") &&
    appRoutes.includes("EmployeePayoutHistoryPage") &&
    appRoutes.includes("EmployeePayoutsPage") &&
    connectPage.includes("EmployeePayoutAccountCard") &&
    historyPage.includes("EmployeePayoutActivityList") &&
    historyPage.includes("EmployeeStripeBankPayoutList") &&
    payoutsPage.includes("EMPLOYEE_PAYMENTS_CONNECT_HREF") &&
    !settingsPage.includes("EmployeePayoutAccountCard") &&
    settingsPage.includes("/employee/payouts") &&
    empSvc.includes("/employee/payouts?payoutConnect=")
  ) {
    pass("payouts-nav-ia", "Payments Connect/History IA; Stripe return still /employee/payouts");
  } else {
    fail("payouts-nav-ia", "Employee Payments IA incomplete");
  }

  const ready = deriveEmployeeRecipientConnectStatus({
    hasAccount: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    currentlyDueCount: 0,
    pastDueCount: 0,
    disabledReason: null,
  });
  if (ready === StripeConnectStatus.ready) {
    pass("recipient-ready-without-charges", "Employee ready uses payouts/transfers, not charges_enabled");
  } else {
    fail("recipient-ready-without-charges", `status=${ready}`);
  }

  if (toEmployeePayoutConnectionState(StripeConnectStatus.ready, true) === "connected") {
    pass("neutral-connected-wording", "UI state is connected, not a routing claim");
  } else {
    fail("neutral-connected-wording", "Unexpected UI mapping");
  }

  if (toEmployeePayoutConnectionState(StripeConnectStatus.ready, true, false) === "action_required") {
    pass("ready-without-payouts-not-connected", "ready + payouts disabled is not shown as connected");
  } else {
    fail("ready-without-payouts-not-connected", "Expected action_required when payouts are disabled");
  }

  const none = employeePayoutUiPhase({
    loading: false,
    error: null,
    data: {
      connectionState: "not_connected",
      stripeConfigured: true,
      hasAccount: false,
      detailsSubmitted: false,
      payoutsEnabled: false,
      canOpenDashboard: false,
      updatedAt: null,
    },
  });
  const incomplete = employeePayoutUiPhase({
    loading: false,
    error: null,
    data: {
      connectionState: "setup_required",
      stripeConfigured: true,
      hasAccount: true,
      detailsSubmitted: false,
      payoutsEnabled: false,
      canOpenDashboard: true,
      updatedAt: null,
    },
  });
  const readyUi = employeePayoutUiPhase({
    loading: false,
    error: null,
    data: {
      connectionState: "connected",
      stripeConfigured: true,
      hasAccount: true,
      detailsSubmitted: true,
      payoutsEnabled: true,
      canOpenDashboard: true,
      updatedAt: null,
    },
  });
  const errUi = employeePayoutUiPhase({ loading: false, error: "fail", data: null });
  const loadUi = employeePayoutUiPhase({ loading: true, error: null, data: null });
  if (
    none === "not_connected" &&
    employeePayoutPrimaryCta(none) === "connect" &&
    incomplete === "setup_incomplete" &&
    employeePayoutPrimaryCta(incomplete) === "complete" &&
    readyUi === "ready" &&
    employeePayoutPrimaryCta(readyUi) === "update" &&
    isEmployeePayoutReady({
      connectionState: "connected",
      payoutsEnabled: true,
      hasAccount: true,
    }) &&
    !isEmployeePayoutReady({
      connectionState: "connected",
      payoutsEnabled: false,
      hasAccount: true,
    }) &&
    errUi === "error" &&
    loadUi === "loading"
  ) {
    pass("payout-cta-states", "Connect / Complete setup / Update details / error / loading");
  } else {
    fail("payout-cta-states", JSON.stringify({ none, incomplete, readyUi, errUi, loadUi }));
  }

  const en = read("../src/i18n/locales/en.json");
  const de = read("../src/i18n/locales/de.json");
  if (
    en.includes("Update Stripe details") &&
    de.includes("Stripe-Daten aktualisieren") &&
    en.includes("Complete Stripe setup") &&
    de.includes("Stripe-Einrichtung abschließen") &&
    en.includes("CareTip payout activity") &&
    de.includes("CareTip-Auszahlungsaktivität")
  ) {
    pass("payout-cta-i18n", "EN/DE payout CTAs present");
  } else {
    fail("payout-cta-i18n", "missing translation keys");
  }

  const heldCents = employeePayableActivityCents({
    status: EmployeeTipPayableStatus.held_platform,
    payableCents: 851,
    transferredCents: 0,
    reversedCents: 0,
    refundedCents: 0,
  });
  const routedCents = employeePayableActivityCents({
    status: EmployeeTipPayableStatus.destination_settled,
    payableCents: 851,
    transferredCents: 851,
    reversedCents: 0,
    refundedCents: 0,
  });
  if (heldCents === 851 && routedCents === 851) {
    pass("activity-cents-from-ledger", "Activity amounts use remaining / netTransferred helpers");
  } else {
    fail("activity-cents-from-ledger", JSON.stringify({ heldCents, routedCents }));
  }
}

function fakeAccount(id: string, overrides: Partial<Stripe.Account> = {}): Stripe.Account {
  return {
    id,
    object: "account",
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

function fakePayoutEvent(account: string, payoutId: string): Stripe.Event {
  return {
    id: `evt_emp_${payoutId}`,
    object: "event",
    type: "payout.created",
    account,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: payoutId,
        object: "payout",
        amount: 3000,
        currency: "eur",
        status: "pending",
        created: Math.floor(Date.now() / 1000),
        arrival_date: Math.floor(Date.now() / 1000),
        method: "standard",
        type: "bank_account",
      },
    },
  } as unknown as Stripe.Event;
}

async function runDbTests(): Promise<void> {
  const suffix = `esc_${Date.now()}`;
  const passwordHash = await bcrypt.hash("EmployeeConnectTest!23", 4);

  const manager = await prisma.user.create({
    data: {
      email: `mgr_${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });
  const userA = await prisma.user.create({
    data: {
      email: `emp_a_${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
    },
  });
  const userB = await prisma.user.create({
    data: {
      email: `emp_b_${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
    },
  });
  const userDeleted = await prisma.user.create({
    data: {
      email: `emp_del_${suffix}@example.com`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
    },
  });

  const business = await prisma.business.create({
    data: {
      name: `Emp Connect ${suffix}`,
      slug: `emp-connect-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_biz_${suffix}`,
    },
  });

  const empA = await prisma.employee.create({
    data: {
      name: "Employee A",
      jobTitle: "Server",
      businessId: business.id,
      userId: userA.id,
      activationStatus: "active",
      isActive: true,
    },
  });
  const empB = await prisma.employee.create({
    data: {
      name: "Employee B",
      jobTitle: "Server",
      businessId: business.id,
      userId: userB.id,
      activationStatus: "active",
      isActive: true,
    },
  });
  const empDeleted = await prisma.employee.create({
    data: {
      name: "Deleted",
      jobTitle: "Server",
      businessId: business.id,
      userId: userDeleted.id,
      activationStatus: "active",
      isActive: true,
      isDeleted: true,
      deletedAt: new Date(),
    },
  });

  try {
    try {
      await resolveActiveEmployeeForConnect(userDeleted.id);
      fail("deleted-employee-blocked", "Deleted employee was allowed to connect");
    } catch (err) {
      if (err instanceof StripeConnectError && err.httpStatus === 404) {
        pass("deleted-employee-blocked", err.code);
      } else {
        fail("deleted-employee-blocked", String(err));
      }
    }

    __setEmployeeCreateV2AccountFnForTests(async (params) => {
      const meta = (params as { metadata?: { caretip_employee_id?: string } }).metadata;
      if (meta?.caretip_employee_id !== empA.id) {
        throw new Error("create metadata employee mismatch");
      }
      if ((params as { configuration?: { merchant?: unknown } }).configuration?.merchant) {
        throw new Error("merchant configuration must not be requested");
      }
      return { id: `acct_emp_a_${suffix}` };
    });
    __setCreateV2AccountLinkFnForTests(async () => ({
      url: "https://connect.stripe.com/setup/s_test_employee",
    }));

    const link = await createEmployeeConnectAccountLink(userA.id);
    if (link.url.startsWith("https://connect.stripe.com/")) {
      pass("account-link-server-url", "Account Link URL is server-generated");
    } else {
      fail("account-link-server-url", link.url);
    }

    const storedA = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId: empA.id },
    });
    if (storedA?.stripeAccountId === `acct_emp_a_${suffix}`) {
      pass("account-bound-to-employee-a", "Stripe account stored on Employee A only");
    } else {
      fail("account-bound-to-employee-a", storedA?.stripeAccountId ?? "missing");
    }

    const storedB = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId: empB.id },
    });
    if (!storedB) {
      pass("employee-b-not-bound", "Creating A's account did not bind Employee B");
    } else {
      fail("employee-b-not-bound", storedB.stripeAccountId);
    }

    const attrA = await attributeStripeConnectAccount(`acct_emp_a_${suffix}`);
    const attrBiz = await attributeStripeConnectAccount(`acct_biz_${suffix}`);
    if (attrA.kind === "employee" && attrA.employeeId === empA.id) {
      pass("attribute-employee", "acct_ maps to EmployeeStripeAccount");
    } else {
      fail("attribute-employee", JSON.stringify(attrA));
    }
    if (attrBiz.kind === "business" && attrBiz.businessId === business.id) {
      pass("attribute-business", "Business acct_ still maps to Business");
    } else {
      fail("attribute-business", JSON.stringify(attrBiz));
    }

    __setEmployeeCreateLoginLinkFnForTests(async (accountId) => {
      if (accountId !== `acct_emp_a_${suffix}`) {
        throw new Error(`login link used ${accountId}`);
      }
      return { url: "https://connect.stripe.com/express/acct_emp_a" };
    });
    const login = await createEmployeeConnectLoginLink(userA.id);
    if (login.url.includes("connect.stripe.com")) {
      pass("login-link-owner-a", "Dashboard login uses Employee A stored acct_");
    } else {
      fail("login-link-owner-a", login.url);
    }

    try {
      await createEmployeeConnectLoginLink(userB.id);
      fail("login-link-b-without-account", "Employee B obtained a login link without an account");
    } catch (err) {
      if (err instanceof StripeConnectError && err.code === "STRIPE_CONNECT_NO_ACCOUNT") {
        pass("login-link-b-without-account", err.code);
      } else {
        fail("login-link-b-without-account", String(err));
      }
    }

    const empUpdated = await handleEmployeeConnectAccountUpdated(
      fakeAccount(`acct_emp_a_${suffix}`, {
        payouts_enabled: true,
        details_submitted: true,
      }),
    );
    const after = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId: empA.id },
    });
    if (
      empUpdated.matched &&
      empUpdated.employeeId === empA.id &&
      after?.stripeConnectStatus === StripeConnectStatus.ready &&
      after.stripePayoutsEnabled
    ) {
      pass("employee-account-updated", "Employee recipient ready without charges_enabled");
    } else {
      fail(
        "employee-account-updated",
        `matched=${empUpdated.matched} status=${after?.stripeConnectStatus}`,
      );
    }

    const bizAfter = await prisma.business.findUnique({
      where: { id: business.id },
      select: { stripeConnectStatus: true },
    });
    if (bizAfter?.stripeConnectStatus === StripeConnectStatus.not_connected) {
      pass("business-status-untouched", "Employee account.updated did not mutate Business Connect");
    } else {
      fail("business-status-untouched", String(bizAfter?.stripeConnectStatus));
    }

    const payout = await handleConnectPayoutEvent(
      fakePayoutEvent(`acct_emp_a_${suffix}`, `po_emp_${suffix}`),
    );
    const payoutRows = await prisma.stripeConnectPayout.findMany({
      where: { stripePayoutId: `po_emp_${suffix}` },
    });
    const employeePayoutRows = await prisma.employeeStripePayout.findMany({
      where: { stripePayoutId: `po_emp_${suffix}` },
    });
    if (
      payout.matched &&
      payout.reason === "employee_payout" &&
      payoutRows.length === 0 &&
      employeePayoutRows.length === 1 &&
      employeePayoutRows[0]?.employeeId === empA.id
    ) {
      pass(
        "employee-payout-not-business-table",
        "Employee payout event persisted to EmployeeStripePayout only",
      );
    } else {
      fail(
        "employee-payout-not-business-table",
        JSON.stringify({ payout, businessRows: payoutRows.length, employeeRows: employeePayoutRows.length }),
      );
    }
  } finally {
    __setEmployeeCreateV2AccountFnForTests(null);
    __setEmployeeCreateLoginLinkFnForTests(null);
    __setCreateV2AccountLinkFnForTests(null);
    await prisma.employeeStripeAccount.deleteMany({
      where: { employeeId: { in: [empA.id, empB.id, empDeleted.id] } },
    });
    await prisma.employee.deleteMany({
      where: { id: { in: [empA.id, empB.id, empDeleted.id] } },
    });
    await prisma.business.delete({ where: { id: business.id } }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: { id: { in: [manager.id, userA.id, userB.id, userDeleted.id] } },
    });
  }
}

async function main() {
  runStaticGuards();
  try {
    await runDbTests();
  } catch (err) {
    fail("db-suite", err instanceof Error ? err.message : String(err));
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

void main();
