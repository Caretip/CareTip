/**
 * Tables page: tableQr capability lock vs Basic maxTables quota UI.
 * Run: npm run test:tables-page-quota-ui
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPlanLimitsForTier, hasFeature } from "../src/app/lib/subscriptionCapabilities";
import {
  isAtTableCap,
  isTablesCreateDisabled,
  resolveTablesPageMainSurface,
  shouldShowTableQuotaNotice,
} from "../src/app/lib/tablesPageQuotaUi";

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

if (hasFeature("basic", "tableQr") && !hasFeature("basic", "multiLocation")) {
  pass("Basic has tableQr and not multiLocation");
} else {
  fail("Basic tableQr / multiLocation matrix drifted");
}

if (proLimits.maxTables == null && hasFeature("premium", "tableQr")) {
  pass("Pro tableQr unlimited (null maxTables)");
} else {
  fail("Pro table limits drifted");
}

const basicZero = {
  ready: true,
  tableQrEnabled: true,
  maxTables: 1 as number | null,
  tableCount: 0,
};
if (
  !isAtTableCap(basicZero) &&
  !isTablesCreateDisabled({ isBusiness: true, ready: true, tableQrEnabled: true, atTableCap: false }) &&
  resolveTablesPageMainSurface({
    ready: true,
    tableQrEnabled: true,
    showInitialSkeleton: false,
    locationCount: 1,
    tableCount: 0,
  }) === "empty" &&
  !shouldShowTableQuotaNotice({ tableQrEnabled: true, atTableCap: false })
) {
  pass("Basic 0 tables: empty surface, Create enabled, no quota notice");
} else {
  fail("Basic 0 tables surface/create/quota");
}

const basicOneAtCap = isAtTableCap({
  ready: true,
  tableQrEnabled: true,
  maxTables: 1,
  tableCount: 1,
});
const basicOneSurface = resolveTablesPageMainSurface({
  ready: true,
  tableQrEnabled: true,
  showInitialSkeleton: false,
  locationCount: 1,
  tableCount: 1,
});
if (
  basicOneAtCap &&
  basicOneSurface === "list" &&
  shouldShowTableQuotaNotice({ tableQrEnabled: true, atTableCap: true }) &&
  isTablesCreateDisabled({ isBusiness: true, ready: true, tableQrEnabled: true, atTableCap: true })
) {
  pass("Basic 1 table: list still shown, quota notice, Create disabled");
} else {
  fail("Basic 1 table must keep list + quota + disabled Create");
}

const proMany = {
  ready: true,
  tableQrEnabled: true,
  maxTables: null as number | null,
  tableCount: 3,
};
if (
  !isAtTableCap(proMany) &&
  !isTablesCreateDisabled({ isBusiness: true, ready: true, tableQrEnabled: true, atTableCap: false }) &&
  resolveTablesPageMainSurface({
    ready: true,
    tableQrEnabled: true,
    showInitialSkeleton: false,
    locationCount: 2,
    tableCount: 3,
  }) === "list" &&
  !shouldShowTableQuotaNotice({ tableQrEnabled: true, atTableCap: false })
) {
  pass("Pro multiple tables: list, Create enabled, no quota notice");
} else {
  fail("Pro tables quota/create");
}

if (
  resolveTablesPageMainSurface({
    ready: true,
    tableQrEnabled: false,
    showInitialSkeleton: false,
    locationCount: 1,
    tableCount: 1,
  }) === "capability-lock" &&
  isTablesCreateDisabled({ isBusiness: true, ready: true, tableQrEnabled: false, atTableCap: false }) &&
  !shouldShowTableQuotaNotice({ tableQrEnabled: false, atTableCap: false })
) {
  pass("No tableQr entitlement: capability lock, Create disabled, no quota notice");
} else {
  fail("Genuine tableQr lock must remain");
}

const page = read("src/app/pages/business/TablesPage.tsx");
const quotaCapUsesTableQrCard =
  /atTableCap[\s\S]{0,180}LockedFeatureCard featureKey="tableQr"/.test(page) ||
  /ready && atTableCap \?[\s\S]{0,120}LockedFeatureCard featureKey="tableQr"/.test(page);
if (!quotaCapUsesTableQrCard) {
  pass("TablesPage does not use LockedFeatureCard tableQr for atTableCap");
} else {
  fail("TablesPage still binds atTableCap to LockedFeatureCard tableQr");
}

if (!page.includes('featureKey="multiLocation"')) {
  pass("TablesPage does not use multiLocation lock");
} else {
  fail("TablesPage still references multiLocation");
}

if (page.includes("LockedFeatureCard featureKey=\"tableQr\"") && page.includes("mainSurface === \"capability-lock\"")) {
  pass("Genuine tableQr lock remains on capability-lock surface");
} else {
  fail("Genuine tableQr LockedFeatureCard missing");
}

if (page.includes("business.tablesPage.quotaTitle") && page.includes("business.tablesPage.quotaBody")) {
  pass("TablesPage uses table-limit quota copy");
} else {
  fail("TablesPage missing quota i18n keys");
}

if (page.includes("subscription.upgrade.upgradeToPremium") || page.includes("UpgradeCta")) {
  fail("TablesPage quota path must not use UpgradeCta / Upgrade to Pro");
} else {
  pass("TablesPage quota UI does not use UpgradeCta");
}

const failed = results.filter((r) => r.startsWith("FAIL:")).length;
console.log(results.join("\n"));
if (failed) {
  console.error(`\n${failed} tables-page quota check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} tables-page quota checks passed`);
