/**
 * Pending release dates come from Stripe available_on, grouped per day.
 * No network and no database: Stripe calls are replaced with fixtures.
 */
import assert from "node:assert/strict";
import type Stripe from "stripe";
import {
  groupPendingReleases,
  pendingReleasesFromScan,
  type BalanceTxnLike,
} from "../src/services/stripePendingReleases.service.js";
import {
  __resetInstantPayoutStripeFnsForTests,
  __setInstantPayoutStripeFnsForTests,
  evaluateInstantPayoutForStripeAccount,
} from "../src/services/stripeConnectInstantPayout.service.js";

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
const tx = (availableOn: string, net: number, status = "pending", currency = "eur"): BalanceTxnLike => ({
  available_on: day(availableOn),
  net,
  status,
  currency,
});

// Shape of the account investigated on 2026-11-23: 7-day settlement, €1,217.21 pending.
const fixture: BalanceTxnLike[] = [
  tx("2026-11-28", 7151),
  ...[5351, 5351, 5342, 4091, 7151, 8501, 4631, 5351, 5351, 5351, 8951].map((n) => tx("2026-11-27", n)),
  ...[7151, 8051, 8051, 8051, 8051, 4451].map((n) => tx("2026-11-26", n)),
  tx("2026-11-24", 5342),
  tx("2026-11-21", 5351, "available"),
  tx("2026-11-22", -5351, "available"),
  tx("2026-11-27", 999, "pending", "usd"),
];

{
  const out = groupPendingReleases(fixture, "eur", 121721, false);
  assert.deepEqual(out.pendingReleases, [
    { availableOn: "2026-11-24T00:00:00.000Z", amountCents: 5342 },
    { availableOn: "2026-11-26T00:00:00.000Z", amountCents: 43806 },
    { availableOn: "2026-11-27T00:00:00.000Z", amountCents: 65422 },
    { availableOn: "2026-11-28T00:00:00.000Z", amountCents: 7151 },
  ]);
  assert.equal(out.pendingReleasesComplete, true, "sums to the pending balance");
}

{
  assert.equal(groupPendingReleases(fixture, "eur", 121721, true).pendingReleasesComplete, false, "truncated scan");
  assert.equal(groupPendingReleases(fixture, "eur", 130000, false).pendingReleasesComplete, false, "older funds missing");
  const netted = groupPendingReleases([tx("2026-11-30", 500), tx("2026-11-30", -500)], "eur", 0, false);
  assert.deepEqual(netted.pendingReleases, [], "zero-sum day dropped");
}

{
  assert.deepEqual(pendingReleasesFromScan(null, "eur", 100), { pendingReleases: null, pendingReleasesComplete: false });
  assert.deepEqual(pendingReleasesFromScan(null, "eur", 0), { pendingReleases: [], pendingReleasesComplete: true });
}

const balance = {
  object: "balance",
  available: [{ amount: 0, currency: "eur", source_types: { card: 0 } }],
  pending: [{ amount: 121721, currency: "eur", source_types: { card: 121721 } }],
  instant_available: [
    { amount: 121721, currency: "eur", net_available: [{ amount: 118752, destination: "ba_test" }] },
  ],
  livemode: false,
} as unknown as Stripe.Balance;

const mocks = {
  retrieveBalance: async () => balance,
  retrieveAccount: async () => ({ country: "DE", payouts_enabled: true, charges_enabled: true }),
  listExternalAccounts: async () =>
    ({
      object: "list",
      data: [{ id: "ba_test", object: "bank_account", last4: "3000", available_payout_methods: ["standard", "instant"] }],
      has_more: false,
      url: "",
    }) as unknown as Stripe.ApiList<Stripe.BankAccount>,
};

try {
  __setInstantPayoutStripeFnsForTests({
    ...mocks,
    scanBalanceTransactions: async () => ({ txns: fixture, truncated: false }),
  });
  const snap = await evaluateInstantPayoutForStripeAccount({ stripeAccountId: "acct_test", payoutsEnabledFallback: true });
  assert.equal(snap.pendingCents, 121721);
  assert.equal(snap.pendingReleases?.length, 4);
  assert.equal(snap.pendingReleasesComplete, true);

  __resetInstantPayoutStripeFnsForTests();
  __setInstantPayoutStripeFnsForTests({ ...mocks, scanBalanceTransactions: async () => null });
  const failed = await evaluateInstantPayoutForStripeAccount({ stripeAccountId: "acct_test", payoutsEnabledFallback: true });
  assert.equal(failed.balancesRetrieved, true, "balances still shown when the list fails");
  assert.equal(failed.pendingReleases, null);

  __resetInstantPayoutStripeFnsForTests();
  __setInstantPayoutStripeFnsForTests(mocks);
  const unmocked = await evaluateInstantPayoutForStripeAccount({ stripeAccountId: "acct_test", payoutsEnabledFallback: true });
  assert.equal(unmocked.pendingReleases, null, "mocked balance never triggers a real Stripe list");
} finally {
  __resetInstantPayoutStripeFnsForTests();
}

console.log("stripe-pending-releases-runtime: ok");
