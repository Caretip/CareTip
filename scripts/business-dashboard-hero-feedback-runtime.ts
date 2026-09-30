/**
 * Business overview — hero To distribute zero display + feedback fetch mount.
 * Run: npm run test:business-dashboard-hero-feedback
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function pass(msg: string) {
  console.log(`PASS: ${msg}`);
}

const hero = read("src/app/components/business/BusinessHeroFinancialMetrics.tsx");
const feedback = read("src/app/components/business/RecentCustomerFeedbackPanel.tsx");
const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");

assert.match(hero, /formatEur\(n\)/);
assert.doesNotMatch(hero, /ledgerCurrencyValue\(distributionEur\)/);
pass("To distribute uses EUR formatting, not metricZeroTips");

assert.match(hero, /distributionZeroHint/);
assert.match(hero, /id: "distribution"/);
assert.doesNotMatch(hero, /showDistribution/);
pass("To distribute column stays in payout grid when ledger is settled");

assert.match(en, /distributionZeroHint/);
assert.match(de, /distributionZeroHint/);
pass("EN/DE zero-state hints for To distribute");

assert.doesNotMatch(feedback, /useInViewActive/);
assert.doesNotMatch(feedback, /panelVisible/);
assert.match(feedback, /scheduleIdleWork/);
pass("Customer Feedback fetch is not viewport-gated");

assert.match(feedback, /DashboardListSkeleton/);
pass("Customer Feedback shows loading skeleton while fetching");

console.log("\nAll business-dashboard-hero-feedback checks passed.");
