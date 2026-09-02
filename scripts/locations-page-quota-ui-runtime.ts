/**
 * Locations page: multi-location upgrade only at the location quota, not for all Basic accounts.
 * Run: npm run test:locations-page-quota-ui
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPlanLimitsForTier, hasFeature } from "../src/app/lib/subscriptionCapabilities";
import {
  isAtLocationCap,
  shouldShowMultiLocationUpgradeCard,
} from "../src/app/lib/locationsPageQuotaUi";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const basicLimits = getPlanLimitsForTier("basic");
const proLimits = getPlanLimitsForTier("premium");

if (basicLimits.maxLocations === 1 && basicLimits.maxTables === 1) {
  pass("Basic limits remain 1 location / 1 table");
} else {
  fail(`Basic limits drifted: ${JSON.stringify(basicLimits)}`);
}

if (!hasFeature("basic", "multiLocation") && hasFeature("premium", "multiLocation")) {
  pass("multiLocation remains Pro-only");
} else {
  fail("multiLocation matrix drifted");
}

if (proLimits.maxLocations == null) {
  pass("Pro locations remain unlimited");
} else {
  fail("Pro maxLocations drifted");
}

const basicZero = isAtLocationCap({
  ready: true,
  maxLocations: 1,
  locationCount: 0,
});
const basicZeroCard = shouldShowMultiLocationUpgradeCard({
  ready: true,
  hasMultiLocation: false,
  atLocationCap: basicZero,
});
if (!basicZero && !basicZeroCard) {
  pass("Basic 0 locations: not at cap, no multi-location upgrade card");
} else {
  fail("Basic 0 locations must allow first location without upgrade card");
}

const basicOne = isAtLocationCap({
  ready: true,
  maxLocations: 1,
  locationCount: 1,
});
const basicOneCard = shouldShowMultiLocationUpgradeCard({
  ready: true,
  hasMultiLocation: false,
  atLocationCap: basicOne,
});
if (basicOne && basicOneCard) {
  pass("Basic 1 location: at cap, multi-location upgrade card shown");
} else {
  fail("Basic 1 location must show upgrade only at the cap");
}

const proManyCard = shouldShowMultiLocationUpgradeCard({
  ready: true,
  hasMultiLocation: true,
  atLocationCap: false,
});
if (!proManyCard) {
  pass("Pro with multiLocation does not show Basic upgrade card");
} else {
  fail("Pro must not show Basic multi-location upgrade card");
}

const page = read("src/app/pages/business/LocationsPage.tsx");
if (page.includes("shouldShowMultiLocationUpgradeCard") && page.includes("isAtLocationCap")) {
  pass("LocationsPage uses location-quota helpers");
} else {
  fail("LocationsPage missing location-quota helpers");
}

if (/showBasicUpgradeCard\s*=\s*ready\s*&&\s*!hasFeature\("multiLocation"\)/.test(page)) {
  fail("LocationsPage still shows upgrade for all Basic accounts");
} else {
  pass("LocationsPage does not show upgrade merely because Basic lacks multiLocation");
}

if (page.includes("business.locationsPage.empty") && !/showBasicUpgradeCard \? null/.test(page)) {
  pass("Empty locations state remains visible at 0 locations");
} else {
  fail("LocationsPage still hides empty state behind the upgrade card");
}

const failed = results.filter((r) => r.startsWith("FAIL:")).length;
console.log(results.join("\n"));
if (failed) {
  console.error(`\n${failed} locations-page quota check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} locations-page quota checks passed`);
