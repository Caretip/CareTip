/**
 * Billing web info + return sync policy regression.
 *
 *   npm run test:billing-handoff
 */
import assert from "node:assert/strict";
import {
  BILLING_RETURN_SYNC_INTERVAL_MS,
  BILLING_RETURN_SYNC_MAX_ATTEMPTS,
  didTierUpgrade,
  isBillingEntitlementConfirmed,
} from "../utils/billingReturnSyncPolicy";
import { shouldBypassForegroundSyncCooldown } from "../utils/billingForegroundBoost";
import { en } from "../i18n/locales/en";

function run() {
  assert.equal(isBillingEntitlementConfirmed({ synced: true, subscriptionTier: "basic" }), true);
  assert.equal(
    isBillingEntitlementConfirmed({ synced: false, subscriptionTier: "premium" }),
    true,
  );
  assert.equal(
    isBillingEntitlementConfirmed({ synced: false, subscriptionTier: "enterprise" }),
    true,
  );
  assert.equal(
    isBillingEntitlementConfirmed({ synced: false, subscriptionTier: "basic" }),
    false,
  );
  assert.equal(isBillingEntitlementConfirmed({ synced: false, subscriptionTier: null }), false);

  assert.equal(didTierUpgrade("basic", "premium"), true);
  assert.equal(didTierUpgrade("premium", "enterprise"), true);
  assert.equal(didTierUpgrade("premium", "basic"), false);
  assert.equal(didTierUpgrade("basic", "basic"), false);
  assert.equal(didTierUpgrade(null, "premium"), true);

  assert.ok(BILLING_RETURN_SYNC_MAX_ATTEMPTS >= 3);
  assert.ok(BILLING_RETURN_SYNC_MAX_ATTEMPTS * BILLING_RETURN_SYNC_INTERVAL_MS <= 30_000);

  assert.equal(shouldBypassForegroundSyncCooldown(0), false);

  assert.match(en.billingWebInfo.title, /CareTip Web/i);
  assert.match(en.billingWebInfo.bodyIntro, /visit/i);
  assert.match(en.billingWebInfo.bodyAfterLink, /Billing/i);
  assert.match(en.billingWebInfo.bodyAfterLink, /Subscription/i);
  assert.match(en.billingWebInfo.dismiss, /Got it/i);
  assert.doesNotMatch(en.billingWebInfo.title, /Continue/i);

  console.log("billing-handoff-runtime: OK");
}

run();
