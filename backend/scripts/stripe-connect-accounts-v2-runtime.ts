/**
 * Stripe Connect Accounts V2 — new-account create path (no live account creation by default).
 * Run: npm run test:stripe-connect-accounts-v2
 *
 * Live TEST onboarding is BLOCKED unless CARETIP_LIVE_CONNECT_V2_E2E=1.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Role, StripeConnectStatus } from "@prisma/client";
import type Stripe from "stripe";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { CARETIP_FEE_FIXED_CENTS_EUR, CARETIP_FEE_PERCENT } from "../src/config/fees.js";
import {
  STRIPE_ACCOUNTS_V2_CREATE_PATH,
  accountsV2RequestOptions,
  buildAccountsV2CreateParams,
  connectExpressIdempotencyKey,
  createExpressAccountOnboardingLink,
  ensureExpressConnectedAccountForBusiness,
  getConnectStatusForBusiness,
  handleConnectAccountUpdated,
  StripeConnectError,
  v2JsonUtf8ContentLength,
  __setCreateAccountFnForTests,
  __setCreateV2AccountFnForTests,
  __setCreateV2AccountLinkFnForTests,
  __setRetrieveAccountFnForTests,
  __setSerializeConnectEnsureForTests,
} from "../src/services/stripeConnect.service.js";

type Result = { id: string; pass: boolean; detail: string; blocked?: boolean };
const results: Result[] = [];
const backendRoot = process.cwd();

function pass(id: string, detail: string) {
  results.push({ id, pass: true, detail });
}
function fail(id: string, detail: string) {
  results.push({ id, pass: false, detail });
}
function blocked(id: string, detail: string) {
  results.push({ id, pass: true, blocked: true, detail });
}
function read(rel: string): string {
  return readFileSync(join(backendRoot, rel), "utf8");
}

function fakeAccount(id: string, overrides: Partial<Stripe.Account> = {}): Stripe.Account {
  return {
    id,
    object: "account",
    created: Math.floor(Date.now() / 1000),
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

async function withTestBusiness(
  tag: string,
  fn: (ctx: { businessId: string; ownerId: string; email: string }) => Promise<void>,
): Promise<void> {
  const suffix = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("ConnectV2!23ab", 4);
  const user = await prisma.user.create({
    data: {
      email: `mgr_v2_${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });
  const biz = await prisma.business.create({
    data: {
      name: `ConnectV2 ${suffix}`,
      slug: `connectv2-${suffix}`,
      userId: user.id,
    },
  });
  try {
    await fn({ businessId: biz.id, ownerId: user.id, email: user.email });
  } finally {
    await prisma.business.deleteMany({ where: { id: biz.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: user.id } }).catch(() => undefined);
  }
}

function runStatic(): void {
  const connectSvc = read("src/services/stripeConnect.service.ts");
  const connectCtrl = read("src/controllers/connect.controller.ts");
  const dest = read("src/services/connectTipDestination.service.ts");
  const stripeSvc = read("src/services/stripe.service.ts");
  const payoutSvc = read("src/services/stripeConnectPayout.service.ts");
  const webhook = read("src/webhooks/stripe.webhook.ts");
  const schema = read("prisma/schema.prisma");
  const fees = read("src/config/fees.ts");

  if (
    connectSvc.includes(STRIPE_ACCOUNTS_V2_CREATE_PATH) &&
    connectSvc.includes("rawRequest") &&
    connectSvc.includes('dashboard: "express"') &&
    connectSvc.includes("DEFAULT_ACCOUNTS_V2_API_VERSION") &&
    !connectSvc.includes("getStripeClient().accounts.create")
  ) {
    pass("A-static-v2-create", "New accounts use POST /v2/core/accounts (not V1 accounts.create)");
  } else {
    fail("A-static-v2-create", "V2 create path missing or V1 accounts.create still used");
  }

  const v2Body = buildAccountsV2CreateParams({
    country: "DE",
    contactEmail: "mgr@example.com",
    displayName: "Venue",
  });
  const cfg = v2Body.configuration as {
    merchant?: { capabilities?: { card_payments?: { requested?: boolean } } };
    recipient?: { capabilities?: { stripe_balance?: { stripe_transfers?: { requested?: boolean } } } };
  };
  if (
    v2Body.dashboard === "express" &&
    (v2Body.identity as { country?: string }).country === "de" &&
    cfg.merchant?.capabilities?.card_payments?.requested === true &&
    cfg.recipient?.capabilities?.stripe_balance?.stripe_transfers?.requested === true &&
    (v2Body.defaults as { responsibilities?: { fees_collector?: string; losses_collector?: string } })
      .responsibilities?.fees_collector === "application"
  ) {
    pass("A-static-v2-body", "V2 body requests Express + card_payments + stripe_transfers");
  } else {
    fail("A-static-v2-body", "V2 create body missing Express/merchant/recipient capabilities");
  }

  if (connectSvc.includes("stripeAccountId: null") && connectSvc.includes("connect_express:")) {
    pass("E-static-idempotency-cas", "CAS bind + connect_express idempotency preserved");
  } else fail("E-static-idempotency-cas", "CAS/idempotency missing");

  if (
    connectSvc.includes("STRIPE_ACCOUNTS_V2_ACCOUNT_LINKS_PATH") &&
    connectSvc.includes("/v2/core/account_links") &&
    connectSvc.includes("account_onboarding") &&
    connectSvc.includes("accountLinks.create")
  ) {
    pass("I-static-account-link", "V2 Account Links primary; V1 Account Links fallback for existing Express");
  } else {
    fail("I-static-account-link", "Account Link onboarding missing V2 path or V1 fallback");
  }

  if (
    connectCtrl.includes("CONNECT_CLIENT_ACCOUNT_FORBIDDEN") &&
    connectCtrl.includes("stripeAccountId") &&
    connectCtrl.includes("Do not return stripeAccountId")
  ) {
    pass("M-static-client-id-rejected", "Client stripeAccountId rejected; not returned");
  } else fail("M-static-client-id-rejected", "Client account id controls missing");

  if (
    dest.includes("stripeAccountId") &&
    stripeSvc.includes("transfer_data") &&
    stripeSvc.includes("application_fee_amount") &&
    fees.includes("export const CARETIP_FEE_PERCENT = 10") &&
    fees.includes("CARETIP_FEE_FIXED_CENTS_EUR = 49") &&
    CARETIP_FEE_PERCENT === 10 &&
    CARETIP_FEE_FIXED_CENTS_EUR === 49
  ) {
    pass("N-static-destination", "Destination still Business.stripeAccountId; fee 10% + €0.49");
  } else fail("N-static-destination", "Destination/fee path changed");

  if (stripeSvc.includes("refund_application_fee: true") && !stripeSvc.includes("reverse_transfer: true")) {
    pass("P-static-refund-app-fee", "refund_application_fee true; no reverse_transfer");
  } else fail("P-static-refund-app-fee", "Refund flags changed");

  if (
    payoutSvc.includes("event.account") &&
    payoutSvc.includes("stripeAccountId") &&
    !payoutSvc.includes("payouts.create") &&
    !connectSvc.includes("externalAccounts")
  ) {
    pass("Q-static-payout-observe", "Payout observation unchanged; no payouts.create / externalAccounts");
  } else fail("Q-static-payout-observe", "Payout observation/mutation surface changed");

  if (webhook.includes('event.type === "account.updated"') && webhook.includes("handleConnectAccountUpdated")) {
    pass("K-static-account-updated", "account.updated still maps via stored stripeAccountId");
  } else fail("K-static-account-updated", "account.updated wiring missing");

  if (schema.includes("stripeAccountId") && schema.includes("@unique") && schema.includes("model StripeConnectPayout")) {
    pass("schema-unchanged-shape", "Business.stripeAccountId unique + payout models present");
  } else fail("schema-unchanged-shape", "Unexpected schema shape");

  if (connectSvc.includes("STRIPE_ACCOUNT_CREATE_FAILED") && connectSvc.includes("Stripe connection couldn't be started")) {
    pass("F-static-user-safe-error", "Create failure uses user-safe copy");
  } else fail("F-static-user-safe-error", "User-safe create error missing");

  const unicodeBody = buildAccountsV2CreateParams({
    country: "DE",
    contactEmail: "demo@caretip.de",
    displayName: "Brasserie Lindenstraße",
    businessId: "biz_brasserie_test",
  });
  const unicodeJson = JSON.stringify(unicodeBody);
  const jsChars = unicodeJson.length;
  const utf8Bytes = v2JsonUtf8ContentLength(unicodeBody);
  const unicodeOpts = accountsV2RequestOptions(unicodeBody, {
    idempotencyKey: "connect_express:biz_brasserie_test",
  }) as Stripe.RequestOptions & { additionalHeaders?: Record<string, string> };
  const headers = unicodeOpts.additionalHeaders ?? {};
  if (
    unicodeJson.includes("Lindenstraße") &&
    utf8Bytes > jsChars &&
    headers["Content-Length"] === String(utf8Bytes) &&
    headers["Stripe-Version"] === "2026-07-29.dahlia" &&
    headers["Idempotency-Key"] === "connect_express:biz_brasserie_test" &&
    unicodeOpts.apiVersion === "2026-07-29.dahlia"
  ) {
    pass(
      "A-static-unicode-content-length",
      `ß expands UTF-8 (${jsChars} chars → ${utf8Bytes} bytes); Content-Length + Stripe-Version restated`,
    );
  } else {
    fail(
      "A-static-unicode-content-length",
      `js=${jsChars} utf8=${utf8Bytes} cl=${headers["Content-Length"]} ver=${headers["Stripe-Version"]}`,
    );
  }
}

async function runDbSuite(): Promise<void> {
  let v2Creates = 0;
  const v2Cache = new Map<string, { id: string }>();

  function installIdempotentV2(): void {
    __setCreateAccountFnForTests(null);
    __setCreateV2AccountFnForTests(async (params, options) => {
      v2Creates += 1;
      if (params.dashboard !== "express") {
        throw new Error("expected dashboard express");
      }
      const key = options?.idempotencyKey ?? "";
      if (key && v2Cache.has(key)) return v2Cache.get(key)!;
      const created = { id: `acct_v2_${v2Creates}_${Date.now()}` };
      if (key) v2Cache.set(key, created);
      return created;
    });
    __setRetrieveAccountFnForTests(async (id) => fakeAccount(id));
  }

  installIdempotentV2();

  try {
    await withTestBusiness("new", async ({ businessId, email }) => {
      installIdempotentV2();
      v2Creates = 0;
      v2Cache.clear();
      const a = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      const status = await getConnectStatusForBusiness(businessId);
      if (a.created && a.accountId.startsWith("acct_") && v2Creates === 1 && status.hasAccount && status.status !== StripeConnectStatus.ready) {
        pass("A-new-business-v2", `Created ${a.accountId.slice(-8)} status=${status.status}`);
      } else {
        fail("A-new-business-v2", `created=${a.created} calls=${v2Creates} status=${status.status}`);
      }
    });

    await withTestBusiness("link", async ({ businessId, email }) => {
      installIdempotentV2();
      let linkAccount: string | null = null;
      __setCreateV2AccountLinkFnForTests(async (params) => {
        linkAccount = typeof params.account === "string" ? params.account : null;
        const useCase = params.use_case as { type?: string; account_onboarding?: { configurations?: string[] } };
        if (useCase?.type !== "account_onboarding") throw new Error("expected account_onboarding");
        if (!useCase.account_onboarding?.configurations?.includes("merchant")) {
          throw new Error("expected merchant configuration");
        }
        return { url: "https://accounts.stripe.com/r/acct_test_v2_link#alu_test" };
      });
      const created = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      const link = await createExpressAccountOnboardingLink({ businessId, managerEmail: email });
      if (
        link.accountId === created.accountId &&
        linkAccount === created.accountId &&
        link.url.startsWith("https://accounts.stripe.com/")
      ) {
        pass("I-account-link-bound", "V2 Account Link used the bound connected account");
      } else {
        fail("I-account-link-bound", `linkAcct=${link.accountId} bound=${created.accountId} posted=${linkAccount}`);
      }
    });

    await withTestBusiness("exist", async ({ businessId, email }) => {
      installIdempotentV2();
      v2Creates = 0;
      v2Cache.clear();
      const first = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      const before = v2Creates;
      __setCreateV2AccountFnForTests(async () => {
        v2Creates += 1;
        return { id: `acct_SHOULD_NOT_${Date.now()}` };
      });
      const second = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      if (second.accountId === first.accountId && !second.created && v2Creates === before) {
        pass("B-existing-no-recreate", "Existing stripeAccountId reused; no V2 create");
      } else {
        fail("B-existing-no-recreate", `first=${first.accountId} second=${second.accountId} creates=${v2Creates}`);
      }
    });

    await withTestBusiness("dbl", async ({ businessId, email }) => {
      installIdempotentV2();
      v2Creates = 0;
      v2Cache.clear();
      const a = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      const b = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      if (a.accountId === b.accountId && a.created && !b.created && v2Creates === 1) {
        pass("C-double-click", "Second click reused one V2 account");
      } else fail("C-double-click", `calls=${v2Creates} a=${a.created} b=${b.created}`);
    });

    await withTestBusiness("conc", async ({ businessId, email }) => {
      installIdempotentV2();
      v2Creates = 0;
      v2Cache.clear();
      __setSerializeConnectEnsureForTests(false);
      try {
        const [r1, r2] = await Promise.all([
          ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email }),
          ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email }),
        ]);
        const row = await prisma.business.findUnique({
          where: { id: businessId },
          select: { stripeAccountId: true },
        });
        if (r1.accountId === r2.accountId && row?.stripeAccountId === r1.accountId) {
          pass("D-concurrent", `Single account ${r1.accountId.slice(-8)}`);
        } else fail("D-concurrent", `r1=${r1.accountId} r2=${r2.accountId} stored=${row?.stripeAccountId}`);
      } finally {
        __setSerializeConnectEnsureForTests(true);
      }
    });

    await withTestBusiness("persist", async ({ businessId, email }) => {
      installIdempotentV2();
      v2Creates = 0;
      v2Cache.clear();
      const first = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      await prisma.business.update({
        where: { id: businessId },
        data: {
          stripeAccountId: null,
          stripeConnectStatus: StripeConnectStatus.not_connected,
        },
      });
      const second = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      if (
        second.accountId === first.accountId &&
        connectExpressIdempotencyKey(businessId) === `connect_express:${businessId}`
      ) {
        pass("E-persist-retry-idempotent", "Retry after persist loss reused Stripe idempotency account");
      } else {
        fail("E-persist-retry-idempotent", `first=${first.accountId} second=${second.accountId}`);
      }
    });

    await withTestBusiness("unicode", async ({ businessId, email }) => {
      installIdempotentV2();
      v2Creates = 0;
      v2Cache.clear();
      let postedName: unknown;
      __setCreateV2AccountFnForTests(async (params, options) => {
        postedName = params.display_name;
        v2Creates += 1;
        const key = options?.idempotencyKey ?? "";
        if (key && v2Cache.has(key)) return v2Cache.get(key)!;
        const created = { id: `acct_v2_${v2Creates}_${Date.now()}` };
        if (key) v2Cache.set(key, created);
        return created;
      });
      await prisma.business.update({
        where: { id: businessId },
        data: { name: "Brasserie Lindenstraße" },
      });
      const row = await prisma.business.findUnique({
        where: { id: businessId },
        select: { name: true, stripeAccountId: true },
      });
      const a = await ensureExpressConnectedAccountForBusiness({
        businessId,
        managerEmail: email,
      });
      if (
        row?.stripeAccountId == null &&
        postedName === "Brasserie Lindenstraße" &&
        a.created &&
        v2Creates === 1 &&
        a.accountId.startsWith("acct_")
      ) {
        pass("A-unicode-display-name-create", "NULL stripeAccountId + ß display_name still takes V2 create once");
      } else {
        fail(
          "A-unicode-display-name-create",
          `posted=${String(postedName)} created=${a.created} calls=${v2Creates}`,
        );
      }
    });

    await withTestBusiness("failcreate", async ({ businessId, email }) => {
      __setCreateV2AccountFnForTests(async () => {
        const err = new Error("Invalid request (check your JSON request body)");
        (err as { type?: string; code?: string; requestId?: string }).type = "invalid_request_error";
        (err as { code?: string }).code = "invalid_request_json_body";
        (err as { requestId?: string }).requestId = "req_test_v2";
        throw err;
      });
      try {
        await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
        fail("F-create-fails-clean", "Expected create failure");
      } catch (err) {
        const row = await prisma.business.findUnique({
          where: { id: businessId },
          select: { stripeAccountId: true, stripeConnectStatus: true },
        });
        const ok =
          err instanceof StripeConnectError &&
          err.code === "STRIPE_ACCOUNT_CREATE_FAILED" &&
          err.message.includes("couldn't be started") &&
          row?.stripeAccountId == null &&
          row.stripeConnectStatus === StripeConnectStatus.not_connected;
        if (ok) pass("F-create-fails-clean", "No stripeAccountId persisted on V2 create failure");
        else fail("F-create-fails-clean", `code=${(err as StripeConnectError).code} stored=${row?.stripeAccountId}`);
      }
    });

    await withTestBusiness("retrievefail", async ({ businessId, email }) => {
      __setCreateV2AccountFnForTests(async () => ({ id: `acct_v2_ok_${Date.now()}` }));
      __setRetrieveAccountFnForTests(async (id) => fakeAccount(id));
      const first = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      __setCreateV2AccountFnForTests(async () => ({ id: `acct_SHOULD_NOT_${Date.now()}` }));
      __setRetrieveAccountFnForTests(async () => {
        const err = new Error("missing");
        (err as { code?: string; statusCode?: number }).code = "resource_missing";
        (err as { statusCode?: number }).statusCode = 404;
        throw err;
      });
      try {
        await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
        fail("G-retrieve-fail-closed", "Expected retrieve failure");
      } catch (err) {
        const row = await prisma.business.findUnique({
          where: { id: businessId },
          select: { stripeAccountId: true },
        });
        const ok =
          err instanceof StripeConnectError &&
          err.code === "STRIPE_ACCOUNT_RETRIEVE_FAILED" &&
          row?.stripeAccountId === first.accountId;
        if (ok) pass("G-retrieve-fail-closed", "Did not replace existing account after retrieve failure");
        else fail("G-retrieve-fail-closed", `code=${(err as StripeConnectError).code} stored=${row?.stripeAccountId}`);
      }
    });

    await withTestBusiness("tenantA", async ({ businessId: aId, email: aEmail }) => {
      __setCreateV2AccountFnForTests(async () => ({ id: `acct_shared_${aId.slice(-8)}` }));
      __setRetrieveAccountFnForTests(async (id) => fakeAccount(id));
      const a = await ensureExpressConnectedAccountForBusiness({ businessId: aId, managerEmail: aEmail });
      await withTestBusiness("tenantB", async ({ businessId: bId, email: bEmail }) => {
        __setCreateV2AccountFnForTests(async () => ({ id: a.accountId }));
        try {
          await ensureExpressConnectedAccountForBusiness({ businessId: bId, managerEmail: bEmail });
          fail("H-tenant-conflict", "Expected unique-constraint fail-closed");
        } catch (err) {
          const row = await prisma.business.findUnique({
            where: { id: bId },
            select: { stripeAccountId: true },
          });
          const ok =
            err instanceof StripeConnectError &&
            err.code === "STRIPE_ACCOUNT_TENANT_CONFLICT" &&
            row?.stripeAccountId == null;
          if (ok) pass("H-tenant-conflict", "Did not reassign another Business's Connect account");
          else fail("H-tenant-conflict", `code=${(err as StripeConnectError).code} stored=${row?.stripeAccountId}`);
        }
      });
    });

    await withTestBusiness("status", async ({ businessId, email }) => {
      __setCreateV2AccountFnForTests(async () => ({ id: `acct_ready_${Date.now()}` }));
      __setRetrieveAccountFnForTests(async (id) =>
        fakeAccount(id, { charges_enabled: true, payouts_enabled: true, details_submitted: true }),
      );
      const created = await ensureExpressConnectedAccountForBusiness({ businessId, managerEmail: email });
      const status = await getConnectStatusForBusiness(businessId);
      if (status.readyForPayouts && status.status === StripeConnectStatus.ready && status.hasAccount) {
        pass("J-status-ready", "Ready only when charges+payouts enabled");
      } else fail("J-status-ready", `status=${status.status} ready=${status.readyForPayouts}`);

      const updated = await handleConnectAccountUpdated(
        fakeAccount(created.accountId, {
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: true,
          requirements: { currently_due: ["individual.verification.document"], past_due: [], disabled_reason: null },
        } as Stripe.Account),
        { eventCreatedUnix: Math.floor(Date.now() / 1000) + 5 },
      );
      const after = await getConnectStatusForBusiness(businessId);
      if (updated.matched && after.status !== StripeConnectStatus.ready && !after.readyForPayouts) {
        pass("K-account-updated-match", "account.updated applied to owning Business only");
      } else fail("K-account-updated-match", `matched=${updated.matched} status=${after.status}`);
    });

    const unknown = await handleConnectAccountUpdated(fakeAccount(`acct_unknown_${Date.now()}`), {
      eventCreatedUnix: Math.floor(Date.now() / 1000),
    });
    if (!unknown.matched && unknown.businessId == null) {
      pass("L-unknown-account", "Unknown Stripe account not attached");
    } else fail("L-unknown-account", `matched=${unknown.matched}`);
  } finally {
    __setCreateV2AccountFnForTests(null);
    __setCreateV2AccountLinkFnForTests(null);
    __setRetrieveAccountFnForTests(null);
    __setCreateAccountFnForTests(null);
  }
}

function runLiveProbe(): void {
  const live = process.env.CARETIP_LIVE_CONNECT_V2_E2E === "1";
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!live) {
    blocked(
      "I-live-account-link",
      "NOT VERIFIABLE: set CARETIP_LIVE_CONNECT_V2_E2E=1 to run live TEST Account Link (will not fake PASS)",
    );
    return;
  }
  if (!key.startsWith("sk_test_")) {
    blocked("I-live-account-link", "NOT VERIFIABLE: live V2 E2E requires TEST-mode STRIPE_SECRET_KEY");
    return;
  }
  blocked(
    "I-live-account-link",
    "NOT VERIFIABLE FROM THIS SUITE: hosted Stripe onboarding requires a real manager click in TEST mode",
  );
}

async function main(): Promise<void> {
  console.log("=== CareTip Stripe Connect Accounts V2 Tests ===\n");
  runStatic();
  try {
    await runDbSuite();
  } catch (err) {
    fail("db-suite", err instanceof Error ? err.message : String(err));
  }
  runLiveProbe();

  const failed = results.filter((r) => !r.pass).length;
  const blockedN = results.filter((r) => r.blocked).length;
  for (const r of results) {
    const tag = r.blocked ? "BLOCKED" : r.pass ? "PASS" : "FAIL";
    console.log(`${tag}  ${r.id}  ${r.detail}`);
  }
  console.log(`\n${results.length} recorded (${failed} failed, ${blockedN} blocked)`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
