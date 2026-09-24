/**
 * Employee Analytics — single Stripe balance retrieval per request lifecycle.
 *
 *   npm run test:employee-analytics-stripe
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

function readService(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const analyticsSvc = readService("src/services/employeeAnalytics.service.ts");
const balanceRetrieveCount = (analyticsSvc.match(/balance\.retrieve/g) ?? []).length;
assert.equal(balanceRetrieveCount, 0, "employeeAnalytics must not call balance.retrieve directly");
pass("no-direct-balance", "analytics uses instant eligibility helper (single balance path)");

assert.match(
  analyticsSvc,
  /getEmployeeInstantPayoutEligibilityForStripeAccount/,
  "analytics reuses instant eligibility snapshot",
);
pass("eligibility-reuse", "instant eligibility helper wired in analytics bundle");

const instantSvc = readService("src/services/employeeInstantPayout.service.ts");
assert.match(
  instantSvc,
  /export async function getEmployeeInstantPayoutEligibilityForStripeAccount/,
);
assert.match(instantSvc, /getEmployeeInstantPayoutEligibilityForStripeAccount\(actor\.employeeId, account\)/);
pass("stripe-account-helper", "shared Stripe-account eligibility helper exported");

console.log("\nEmployee analytics Stripe dedupe checks passed.");
