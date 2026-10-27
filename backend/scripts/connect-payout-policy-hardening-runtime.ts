/**
 * Payout policy hardening — enumeration, transition guards, settlement outcomes (no Stripe I/O).
 */
import { BusinessBankPayoutSchedule } from "@prisma/client";
import {
  expectedStripeIntervalForCareTipSchedule,
  detectStripeScheduleDrift,
  applyConnectPayoutPolicy,
  __setConnectPayoutPolicyRetrieveAccountForTests,
} from "../src/services/connectPayoutConfiguration.service.js";
import { __setUpdateConnectAccountPayoutScheduleFnForTests } from "../src/services/connectBankPayoutSchedule.core.js";
import {
  applyConnectSettlementMinimumDelay,
  __setConnectBalanceSettingsRawRequestForTests,
  __setConnectBalanceSettingsRetrieveAccountForTests,
  connectSettlementMatchesConfirmedTarget,
  decideConnectSettlement,
  parseConnectBalanceSettingsPayload,
} from "../src/services/stripeConnectBalanceSettings.service.js";
import {
  settlementReadFromBalanceSettings,
  settlementReadUnavailable,
} from "../src/services/connectSettlementRead.service.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(c: unknown, msg: string): void {
  if (!c) throw new Error(msg);
}

function read(rel: string): string {
  const abs = path.join(root, rel);
  assert(existsSync(abs), `missing ${rel}`);
  return readFileSync(abs, "utf8");
}

process.env.STRIPE_SECRET_KEY = "sk_test_mock";

assert(
  expectedStripeIntervalForCareTipSchedule(BusinessBankPayoutSchedule.weekly) === "weekly",
  "weekly stripe interval",
);
assert(
  expectedStripeIntervalForCareTipSchedule(BusinessBankPayoutSchedule.monthly) === "monthly",
  "monthly stripe interval",
);
assert(
  detectStripeScheduleDrift(BusinessBankPayoutSchedule.daily, "manual", true) === true,
  "drift daily vs manual",
);
assert(
  detectStripeScheduleDrift(BusinessBankPayoutSchedule.daily, null, false) === false,
  "unreadable null is not drift",
);
assert(
  detectStripeScheduleDrift(BusinessBankPayoutSchedule.every_3_days, "manual", true) === false,
  "every_3_days expects manual",
);

const atDefaultSnap = parseConnectBalanceSettingsPayload({
  payments: {
    settlement_timing: { delay_days: 3, delay_days_override: 3 },
    payouts: { schedule: { interval: "daily" } },
  },
});
const atDefaultRead = settlementReadFromBalanceSettings(atDefaultSnap);
assert(atDefaultRead.effectiveDelayDays === 3, "parse effective from override");
assert(connectSettlementMatchesConfirmedTarget(atDefaultRead, "de"), "de target match");

__setConnectBalanceSettingsRetrieveAccountForTests(async () => ({ livemode: false, country: "DE" }));

__setConnectBalanceSettingsRawRequestForTests(async (method) => {
  if (method === "GET") {
    return {
      payments: {
        settlement_timing: { delay_days: 3, delay_days_override: 3 },
        payouts: { schedule: { interval: "weekly" } },
      },
    };
  }
  throw new Error("POST not expected when already at target");
});

void (async () => {
  const alreadyOk = await applyConnectSettlementMinimumDelay("acct_de_ok");
  assert(alreadyOk.status === "settlement_unchanged", "already at override 3");
  assert(alreadyOk.settlementState === "explicit_override", "explicit override is not the platform default");
  assert(alreadyOk.stripeSupportMayBeRequired === false, "weekly interval does not fail settlement");

  process.env.STRIPE_CONNECT_SETTLEMENT_MINIMUM_SYNC = "off";
  const syncOff = await applyConnectSettlementMinimumDelay("acct_sync_off");
  assert(syncOff.status === "skipped_disabled", "sync disabled");
  process.env.STRIPE_CONNECT_SETTLEMENT_MINIMUM_SYNC = "1";

  let deOverridePosted = false;
  __setConnectBalanceSettingsRetrieveAccountForTests(async () => ({
    livemode: false,
    country: "DE",
    type: "express",
  }));
  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "GET") {
      return {
        payments: {
          settlement_timing: { delay_days: 7, delay_days_override: null },
          payouts: { schedule: { interval: "manual" } },
        },
      };
    }
    deOverridePosted = true;
    throw new Error("test mode must not POST when delay is not the platform default");
  });

  const configured = await applyConnectSettlementMinimumDelay("acct_de_7day");
  assert(deOverridePosted === false, "no override write for delay other than 3");
  assert(configured.status === "eligibility_unknown", "express DE delay 7 is not assumed eligible");
  assert(configured.settlementState === "delay_mismatch", "delay mismatch stays distinct");

  __setConnectBalanceSettingsRetrieveAccountForTests(async () => ({ livemode: false, country: "US" }));
  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "GET") {
      return {
        payments: { settlement_timing: { delay_days: 7, delay_days_override: null } },
      };
    }
    throw new Error("no POST for non-DE");
  });

  const nonDe = await applyConnectSettlementMinimumDelay("acct_us");
  assert(nonDe.status === "skipped_ineligible", "non-DE skips override apply");

  const platformDefaultRead = settlementReadFromBalanceSettings(
    parseConnectBalanceSettingsPayload({
      payments: {
        settlement_timing: { delay_days: 3, delay_days_override: null },
        payouts: { schedule: { interval: "daily" } },
      },
    }),
  );
  assert(platformDefaultRead.effectiveDelayDays === 3, "platform delay_days is effective when override is absent");
  assert(
    !connectSettlementMatchesConfirmedTarget(platformDefaultRead, "DE"),
    "null override is not an explicit T+3 override",
  );

  const omittedOverride = parseConnectBalanceSettingsPayload({
    payments: {
      settlement_timing: { delay_days: 3 },
      payouts: { schedule: { interval: "monthly" } },
    },
  });
  assert(omittedOverride.delayDaysOverride == null, "absent override field is not an override");
  assert(omittedOverride.settlementOverrideRecognized === true, "absent override field is a recognized empty override");
  const omittedRead = settlementReadFromBalanceSettings(omittedOverride);
  const omittedDecision = decideConnectSettlement({
    keyMode: "test",
    livemode: false,
    country: "DE",
    accountType: "express",
    settlement: omittedRead,
  });
  assert(omittedDecision.needsBalanceSettingsWrite === false, "absent override is not a reconciliation write");
  assert(omittedDecision.state === "platform_default", "absent override with delay 3 is the platform default");
  assert(omittedDecision.action === "settlement_platform_default_verified", "reconciliation names the platform default");

  let platformDefaultPosted = false;
  __setConnectBalanceSettingsRetrieveAccountForTests(async () => ({
    livemode: false,
    country: "DE",
    type: "express",
  }));
  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "GET") {
      return {
        payments: {
          settlement_timing: { delay_days: 3, delay_days_override: null },
          payouts: { schedule: { interval: "manual" } },
        },
      };
    }
    platformDefaultPosted = true;
    throw new Error("redundant test-mode override");
  });
  const platformDefault = await applyConnectSettlementMinimumDelay("acct_de_platform_default_3");
  assert(platformDefaultPosted === false, "confirmed test Express default does not receive an override");
  assert(platformDefault.status === "already_at_account_default", "platform default is a distinct success");
  assert(platformDefault.settlementState === "platform_default", "state names the platform default");

  __setUpdateConnectAccountPayoutScheduleFnForTests(async () => undefined);
  __setConnectPayoutPolicyRetrieveAccountForTests(async (id) => ({
    id,
    livemode: false,
    country: "DE",
    type: "express",
    settings: { payouts: { schedule: { interval: "daily" } } },
  }));
  const created = await applyConnectPayoutPolicy({
    stripeAccountId: "acct_de_express_create",
    careTipSchedule: BusinessBankPayoutSchedule.daily,
    context: "account_create",
  });
  assert(platformDefaultPosted === false, "account create does not post a redundant override");
  assert(created.settlement?.status === "already_at_account_default", "account create accepts the platform default");
  assert(created.policyComplete === true, "account create policy completes without a settlement write");
  __setConnectPayoutPolicyRetrieveAccountForTests(null);
  __setUpdateConnectAccountPayoutScheduleFnForTests(null);

  __setConnectBalanceSettingsRetrieveAccountForTests(async () => ({
    livemode: false,
    country: "DE",
    type: "custom",
  }));
  const custom = await applyConnectSettlementMinimumDelay("acct_de_custom");
  assert(platformDefaultPosted === false, "non-express country DE does not get the test default or an override");
  assert(custom.status === "skipped_ineligible", "known non-express account is out of scope");

  __setConnectBalanceSettingsRetrieveAccountForTests(async () => ({
    livemode: false,
    country: "DE",
    type: "none",
    controller: { stripe_dashboard: { type: "express" } },
  }));
  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "GET") {
      return { payments: { settlement_timing: { delay_days: 7, delay_days_override: null } } };
    }
    throw new Error("v2 express dashboard delay 7 must not be written");
  });
  const v2Seven = await applyConnectSettlementMinimumDelay("acct_v2_express_delay_7");
  assert(v2Seven.status === "eligibility_unknown", "v2 express dashboard with delay 7 is not eligible");
  assert(v2Seven.settlementState === "delay_mismatch", "delay 7 stays a mismatch");
  assert(v2Seven.message === "settlement_delay_not_platform_default_no_write", "no override is posted");

  __setConnectBalanceSettingsRetrieveAccountForTests(async () => ({
    livemode: false,
    country: "DE",
    type: "none",
  }));
  const v2Unknown = await applyConnectSettlementMinimumDelay("acct_v2_type_none");
  assert(v2Unknown.status === "eligibility_unknown", "type none without dashboard is not treated as Express");
  assert(v2Unknown.settlementState === "eligibility_unknown", "missing dashboard stays unconfirmed");

  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "GET") {
      return { payments: { settlement_timing: { delay_days: 3, delay_days_override: null } } };
    }
    throw new Error("observed v2 delay 3 must not be written");
  });
  __setConnectBalanceSettingsRetrieveAccountForTests(async () => ({
    livemode: false,
    country: "DE",
    type: "none",
    controller: { stripe_dashboard: { type: "express" } },
  }));
  const v2Default = await applyConnectSettlementMinimumDelay("acct_v2_express_delay_3");
  assert(v2Default.status === "already_at_account_default", "v2 express dashboard with delay 3 and no override is the observed default");

  const previousKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_live_mock";
  let livePosted = false;
  __setConnectBalanceSettingsRetrieveAccountForTests(async () => ({
    livemode: true,
    country: "DE",
    type: "express",
  }));
  __setConnectBalanceSettingsRawRequestForTests(async (method, _path, data) => {
    if (method === "GET") {
      return {
        payments: {
          settlement_timing: livePosted
            ? { delay_days: 3, delay_days_override: 3 }
            : { delay_days: 3, delay_days_override: null },
          payouts: { schedule: { interval: "daily" } },
        },
      };
    }
    livePosted = true;
    assert(
      data &&
        typeof data === "object" &&
        (data as Record<string, unknown>)["payments[settlement_timing][delay_days_override]"] === 3,
      "live mode still posts the existing override",
    );
    return {
      payments: {
        settlement_timing: { delay_days: 3, delay_days_override: 3 },
        payouts: { schedule: { interval: "daily" } },
      },
    };
  });
  const liveDefault = await applyConnectSettlementMinimumDelay("acct_live_de_default");
  assert(livePosted === true, "live mode does not switch to the test-platform default");
  assert(liveDefault.status === "settlement_configured", "live override write remains");
  process.env.STRIPE_SECRET_KEY = previousKey;

  __setConnectBalanceSettingsRetrieveAccountForTests(async () => ({ livemode: true, country: "DE" }));
  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "GET") {
      return {
        payments: {
          settlement_timing: { delay_days: 7, delay_days_override: null },
          payouts: { schedule: { interval: "daily" } },
        },
      };
    }
    throw new Error("test key must not POST balance settings for a live account");
  });
  const liveAccount = await applyConnectSettlementMinimumDelay("acct_live_de");
  assert(liveAccount.status === "skipped_key_mode_mismatch", "test secret does not update a live connected account");

  __setConnectBalanceSettingsRetrieveAccountForTests(async () => ({ livemode: false, country: "DE" }));
  __setConnectBalanceSettingsRawRequestForTests(async (method) => {
    if (method === "GET") throw Object.assign(new Error("perm"), { statusCode: 403 });
    throw new Error("unexpected");
  });

  const perm = await applyConnectSettlementMinimumDelay("acct_perm", 7);
  assert(perm.status === "failed" || perm.before?.source === "accounts_v1_fallback", "permission or fallback");

  __setConnectBalanceSettingsRawRequestForTests(null);
  __setConnectBalanceSettingsRetrieveAccountForTests(null);

  const enumSrc = read("src/services/connectPayoutAccountEnumeration.service.ts");
  assert(enumSrc.includes("BUSINESS_PAGE") && enumSrc.includes("take: BUSINESS_PAGE"), "db pagination");
  assert(!enumSrc.includes("take: 50"), "no 50-cap in enumeration");

  const recon = read("src/services/connectPayoutConfigReconciliation.service.ts");
  assert(recon.includes("enumerateAllEligible"), "full enumeration in reconciliation");
  assert(recon.includes("decideConnectSettlement"), "reconciliation classifies settlement before proposing a write");
  assert(recon.includes("needs_investigation"), "delay mismatch is investigation, not an automatic update");
  assert(
    read("src/services/stripeConnectBalanceSettings.service.ts").includes(
      "apply_de_settlement_delay_days_override_3",
    ),
    "live mode keeps the explicit override action",
  );

  assert(settlementReadUnavailable().source === "unavailable", "unavailable read");

  console.log("connect-payout-policy-hardening-runtime: ok");
})();
