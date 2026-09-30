/**
 * Employee pending balance UX — terminology vs data sources (no financial logic).
 * Run: npm run test:employee-pending-balance-terminology
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.dirname(path.dirname(path.dirname(fileDir)));
const localesRoot = path.join(srcRoot, "i18n/locales");
const appRoot = path.join(srcRoot, "app");

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(localesRoot, rel), "utf8")) as Record<string, unknown>;
}

function dig(obj: Record<string, unknown>, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    assert.ok(cur && typeof cur === "object", `missing ${keys.join(".")}`);
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const en = readJson("en.json");
const de = readJson("de.json");

const enPayoutPending = String(
  dig(en, ["employee", "payouts", "dashboard", "kpiPending"]),
);
const enRelease = String(dig(en, ["employee", "analytics", "pendingRelease"]));
const enStripePending = String(dig(en, ["employee", "analytics", "stripePending"]));

assert.notEqual(enPayoutPending.toLowerCase(), "pending", "payout KPI must not be bare Pending");
assert.match(enPayoutPending, /stripe/i, "payout pending label references Stripe");
assert.match(enRelease, /release/i, "analytics pending release label unchanged semantically");
assert.equal(enStripePending, enPayoutPending, "analytics Stripe section matches payout terminology");

const dePayoutPending = String(
  dig(de, ["employee", "payouts", "dashboard", "kpiPending"]),
);
const deRelease = String(dig(de, ["employee", "analytics", "pendingRelease"]));
assert.notEqual(dePayoutPending, deRelease, "DE: Stripe pending label distinct from pending release");

const analyticsPage = readFileSync(
  path.join(appRoot, "pages/employee/EmployeeAnalyticsPage.tsx"),
  "utf8",
);
const payoutMetrics = readFileSync(
  path.join(appRoot, "components/employee/EmployeePayoutDashboardMetrics.tsx"),
  "utf8",
);

assert.ok(
  analyticsPage.includes("lifetimeMetrics.pendingReleaseEur"),
  "Analytics pending release still uses ledger field",
);
assert.ok(
  !analyticsPage.match(/value:\s*data\?\.stripe\.pendingCents/),
  "Analytics summary must not bind Stripe pending to KPI cards",
);
assert.ok(
  analyticsPage.includes("data.stripe.pendingCents"),
  "Analytics Stripe section still uses Stripe pendingCents",
);
assert.ok(
  payoutMetrics.includes("eligibility?.pendingCents"),
  "Payout dashboard still uses Stripe pendingCents",
);
assert.ok(
  !payoutMetrics.includes("pendingReleaseEur"),
  "Payout dashboard must not use ledger pending release",
);

const enLifetime = String(dig(en, ["employee", "analytics", "paidPendingLifetime"]));
assert.match(enLifetime, /pending release/i, "lifetime footnote names pending release explicitly");

console.log("employeePendingBalanceTerminology.runtime: OK");
