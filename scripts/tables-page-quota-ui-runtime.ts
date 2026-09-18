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

if (basicLimits.maxLocations === 1 && basicLimits.maxTables === null) {
  pass("Basic limits: 1 location / unlimited tables");
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

const basicUnlimited = {
  ready: true,
  tableQrEnabled: true,
  maxTables: null as number | null,
  tableCount: 0,
};
if (
  !isAtTableCap(basicUnlimited) &&
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

const basicManyUnlimited = isAtTableCap({
  ready: true,
  tableQrEnabled: true,
  maxTables: null,
  tableCount: 5,
});
const basicManySurface = resolveTablesPageMainSurface({
  ready: true,
  tableQrEnabled: true,
  showInitialSkeleton: false,
  locationCount: 1,
  tableCount: 5,
});
if (
  !basicManyUnlimited &&
  basicManySurface === "list" &&
  !shouldShowTableQuotaNotice({ tableQrEnabled: true, atTableCap: false }) &&
  !isTablesCreateDisabled({ isBusiness: true, ready: true, tableQrEnabled: true, atTableCap: false })
) {
  pass("Basic many tables (unlimited): list shown, Create enabled, no quota notice");
} else {
  fail("Basic unlimited tables must keep Create enabled without quota notice");
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
const management = read("src/app/pages/business/LocationsPage.tsx");
const quotaCapUsesTableQrCard =
  /atTableCap[\s\S]{0,180}LockedFeatureCard featureKey="tableQr"/.test(page) ||
  /ready && atTableCap \?[\s\S]{0,120}LockedFeatureCard featureKey="tableQr"/.test(page);
if (!quotaCapUsesTableQrCard) {
  pass("QR Studio TablesPage does not use LockedFeatureCard tableQr for atTableCap");
} else {
  fail("TablesPage still binds atTableCap to LockedFeatureCard tableQr");
}

if (!page.includes('featureKey="multiLocation"') && !management.includes('featureKey="multiLocation"')) {
  pass("Tables surfaces do not use multiLocation lock");
} else {
  fail("Tables still references multiLocation");
}

if (page.includes("LockedFeatureCard featureKey=\"tableQr\"") && page.includes("mainSurface === \"capability-lock\"")) {
  pass("Genuine tableQr lock remains on QR Studio capability-lock surface");
} else {
  fail("Genuine tableQr LockedFeatureCard missing");
}

if (
  management.includes("business.tablesPage.quotaTitle") &&
  management.includes("business.tablesPage.quotaBody") &&
  management.includes("isTablesCreateDisabled")
) {
  pass("Locations / Tables page uses table-limit quota copy and create disable");
} else {
  fail("Locations / Tables page missing quota i18n keys");
}

if (management.includes("subscription.upgrade.upgradeToPremium") || management.includes("UpgradeCta")) {
  fail("Locations / Tables quota path must not use UpgradeCta / Upgrade to Pro");
} else {
  pass("Locations / Tables quota UI does not use UpgradeCta");
}

if (!page.includes("createTableAPI") && !page.includes('t("business.tablesPage.create")')) {
  pass("QR Studio TablesPage does not show Create Table");
} else {
  fail("QR Studio still contains table creation");
}

const failed = results.filter((r) => r.startsWith("FAIL:")).length;
console.log(results.join("\n"));
if (failed) {
  console.error(`\n${failed} tables-page quota check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} tables-page quota checks passed`);
