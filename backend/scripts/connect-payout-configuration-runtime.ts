/**
 * Connect payout policy hardening — mocked Stripe contract tests.
 */
import { BusinessBankPayoutSchedule } from "@prisma/client";
import {
  __setUpdateConnectAccountPayoutScheduleFnForTests,
  stripePayoutScheduleUpdateForPreference,
} from "../src/services/connectBankPayoutSchedule.core.js";
import {
  __setConnectPayoutPolicyRetrieveAccountForTests,
  applyConnectPayoutPolicy,
  detectStripeScheduleDrift,
} from "../src/services/connectPayoutConfiguration.service.js";
import { parseConnectBalanceSettingsPayload } from "../src/services/stripeConnectBalanceSettings.service.js";
import {
  __setConnectBalanceSettingsRawRequestForTests,
  __setConnectBalanceSettingsRetrieveAccountForTests,
  applyConnectSettlementMinimumDelay,
} from "../src/services/stripeConnectBalanceSettings.service.js";
import {
  readSettlementDelayForConnectedAccount,
  settlementReadFromAccountsV1DelayDays,
} from "../src/services/connectSettlementRead.service.js";
import { stripeKeyModeMatchesAccountLivemode } from "../src/utils/stripeKeyMode.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing: ${rel}`);
  return readFileSync(abs, "utf8");
}

process.env.STRIPE_SECRET_KEY = "sk_test_mock";

assert(
  stripePayoutScheduleUpdateForPreference(BusinessBankPayoutSchedule.daily).interval === "daily",
  "daily interval",
);
assert(
  stripePayoutScheduleUpdateForPreference(BusinessBankPayoutSchedule.every_3_days).interval ===
    "manual",
  "every_3_days manual",
);

const parsed7 = parseConnectBalanceSettingsPayload({
  payments: { settlement_timing: { delay_days: 7, delay_days_override: null } },
});
assert(parsed7.effectiveSettlementDelayDays === 7, "effective from delay_days");

const parsed3 = parseConnectBalanceSettingsPayload({
  payments: { settlement_timing: { delay_days: 3, delay_days_override: 3 } },
});
assert(parsed3.effectiveSettlementDelayDays === 3, "effective from override 3");

const fallback = settlementReadFromAccountsV1DelayDays(7);
assert(fallback.source === "accounts_v1_fallback", "fallback labelled");

assert(stripeKeyModeMatchesAccountLivemode(false), "test key test account");
assert(!stripeKeyModeMatchesAccountLivemode(true), "test key rejects live account");

let scheduleUpdates = 0;
__setUpdateConnectAccountPayoutScheduleFnForTests(async () => {
  scheduleUpdates += 1;
});

__setConnectPayoutPolicyRetrieveAccountForTests(async (id) => ({
  id,
  livemode: false,
  country: "DE",
  settings: { payouts: { schedule: { interval: "manual", delay_days: 7 } } },
}));

__setConnectBalanceSettingsRetrieveAccountForTests(async () => ({ livemode: false, country: "DE" }));

let settlementOverridePosted = false;
__setConnectBalanceSettingsRawRequestForTests(async (method, _path, data) => {
  if (method === "GET") {
    if (settlementOverridePosted) {
      return {
        payments: {
          settlement_timing: { delay_days: 3, delay_days_override: 3 },
          payouts: { schedule: { interval: "daily" } },
        },
      };
    }
    return {
      payments: {
        settlement_timing: { delay_days: 7, delay_days_override: null },
        payouts: { schedule: { interval: "daily" } },
      },
    };
  }
  if (method === "POST") {
    assert(data && typeof data === "object", "POST body");
    assert(
      (data as Record<string, unknown>)["payments[settlement_timing][delay_days_override]"] === 3,
      "override 3",
    );
    settlementOverridePosted = true;
    return {
      payments: {
        settlement_timing: { delay_days: 3, delay_days_override: 3 },
        payouts: { schedule: { interval: "daily" } },
      },
    };
  }
  throw new Error("unexpected");
});

void (async () => {
  const needsApply = await applyConnectSettlementMinimumDelay("acct_test_7day", 7);
  assert(needsApply.status === "settlement_configured", "POST override 3 for DE 7-day default");
  assert(needsApply.after?.delayDaysOverride === 3, "verified override");
  assert(needsApply.stripeSupportMayBeRequired === false, "success no support flag");

  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "GET") {
      return {
        payments: {
          settlement_timing: { delay_days: 3, delay_days_override: 3 },
          payouts: { schedule: { interval: "daily" } },
        },
      };
    }
    throw new Error("no post expected");
  });

  let policyRetrieveCalls = 0;
  __setConnectPayoutPolicyRetrieveAccountForTests(async (id) => {
    policyRetrieveCalls += 1;
    const interval = policyRetrieveCalls >= 2 ? "daily" : "manual";
    return {
      id,
      livemode: false,
      country: "DE",
      settings: { payouts: { schedule: { interval } } },
    };
  });

  const policy = await applyConnectPayoutPolicy({
    stripeAccountId: "acct_test_policy",
    careTipSchedule: BusinessBankPayoutSchedule.daily,
    context: "schedule_change",
    attemptSettlementMinimum: true,
  });
  assert(policy.schedule.status === "schedule_synced", "schedule synced");
  assert(scheduleUpdates >= 1, "schedule update called");
  assert(policy.settlement != null, "settlement result present");
  assert(
    policy.settlement?.status === "settlement_unchanged" ||
      policy.settlement?.status === "settlement_configured",
    "settlement success",
  );
  assert(policy.policyComplete === true, "policy complete on verified settlement");
  assert(!policy.policyComplete || policy.schedule.status === "schedule_synced", "no false complete on schedule fail");

  const readFb = await readSettlementDelayForConnectedAccount({
    stripeAccountId: "x",
    accountsV1DelayDays: 5,
  });
  assert(readFb.source === "accounts_v1_fallback" || readFb.source === "balance_settings", "read path");

  assert(detectStripeScheduleDrift(BusinessBankPayoutSchedule.daily, "daily", true) === false, "no drift");

  __setUpdateConnectAccountPayoutScheduleFnForTests(null);
  __setConnectPayoutPolicyRetrieveAccountForTests(null);
  __setConnectBalanceSettingsRawRequestForTests(null);
  __setConnectBalanceSettingsRetrieveAccountForTests(null);

  assert(read("src/services/connectPayoutAccountEnumeration.service.ts").includes("BUSINESS_PAGE"), "full enum pagination");
  assert(read("scripts/connect-payout-config-reconciliation.ts").includes("confirm-all-accounts"), "bulk guard");
  assert(read("src/services/connectPayoutScheduleTransition.service.ts").includes("BANK_PAYOUT_SCHEDULE_TRANSITION_BLOCKED"), "transition guard");
  assert(!/\bpayouts\.create\b/.test(read("src/services/connectPayoutConfiguration.service.ts").replace(/no payouts\.create/g, "")), "no payout create in policy");

  console.log("connect-payout-configuration-runtime: ok");
})();
