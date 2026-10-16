/**
 * Payout policy hardening — enumeration, transition guards, settlement outcomes (no Stripe I/O).
 */
import { BusinessBankPayoutSchedule } from "@prisma/client";
import {
  expectedStripeIntervalForCareTipSchedule,
  detectStripeScheduleDrift,
} from "../src/services/connectPayoutConfiguration.service.js";
import {
  applyConnectSettlementMinimumDelay,
  __setConnectBalanceSettingsRawRequestForTests,
  __setConnectBalanceSettingsRetrieveAccountForTests,
  connectSettlementMatchesConfirmedTarget,
} from "../src/services/stripeConnectBalanceSettings.service.js";
import {
  settlementReadFromBalanceSettings,
  settlementReadUnavailable,
} from "../src/services/connectSettlementRead.service.js";
import { parseConnectBalanceSettingsPayload } from "../src/services/stripeConnectBalanceSettings.service.js";
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
        payouts: { schedule: { interval: "daily" } },
      },
    };
  }
  throw new Error("POST not expected when already at target");
});

void (async () => {
  const alreadyOk = await applyConnectSettlementMinimumDelay("acct_de_ok");
  assert(alreadyOk.status === "settlement_unchanged", "already at override 3");
  assert(alreadyOk.stripeSupportMayBeRequired === false, "no support flag");

  process.env.STRIPE_CONNECT_SETTLEMENT_MINIMUM_SYNC = "off";
  const syncOff = await applyConnectSettlementMinimumDelay("acct_sync_off");
  assert(syncOff.status === "skipped_disabled", "sync disabled");
  process.env.STRIPE_CONNECT_SETTLEMENT_MINIMUM_SYNC = "1";

  let deOverridePosted = false;
  __setConnectBalanceSettingsRawRequestForTests(async (method, _p, data) => {
    if (method === "GET") {
      if (deOverridePosted) {
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
      assert(
        data &&
          typeof data === "object" &&
          (data as Record<string, unknown>)["payments[settlement_timing][delay_days_override]"] === 3,
        "POST override 3",
      );
      deOverridePosted = true;
      return {
        payments: {
          settlement_timing: { delay_days: 3, delay_days_override: 3 },
          payouts: { schedule: { interval: "daily" } },
        },
      };
    }
    throw new Error("unexpected");
  });

  const configured = await applyConnectSettlementMinimumDelay("acct_de_7day");
  assert(configured.status === "settlement_configured", "7-day default gets override 3");
  assert(configured.after?.delayDaysOverride === 3, "read-back override");
  assert(configured.after?.effectiveDelayDays === 3, "read-back effective");

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
  assert(recon.includes("apply_de_settlement_delay_days_override_3"), "recon settlement action");

  assert(settlementReadUnavailable().source === "unavailable", "unavailable read");

  console.log("connect-payout-policy-hardening-runtime: ok");
})();
