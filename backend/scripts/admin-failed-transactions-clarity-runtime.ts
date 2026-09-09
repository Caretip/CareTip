/**
 * Admin failed-billing IA + tip-status filter whitelist.
 * Run: npm --prefix backend run test:admin-failed-transactions-clarity
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlatformTipStatusFilter } from "../src/services/platform.service.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

assert(parsePlatformTipStatusFilter("failed") === "failed", "whitelist accepts failed");
assert(parsePlatformTipStatusFilter("success") === "success", "whitelist accepts success");
assert(parsePlatformTipStatusFilter("pending") === "pending", "whitelist accepts pending");
assert(parsePlatformTipStatusFilter("paid") === undefined, "rejects payout-like status");
assert(parsePlatformTipStatusFilter("acct_attacker") === undefined, "rejects attacker status");
assert(parsePlatformTipStatusFilter(undefined) === undefined, "undefined stays unset");

const nav = readFileSync(join(root, "src/app/components/platform/platformAdminNav.ts"), "utf8");
assert(nav.includes("failedBilling"), "nav has Failed billing");
assert(!nav.includes("failedPayments"), "nav no longer lists Failed Payments");
assert(!nav.includes("failedSubscriptions"), "nav no longer lists Failed Subscriptions");
assert(nav.includes("/refunds"), "nav still has refunds route");

const en = JSON.parse(readFileSync(join(root, "src/i18n/locales/en.json"), "utf8")) as {
  admin: { sidebar: { revenue: Record<string, string> } };
  business: { tips: { analytics: { cards: Record<string, string> } } };
  premium: { summaryBanner: { growthValue: string } };
};
assert(en.admin.sidebar.revenue.refunds === "Refunds", "EN sidebar refunds is Refunds, not Failed tips");
assert(en.admin.sidebar.revenue.failedBilling === "Failed billing", "EN Failed billing label");
assert(
  !Object.values(en.admin.sidebar.revenue).includes("Failed tips"),
  "EN sidebar has no Failed tips label",
);
assert(
  en.business.tips.analytics.cards.tipsThisWeek.includes("this week"),
  "EN week comparison label is explicit",
);
assert(
  en.business.tips.analytics.cards.employeesReceivedTips.includes("received tips"),
  "EN employee secondary is not a tip-count label",
);
assert(
  en.premium.summaryBanner.growthValue.includes("previous period"),
  "EN growth is vs previous period, not monthly avg",
);

const reporting = readFileSync(
  join(root, "src/app/components/business/BusinessAnalyticsReporting.tsx"),
  "utf8",
);
assert(
  !reporting.includes("business.tips.live.cards.tipCount"),
  "analytics overview no longer uses unlabeled live tipCount",
);
assert(reporting.includes("tipsThisWeek"), "analytics overview uses this-week comparison key");
assert(
  reporting.includes("employeesReceivedTips"),
  "analytics overview uses employees-received-tips key",
);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nadmin failed-transactions / analytics clarity checks passed");
