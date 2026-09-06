/**
 * Stripe Connect Phase 1 — security + status + tenant isolation tests.
 * Run: npm run test:stripe-connect-phase1
 *
 * Does not call live Stripe API. Uses DB when available for webhook mirror checks.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Role, StripeConnectStatus } from "@prisma/client";
import type Stripe from "stripe";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  deriveStripeConnectStatus,
  handleConnectAccountUpdated,
  createExpressDashboardLoginLink,
  StripeConnectError,
  __setCreateLoginLinkFnForTests,
} from "../src/services/stripeConnect.service.js";

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

function runStaticSecurity() {
  const connectSvc = read("src/services/stripeConnect.service.ts");
  const connectCtrl = read("src/controllers/connect.controller.ts");
  const connectRoutes = read("src/routes/connect.routes.ts");
  const webhook = read("src/webhooks/stripe.webhook.ts");
  const schema = read("prisma/schema.prisma");
  const index = read("src/index.ts");
  const migration = read("prisma/migrations/20260813120000_stripe_connect_phase1/migration.sql");

  if (
    connectSvc.includes('dashboard: "express"') &&
    connectSvc.includes('STRIPE_ACCOUNTS_V2_CREATE_PATH') &&
    connectSvc.includes("/v2/core/accounts") &&
    !connectSvc.includes("getStripeClient().accounts.create(")
  ) {
    pass("express-account-create", "New Connect accounts created via Accounts V2 POST /v2/core/accounts");
  } else {
    fail("express-account-create", "Missing Accounts V2 create (must not use V1 accounts.create)");
  }

  if (
    connectSvc.includes("/v2/core/account_links") &&
    connectSvc.includes("account_onboarding") &&
    connectSvc.includes("accountLinks.create")
  ) {
    pass("account-links", "V2 Account Links primary with V1 Account Links fallback");
  } else {
    fail("account-links", "Missing Account Links onboarding");
  }

  if (connectCtrl.includes("CONNECT_CLIENT_URL_FORBIDDEN") && connectCtrl.includes("returnUrl")) {
    pass("client-return-url-rejected", "Controller rejects client returnUrl/refreshUrl");
  } else {
    fail("client-return-url-rejected", "Missing client URL rejection");
  }

  if (connectCtrl.includes("CONNECT_CLIENT_ACCOUNT_FORBIDDEN") && connectCtrl.includes("stripeAccountId")) {
    pass("client-account-id-rejected", "Controller rejects client stripeAccountId/businessId");
  } else {
    fail("client-account-id-rejected", "Missing client account id rejection");
  }

  if (connectCtrl.includes("getBusinessByUserId") && connectCtrl.includes("resolveManagerBusiness")) {
    pass("tenant-from-jwt", "Connect APIs resolve business from authenticated manager, not body.businessId");
  } else {
    fail("tenant-from-jwt", "Missing JWT business resolution");
  }

  if (
    connectRoutes.includes("requireRole(Role.MANAGER)") &&
    connectRoutes.includes("authMiddleware") &&
    index.includes("connectRoutes")
  ) {
    pass("manager-auth-routes", "Connect routes are manager-auth gated and mounted");
  } else {
    fail("manager-auth-routes", "Connect routes auth/mount incomplete");
  }

  if (
    connectRoutes.includes('router.post("/connect/login-link"') &&
    connectRoutes.includes("postMyConnectLoginLink") &&
    connectCtrl.includes("createExpressDashboardLoginLink") &&
    connectCtrl.includes("rejectClientConnectSteering") &&
    connectSvc.includes("accounts.createLoginLink") &&
    connectSvc.includes("createExpressDashboardLoginLink")
  ) {
    pass("express-login-link", "Manager Login Link endpoint uses stored account + Stripe createLoginLink");
  } else {
    fail("express-login-link", "Missing Express Dashboard Login Link wiring");
  }

  const statusFn = connectCtrl.slice(
    connectCtrl.indexOf("getMyConnectStatus"),
    connectCtrl.indexOf("postMyConnectAccountLink"),
  );
  if (
    statusFn.includes("createExpressDashboardLoginLink") ||
    statusFn.includes("createLoginLink")
  ) {
    fail("login-link-not-on-status", "GET /connect/status must not generate Login Links");
  } else {
    pass("login-link-not-on-status", "Login Links are not generated during status fetch");
  }

  if (
    connectSvc.includes('dashboard: "express"') &&
    !connectSvc.includes('dashboard: "full"') &&
    !connectSvc.includes('dashboard: "none"') &&
    !connectSvc.includes('type: "standard"') &&
    !connectSvc.includes('type: "custom"')
  ) {
    pass("express-type-preserved", "Account create remains Express-class (no Standard/Custom)");
  } else {
    fail("express-type-preserved", "Account type/dashboard create params changed");
  }

  if (webhook.includes("account.updated") && webhook.includes("handleConnectAccountUpdated")) {
    pass("account-updated-webhook", "Existing webhook handles account.updated");
  } else {
    fail("account-updated-webhook", "account.updated not wired");
  }

  if (
    connectCtrl.includes("refreshConnectStatusFromStripe") &&
    connectSvc.includes("snapshotFromV2CoreAccount")
  ) {
    pass("status-live-refresh", "GET /connect/status live-refreshes the Connect mirror from Stripe");
  } else {
    fail("status-live-refresh", "Status endpoint still reads a stale Connect mirror only");
  }

  if (webhook.includes("verifyWebhookSignature")) {
    pass("webhook-signature-preserved", "Webhook still verifies Stripe signatures");
  } else {
    fail("webhook-signature-preserved", "Webhook signature verification missing");
  }

  if (
    connectSvc.includes("stripeAccountId: accountId") &&
    connectSvc.includes("unmatched")
  ) {
    pass("webhook-lookup-by-acct", "account.updated matches Business by stored stripeAccountId only");
  } else {
    fail("webhook-lookup-by-acct", "Unsafe or missing account→business lookup");
  }

  if (
    schema.includes("@unique") &&
    schema.includes("stripe_account_id") &&
    schema.includes("StripeConnectStatus") &&
    migration.includes("businesses_stripe_account_id_key")
  ) {
    pass("schema-unique-acct", "stripeAccountId unique + StripeConnectStatus + migration present");
  } else {
    fail("schema-unique-acct", "Schema/migration missing unique stripeAccountId or status enum");
  }

  if (connectSvc.includes("if (existing)") && connectSvc.includes("created: false")) {
    pass("idempotent-reuse", "Existing connected account is reused (no silent duplicate create)");
  } else {
    fail("idempotent-reuse", "Missing idempotent account reuse");
  }

  if (
    !/application_fee_amount\s*:/.test(connectSvc) &&
    !/transfer_data\s*:/.test(connectSvc) &&
    !connectSvc.includes("checkout.sessions.create")
  ) {
    pass("connect-service-no-destination-routing", "Connect account service does not set Checkout destination/fee");
  } else {
    fail("connect-service-no-destination-routing", "Connect account service must not create destination charges");
  }

  if (index.includes('express.raw({ type: "application/json" }') && index.includes("stripeWebhookRoutes")) {
    pass("webhook-raw-body", "Webhook raw body mount preserved");
  } else {
    fail("webhook-raw-body", "Webhook raw body mount missing");
  }

  if (connectSvc.includes('STRIPE_NOT_CONFIGURED') && connectSvc.includes("isStripeConfigured")) {
    pass("missing-stripe-graceful", "Missing Stripe config fails with typed Connect error");
  } else {
    fail("missing-stripe-graceful", "Missing Stripe config handling incomplete");
  }
}

function runStatusDerivation() {
  const cases: Array<{
    id: string;
    input: Parameters<typeof deriveStripeConnectStatus>[0];
    expect: StripeConnectStatus;
  }> = [
    {
      id: "status-not-connected",
      input: {
        hasAccount: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        currentlyDueCount: 0,
        pastDueCount: 0,
        disabledReason: null,
      },
      expect: StripeConnectStatus.not_connected,
    },
    {
      id: "status-ready",
      input: {
        hasAccount: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        currentlyDueCount: 0,
        pastDueCount: 0,
        disabledReason: null,
      },
      expect: StripeConnectStatus.ready,
    },
    {
      id: "status-ready-despite-past-due",
      input: {
        hasAccount: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        currentlyDueCount: 0,
        pastDueCount: 16,
        disabledReason: "requirements.past_due",
      },
      expect: StripeConnectStatus.ready,
    },
    {
      id: "status-restricted-past-due",
      input: {
        hasAccount: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: true,
        currentlyDueCount: 0,
        pastDueCount: 16,
        disabledReason: "requirements.past_due",
      },
      expect: StripeConnectStatus.restricted,
    },
    {
      id: "status-restricted-disabled",
      input: {
        hasAccount: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: true,
        currentlyDueCount: 0,
        pastDueCount: 0,
        disabledReason: "rejected.fraud",
      },
      expect: StripeConnectStatus.restricted,
    },
    {
      id: "status-requires-info",
      input: {
        hasAccount: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: true,
        currentlyDueCount: 2,
        pastDueCount: 0,
        disabledReason: null,
      },
      expect: StripeConnectStatus.requires_information,
    },
    {
      id: "status-onboarding-required",
      input: {
        hasAccount: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        currentlyDueCount: 0,
        pastDueCount: 0,
        disabledReason: null,
      },
      expect: StripeConnectStatus.onboarding_required,
    },
  ];

  for (const c of cases) {
    const got = deriveStripeConnectStatus(c.input);
    if (got === c.expect) pass(c.id, `derive → ${got}`);
    else fail(c.id, `expected ${c.expect}, got ${got}`);
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

async function runDbIsolationTests(): Promise<void> {
  const suffix = `c1_${Date.now()}`;
  const passwordHash = await bcrypt.hash("ConnectPhase1Test!23", 4);

  const userA = await prisma.user.create({
    data: {
      email: `mgr_a_${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });
  const userB = await prisma.user.create({
    data: {
      email: `mgr_b_${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });

  const userNone = await prisma.user.create({
    data: {
      email: `mgr_none_${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });

  const bizA = await prisma.business.create({
    data: {
      name: `Connect A ${suffix}`,
      slug: `connect-a-${suffix}`,
      userId: userA.id,
      stripeAccountId: `acct_test_a_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.onboarding_incomplete,
    },
  });
  const bizB = await prisma.business.create({
    data: {
      name: `Connect B ${suffix}`,
      slug: `connect-b-${suffix}`,
      userId: userB.id,
      stripeAccountId: `acct_test_b_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.onboarding_incomplete,
    },
  });
  const bizNone = await prisma.business.create({
    data: {
      name: `Connect None ${suffix}`,
      slug: `connect-none-${suffix}`,
      userId: userNone.id,
    },
  });

  try {
    const unmatched = await handleConnectAccountUpdated(
      fakeAccount(`acct_unknown_${suffix}`, {
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      }),
    );
    if (!unmatched.matched && unmatched.businessId == null) {
      pass("webhook-unknown-account", "Unknown acct_ does not attach to a Business");
    } else {
      fail("webhook-unknown-account", "Unknown account incorrectly matched");
    }

    const updatedA = await handleConnectAccountUpdated(
      fakeAccount(bizA.stripeAccountId!, {
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      }),
    );
    if (updatedA.matched && updatedA.businessId === bizA.id) {
      pass("webhook-updates-correct-business", "account.updated updates Business A only (match)");
    } else {
      fail("webhook-updates-correct-business", `matched=${updatedA.matched} id=${updatedA.businessId}`);
    }

    const rowA = await prisma.business.findUnique({
      where: { id: bizA.id },
      select: {
        stripeConnectStatus: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      },
    });
    const rowB = await prisma.business.findUnique({
      where: { id: bizB.id },
      select: {
        stripeConnectStatus: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      },
    });

    if (
      rowA?.stripeConnectStatus === StripeConnectStatus.ready &&
      rowA.stripeChargesEnabled &&
      rowA.stripePayoutsEnabled
    ) {
      pass("webhook-status-ready", "Business A mirrored to ready");
    } else {
      fail("webhook-status-ready", `Business A status=${rowA?.stripeConnectStatus}`);
    }

    if (
      rowB?.stripeConnectStatus === StripeConnectStatus.onboarding_incomplete &&
      !rowB.stripeChargesEnabled
    ) {
      pass("webhook-cross-tenant-isolation", "Business B unchanged when acct_A updated");
    } else {
      fail("webhook-cross-tenant-isolation", "Business B incorrectly mutated");
    }

    // Idempotent second delivery
    await handleConnectAccountUpdated(
      fakeAccount(bizA.stripeAccountId!, {
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      }),
    );
    const rowA2 = await prisma.business.findUnique({
      where: { id: bizA.id },
      select: { stripeConnectStatus: true },
    });
    if (rowA2?.stripeConnectStatus === StripeConnectStatus.ready) {
      pass("webhook-duplicate-idempotent", "Duplicate account.updated keeps ready status");
    } else {
      fail("webhook-duplicate-idempotent", "Duplicate update broke status");
    }

    const seenAccountIds: string[] = [];
    __setCreateLoginLinkFnForTests(async (accountId) => {
      seenAccountIds.push(accountId);
      return { url: `https://stripe.com/express/test_${accountId.slice(-6)}` };
    });
    try {
      const linkA = await createExpressDashboardLoginLink({ businessId: bizA.id });
      if (
        linkA.url.startsWith("https://stripe.com/express/") &&
        Object.keys(linkA).length === 1 &&
        seenAccountIds.length === 1 &&
        seenAccountIds[0] === bizA.stripeAccountId
      ) {
        pass("login-link-own-account", "Login Link uses stored stripeAccountId and returns url only");
      } else {
        fail("login-link-own-account", `Unexpected login link result ${JSON.stringify(linkA)} ids=${seenAccountIds.join(",")}`);
      }

      const linkB = await createExpressDashboardLoginLink({ businessId: bizB.id });
      if (seenAccountIds[1] === bizB.stripeAccountId && linkB.url.includes("express")) {
        pass("login-link-tenant-isolation", "Business B Login Link uses B's stored account, not A's");
      } else {
        fail("login-link-tenant-isolation", `Cross-tenant account ids ${seenAccountIds.join(",")}`);
      }

      try {
        await createExpressDashboardLoginLink({ businessId: bizNone.id });
        fail("login-link-no-account", "Missing stripeAccountId should reject");
      } catch (err) {
        if (err instanceof StripeConnectError && err.code === "STRIPE_CONNECT_NO_ACCOUNT" && err.httpStatus === 400) {
          pass("login-link-no-account", "No connected account is rejected without Stripe call");
        } else {
          fail("login-link-no-account", `Unexpected no-account error ${String(err)}`);
        }
      }

      __setCreateLoginLinkFnForTests(async () => {
        throw new Error("stripe_unavailable_sk_live_dummy");
      });
      try {
        await createExpressDashboardLoginLink({ businessId: bizA.id });
        fail("login-link-stripe-error", "Stripe failure should map to StripeConnectError");
      } catch (err) {
        const safe =
          err instanceof StripeConnectError &&
          err.code === "STRIPE_LOGIN_LINK_FAILED" &&
          !err.message.includes("sk_live") &&
          err.message.includes("Stripe Dashboard");
        if (safe) {
          pass("login-link-stripe-error", "Stripe errors become user-safe Login Link failures");
        } else {
          fail("login-link-stripe-error", `Unsafe or unexpected error ${String(err)}`);
        }
      }

      const after = await prisma.business.findUnique({
        where: { id: bizA.id },
        select: { stripeAccountId: true },
      });
      if (after?.stripeAccountId === bizA.stripeAccountId) {
        pass("login-link-not-persisted", "Login Link generation does not change stored stripeAccountId");
      } else {
        fail("login-link-not-persisted", "stripeAccountId mutated by Login Link");
      }
    } finally {
      __setCreateLoginLinkFnForTests(null);
    }
  } finally {
    await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id, bizNone.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id, userNone.id] } } });
  }
}

async function main() {
  console.log("=== CareTip Stripe Connect Phase 1 Tests ===\n");
  runStaticSecurity();
  runStatusDerivation();

  try {
    await runDbIsolationTests();
  } catch (err) {
    fail(
      "db-isolation-suite",
      `DB tests failed (migrate/generate may be required): ${err instanceof Error ? err.message : String(err)}`,
    );
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
