/**
 * Reconciliation safety — unreadable Stripe accounts must not produce false drift or mutations.
 */
import { BusinessBankPayoutSchedule, StripeConnectStatus } from "@prisma/client";
import {
  __setConnectPayoutPolicyRetrieveAccountForTests,
  detectStripeScheduleDrift,
  readConnectPayoutConfigurationStatus,
} from "../src/services/connectPayoutConfiguration.service.js";
import { processReconciliationAccount } from "../src/services/connectPayoutConfigReconciliation.service.js";
import {
  __setUpdateConnectAccountPayoutScheduleFnForTests,
} from "../src/services/connectBankPayoutSchedule.core.js";

function assert(c: unknown, msg: string): void {
  if (!c) throw new Error(msg);
}

process.env.STRIPE_SECRET_KEY = "sk_test_mock";

assert(
  detectStripeScheduleDrift(BusinessBankPayoutSchedule.daily, null, false) === false,
  "null interval unreadable is not drift",
);
assert(
  detectStripeScheduleDrift(BusinessBankPayoutSchedule.daily, "manual", true) === true,
  "verified mismatch is drift",
);
assert(
  detectStripeScheduleDrift(BusinessBankPayoutSchedule.every_3_days, "manual", true) === false,
  "verified every_3_days matches manual",
);

let scheduleUpdates = 0;
__setUpdateConnectAccountPayoutScheduleFnForTests(async () => {
  scheduleUpdates += 1;
});

__setConnectPayoutPolicyRetrieveAccountForTests(async (id) => {
  throw Object.assign(new Error("no access"), {
    type: "StripePermissionError",
    code: "account_invalid",
  });
});

void (async () => {
  const status = await readConnectPayoutConfigurationStatus(
    "acct_test_unreadable",
    BusinessBankPayoutSchedule.daily,
  );
  assert(status.stripeScheduleReadable === false, "readable false on retrieve fail");
  assert(status.scheduleDrift === false, "no confirmed drift when unreadable");
  assert(status.accountRetrieveErrorClass === "account_unreachable", "account_invalid class");

  const rowDry = await processReconciliationAccount(
    {
      kind: "business",
      careTipId: "biz-test-unreadable-0001",
      stripeAccountId: "acct_test_unreadable",
      bankPayoutSchedule: BusinessBankPayoutSchedule.daily,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
    },
    "dry_run",
  );
  assert(rowDry.disposition === "blocked_unverified_account", "dry-run blocks unreadable");
  assert(
    !rowDry.proposedActions.includes("resync_stripe_payout_interval"),
    "no schedule resync proposed",
  );

  scheduleUpdates = 0;
  const rowApply = await processReconciliationAccount(
    {
      kind: "employee",
      careTipId: "emp-test-unreadable-0001",
      stripeAccountId: "acct_test_unreadable",
      bankPayoutSchedule: BusinessBankPayoutSchedule.daily,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
    },
    "apply",
  );
  assert(rowApply.disposition === "blocked_unverified_account", "apply blocks unreadable");
  assert(scheduleUpdates === 0, "apply did not sync schedule");

  __setConnectPayoutPolicyRetrieveAccountForTests(async (id) => ({
    id,
    livemode: false,
    settings: { payouts: { schedule: { interval: "manual" } } },
  }));

  const verifiedDrift = await readConnectPayoutConfigurationStatus(
    "acct_test_drift",
    BusinessBankPayoutSchedule.daily,
  );
  assert(verifiedDrift.scheduleDrift === true, "verified manual vs daily is drift");

  const rowDrift = await processReconciliationAccount(
    {
      kind: "business",
      careTipId: "biz-test-drift-0001",
      stripeAccountId: "acct_test_drift",
      bankPayoutSchedule: BusinessBankPayoutSchedule.daily,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
    },
    "dry_run",
  );
  assert(
    rowDrift.disposition === "confirmed_schedule_drift",
    "dry-run flags confirmed drift",
  );
  assert(
    rowDrift.proposedActions.includes("resync_stripe_payout_interval"),
    "resync proposed for confirmed drift",
  );

  __setConnectPayoutPolicyRetrieveAccountForTests(async (id) => {
    throw Object.assign(new Error("timeout"), {
      type: "StripeConnectionError",
      code: "rate_limit",
    });
  });
  const transient = await readConnectPayoutConfigurationStatus(
    "acct_test_transient",
    BusinessBankPayoutSchedule.daily,
  );
  assert(transient.scheduleDrift === false, "transient read not drift");
  assert(transient.accountRetrieveErrorClass === "transient", "transient class");

  __setConnectPayoutPolicyRetrieveAccountForTests(null);
  __setUpdateConnectAccountPayoutScheduleFnForTests(null);

  console.log("connect-payout-reconciliation-safety-runtime: ok");
})();
