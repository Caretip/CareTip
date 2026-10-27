/**
 * Settlement-default migration checks. Mocks only; no Stripe calls.
 * Run: node ./node_modules/tsx/dist/cli.mjs ./scripts/connect-settlement-default-migration-runtime.ts
 */
import {
  __setConnectBalanceSettingsRawRequestForTests,
  __setConnectBalanceSettingsRetrieveAccountForTests,
} from "../src/services/stripeConnectBalanceSettings.service.js";
import {
  assessSettlementMigrationAccount,
  runSettlementDefaultMigration,
} from "../src/services/connectSettlementDefaultMigration.service.js";
import { settlementReadFromBalanceSettings } from "../src/services/connectSettlementRead.service.js";
import { parseConnectBalanceSettingsPayload } from "../src/services/stripeConnectBalanceSettings.service.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

process.env.STRIPE_SECRET_KEY = "sk_test_mock";

const business = { kind: "business" as const, careTipId: "biz_caretip_12345678", stripeAccountId: "acct_test_business_express" };
const employee = { kind: "employee" as const, careTipId: "emp_caretip_12345678", stripeAccountId: "acct_test_employee_express" };

type AccountShape = {
  livemode: boolean;
  country: string;
  type: string;
  controller?: { stripe_dashboard?: { type?: string } };
};
let account: AccountShape = { livemode: false, country: "DE", type: "express" };
const v2Express: AccountShape = {
  livemode: false,
  country: "DE",
  type: "none",
  controller: { stripe_dashboard: { type: "express" } },
};
let posts: Array<number | ""> = [];
let balance: Record<string, unknown> = { delay_days: 3, delay_days_override: null };

__setConnectBalanceSettingsRetrieveAccountForTests(async () => account);
__setConnectBalanceSettingsRawRequestForTests(async (method, _path, data) => {
  if (method === "POST") {
    const value = (data as Record<string, unknown>)["payments[settlement_timing][delay_days_override]"];
    if (value === "") posts.push("");
    else if (value === 3) posts.push(3);
    else throw new Error(`unexpected override value ${String(value)}`);
    if (value === "") balance = { delay_days: 3 };
    if (value === 3) balance = { delay_days: 3, delay_days_override: 3 };
    return { payments: { settlement_timing: balance } };
  }
  return { payments: { settlement_timing: balance, payouts: { schedule: { interval: "weekly" } } } };
});

void (async () => {
  balance = { delay_days: 3, delay_days_override: null };
  posts = [];
  const inherited = await runSettlementDefaultMigration({
    mode: "dry_run",
    confirmTestModeClear: false,
    confirmBusinessExpressEligibility: false,
    accounts: [business],
  });
  assert(posts.length === 0, "default T+3 does not write");
  assert(inherited.rows[0]?.disposition === "already_default", "inherited default is not a candidate");
  assert(inherited.rows[0]?.safeToMigrate === false, "already-default account is not a migration");
  assert(inherited.migrated === 0, "dry-run migrates nothing");

  balance = { delay_days: 3, delay_days_override: 3 };
  posts = [];
  const dry = await runSettlementDefaultMigration({
    mode: "dry_run",
    confirmTestModeClear: false,
    confirmBusinessExpressEligibility: false,
    accounts: [business],
  });
  assert(posts.length === 0, "dry-run does not clear an explicit override");
  assert(dry.rows[0]?.disposition === "excluded", "hidden default is not a migration candidate");
  assert(dry.rows[0]?.reason === "underlying_default_hidden_by_override", "override 3 hides the default");
  assert(dry.rows[0]?.eligibilityConfirmed === false, "override 3 does not confirm Stripe eligibility");
  assert(dry.rows[0]?.safeToMigrate === false, "hidden platform default is not marked safe");
  assert(dry.rows[0]?.override === 3, "inventory shows the override");
  assert(dry.rows[0]?.effectiveDelayDays === 3, "inventory shows the effective delay");

  const omitted = parseConnectBalanceSettingsPayload({
    payments: { settlement_timing: { delay_days: 3 } },
  });
  assert(omitted.delayDaysOverride == null && omitted.settlementOverrideRecognized === true, "absent override field");
  const absent = assessSettlementMigrationAccount({
    kind: "business",
    careTipId: business.careTipId,
    stripeAccountId: business.stripeAccountId,
    keyMode: "test",
    livemode: false,
    country: "DE",
    accountType: "express",
    settlement: settlementReadFromBalanceSettings(omitted),
  });
  assert(absent.disposition === "already_default", "absent override field inherits the default");

  posts = [];
  balance = { delay_days: 3, delay_days_override: 3 };
  const cleared = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [business],
  });
  assert(posts.length === 0, "confirm flags do not clear an override while the default is hidden");
  assert(cleared.rows[0]?.disposition === "excluded", "hidden default stays excluded in apply mode");
  assert(cleared.migrated === 0, "no account is migrated");

  posts = [];
  const again = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [business],
  });
  assert(posts.length === 0, "rerun still does not write while the override remains");
  assert(again.rows[0]?.reason === "underlying_default_hidden_by_override", "rerun stays excluded");

  posts = [];
  balance = { delay_days: 3, delay_days_override: 3 };
  __setConnectBalanceSettingsRawRequestForTests(async (method, _path, data, options) => {
    const id = options && typeof options === "object" && "stripeAccount" in options ? String(options.stripeAccount) : "";
    if (id === "acct_test_second") {
      if (method === "POST") throw new Error("second account must not be written");
      return { payments: { settlement_timing: { delay_days: 3, delay_days_override: 3 } } };
    }
    if (method === "POST") {
      const value = (data as Record<string, unknown>)["payments[settlement_timing][delay_days_override]"];
      if (value === "") {
        posts.push("");
        balance = { delay_days: 7 };
      } else if (value === 3) {
        posts.push(3);
        balance = { delay_days: 3, delay_days_override: 3 };
      } else throw new Error("bad value");
      return { payments: { settlement_timing: balance } };
    }
    return { payments: { settlement_timing: balance } };
  });
  const badReadback = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [business, { ...business, stripeAccountId: "acct_test_second" }],
  });
  assert(posts.length === 0, "hidden defaults are not cleared, so no restore write is possible");
  assert(badReadback.rows[0]?.reason === "underlying_default_hidden_by_override", "first override stays in place");
  assert(badReadback.rows[1]?.reason === "underlying_default_hidden_by_override", "second override stays in place");

  posts = [];
  balance = { delay_days: 3, delay_days_override: 3 };
  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "POST") {
      posts.push("");
      throw new Error("stripe_unavailable");
    }
    return { payments: { settlement_timing: balance } };
  });
  const apiFailure = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [business, { ...business, stripeAccountId: "acct_test_after_api_failure" }],
  });
  assert(apiFailure.rows[0]?.reason === "underlying_default_hidden_by_override", "API is not called for a hidden default");
  assert(apiFailure.rows[0]?.override === 3, "the explicit override remains the reported timing");
  assert(apiFailure.rows[1]?.reason === "underlying_default_hidden_by_override", "later accounts are not cleared");
  assert(posts.length === 0, "no clear request is sent");

  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "POST") throw new Error("no write");
    return { payments: { settlement_timing: { delay_days: 3, delay_days_override: 3 } } };
  });
  posts = [];
  account = { livemode: false, country: "DE", type: "express" };
  const employeeRun = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [employee],
  });
  assert(employeeRun.rows[0]?.reason === "employee_recipient_only_eligibility_unconfirmed", "employee recipient is excluded");
  assert(employeeRun.migrated === 0, "employee account is not cleared");

  account = { livemode: false, country: "DE", type: "custom" };
  const custom = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [business],
  });
  assert(custom.rows[0]?.reason === "account_not_express", "non-express is excluded");

  account = { livemode: false, country: "DE", type: "express" };
  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "POST") throw new Error("no write");
    return { payments: { settlement_timing: { delay_days: 7, delay_days_override: null } } };
  });
  const otherDelay = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [business],
  });
  assert(otherDelay.rows[0]?.reason === "effective_delay_not_confirmed_t3", "delay other than 3 is not cleared");

  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "POST") throw new Error("no write");
    return { payments: { settlement_timing: { delay_days: 3, delay_days_override: "pending" } } };
  });
  const unexpected = await runSettlementDefaultMigration({
    mode: "dry_run",
    confirmTestModeClear: false,
    confirmBusinessExpressEligibility: false,
    accounts: [business],
  });
  assert(unexpected.rows[0]?.reason === "balance_settings_incomplete", "unexpected override field fails closed");

  account = { livemode: true, country: "DE", type: "express" };
  const liveAccount = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [business],
  });
  assert(liveAccount.rows[0]?.reason === "live_account_excluded", "livemode account is excluded");

  process.env.STRIPE_SECRET_KEY = "sk_live_mock";
  const liveKey = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [business],
  });
  assert(liveKey.blocker === "refusing_non_test_stripe_key", "live key never starts migration");
  assert(liveKey.inspected === 0, "live key does not read accounts");
  process.env.STRIPE_SECRET_KEY = "sk_test_mock";
  account = { livemode: false, country: "DE", type: "express" };
  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "POST") throw new Error("unconfirmed apply must not write");
    return { payments: { settlement_timing: { delay_days: 3, delay_days_override: 3 } } };
  });

  const unconfirmed = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: false,
    confirmBusinessExpressEligibility: false,
    accounts: [business],
  });
  assert(unconfirmed.writesEnabled === false, "apply without both confirmations does not enable writes");
  assert(unconfirmed.rows[0]?.reason === "underlying_default_hidden_by_override", "unconfirmed apply leaves the override in place");
  assert(unconfirmed.blocker != null, "missing confirmation is a blocker");

  account = v2Express;
  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "POST") throw new Error("v2 express dashboard must not be written");
    return { payments: { settlement_timing: { delay_days: 7, delay_days_override: null } } };
  });
  const v2Delay = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [business],
  });
  assert(v2Delay.rows[0]?.accountType === "none", "v2 account type none is recorded");
  assert(v2Delay.rows[0]?.stripeDashboardType === "express", "v1 dashboard field is the Express signal");
  assert(v2Delay.rows[0]?.reason === "effective_delay_not_confirmed_t3", "delay 7 is not T+3 eligibility");
  assert(v2Delay.migrated === 0, "v2 express dashboard with delay 7 is not cleared");

  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "POST") throw new Error("observed T+3 must not be written");
    return { payments: { settlement_timing: { delay_days: 3, delay_days_override: null } } };
  });
  const v2Observed = await runSettlementDefaultMigration({
    mode: "dry_run",
    confirmTestModeClear: false,
    confirmBusinessExpressEligibility: false,
    accounts: [business],
  });
  assert(v2Observed.rows[0]?.disposition === "already_default", "no override and delay 3 is already the observed delay");
  assert(v2Observed.rows[0]?.eligibilityConfirmed === false, "observed delay 3 is not an eligibility certificate");

  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "POST") throw new Error("hidden v2 override must not be written");
    return { payments: { settlement_timing: { delay_days: 3, delay_days_override: 3 } } };
  });
  const v2Hidden = await runSettlementDefaultMigration({
    mode: "apply",
    confirmTestModeClear: true,
    confirmBusinessExpressEligibility: true,
    accounts: [business],
  });
  assert(v2Hidden.rows[0]?.reason === "underlying_default_hidden_by_override", "v2 override 3 stays excluded");

  account = { livemode: false, country: "DE", type: "none" };
  const dashboardMissing = await runSettlementDefaultMigration({
    mode: "dry_run",
    confirmTestModeClear: false,
    confirmBusinessExpressEligibility: false,
    accounts: [business],
  });
  assert(dashboardMissing.rows[0]?.reason === "account_dashboard_unconfirmed", "type none without dashboard fails closed");

  account = { livemode: false, country: "DE", type: "none", controller: { stripe_dashboard: { type: "full" } } };
  const fullDashboard = await runSettlementDefaultMigration({
    mode: "dry_run",
    confirmTestModeClear: false,
    confirmBusinessExpressEligibility: false,
    accounts: [business],
  });
  assert(fullDashboard.rows[0]?.reason === "account_not_express", "full dashboard is not Express");

  account = v2Express;
  __setConnectBalanceSettingsRetrieveAccountForTests(async () => {
    throw Object.assign(new Error("account_invalid"), { code: "account_invalid" });
  });
  const failedRead = await runSettlementDefaultMigration({
    mode: "dry_run",
    confirmTestModeClear: false,
    confirmBusinessExpressEligibility: false,
    accounts: [business],
  });
  assert(failedRead.rows[0]?.reason === "balance_settings_read_failed", "failed account read is excluded");
  assert(failedRead.migrated === 0, "failed read does not write");

  __setConnectBalanceSettingsRawRequestForTests(null);
  __setConnectBalanceSettingsRetrieveAccountForTests(null);
  console.log("connect-settlement-default-migration-runtime: ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
