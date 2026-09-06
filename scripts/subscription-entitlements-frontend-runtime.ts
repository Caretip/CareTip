/**
 * Commit 4 — Frontend entitlement matrix + sidebar lock runtime checks.
 * Run: npm run test:subscription-entitlements-frontend
 */
import {
  capabilitiesForTier,
  hasFeature,
  hasSubscriptionCapability,
  minimumTierForFeature,
  type FeatureKey,
  type SubscriptionCapability,
} from "../src/app/lib/subscriptionCapabilities";
import { allFeatureCatalogEntries } from "../src/app/lib/subscriptionFeatureCatalog";
import { resolveSidebarNavLock } from "../src/app/components/business/sidebar/sidebarNavLock";
import { resolveQrStudioAccessBlock } from "../src/app/components/business/QrStudioAccessPanel";
import {
  ApiRequestError,
  isApiSubscriptionRequiredError,
  PLAN_CAPABILITY_REQUIRED_CODE,
  PLAN_LIMIT_EXCEEDED_CODE,
  SUBSCRIPTION_REQUIRED_CODE,
} from "../src/app/lib/apiError";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASIC_ALLOW: SubscriptionCapability[] = [
  "tipManagement",
  "employeeQr",
  "locationQr",
  "tableQr",
  "basicAnalytics",
  "qrTemplates",
  "teamManagement",
];

const BASIC_BLOCK: SubscriptionCapability[] = [
  "brandingCustomization",
  "advancedAnalytics",
  "csvExport",
  "multiLocation",
  "employeeGoals",
  "customerFeedback",
];

const PRO_ALLOW: SubscriptionCapability[] = [...BASIC_ALLOW, ...BASIC_BLOCK];

const ENTERPRISE_ONLY: FeatureKey[] = [
  "apiAccess",
  "multiBrand",
  "customReporting",
  "dedicatedOnboarding",
  "accountManager",
];

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function testBasicCapabilities(): boolean {
  let ok = true;
  for (const cap of BASIC_ALLOW) {
    if (!hasSubscriptionCapability("basic", cap)) {
      fail(`basic must allow ${cap}`);
      ok = false;
    }
  }
  for (const cap of BASIC_BLOCK) {
    if (hasSubscriptionCapability("basic", cap)) {
      fail(`basic must block ${cap}`);
      ok = false;
    }
  }
  if (ok) pass("basic capability matrix");
  return ok;
}

function testProCapabilities(): boolean {
  let ok = true;
  for (const cap of PRO_ALLOW) {
    if (!hasSubscriptionCapability("premium", cap)) {
      fail(`premium must allow ${cap}`);
      ok = false;
    }
  }
  if (ok) pass("premium (Pro) capability matrix");
  return ok;
}

function testEnterpriseFeatures(): boolean {
  let ok = true;
  for (const key of ENTERPRISE_ONLY) {
    if (hasFeature("basic", key)) {
      fail(`basic must not have enterprise feature ${key}`);
      ok = false;
    }
    if (hasFeature("premium", key)) {
      fail(`premium must not have enterprise feature ${key}`);
      ok = false;
    }
    if (!hasFeature("enterprise", key)) {
      fail(`enterprise must have ${key}`);
      ok = false;
    }
    if (minimumTierForFeature(key) !== "enterprise") {
      fail(`minimum tier for ${key} must be enterprise`);
      ok = false;
    }
  }
  if (ok) pass("enterprise-only feature keys");
  return ok;
}

function testSidebarLocks(): boolean {
  let ok = true;
  const basicView = {
    ready: true,
    hasActiveEntitlements: true,
    hasFeature: (key: FeatureKey) => hasFeature("basic", key, capabilitiesForTier("basic")),
  };

  const qrLock = resolveSidebarNavLock(
    "/dashboard/qr-studio/employees",
    "employeeQr",
    "qr-studio",
    basicView,
  );
  if (qrLock.locked || qrLock.reason !== "none") {
    fail("basic user: QR studio must be unlocked");
    ok = false;
  }

  const analyticsLock = resolveSidebarNavLock(
    "/dashboard/tips/analytics",
    "advancedAnalytics",
    "tips",
    basicView,
  );
  if (!analyticsLock.locked || analyticsLock.reason !== "upgrade_required") {
    fail("basic user: advanced analytics must be upgrade_required");
    ok = false;
  }

  if ((["activation_required"] as string[]).includes(analyticsLock.reason)) {
    fail("sidebar must not use activation_required");
    ok = false;
  }

  const proView = {
    ready: true,
    hasActiveEntitlements: true,
    hasFeature: (key: FeatureKey) => hasFeature("premium", key, capabilitiesForTier("premium")),
  };
  const proAnalytics = resolveSidebarNavLock(
    "/dashboard/tips/analytics",
    "advancedAnalytics",
    "tips",
    proView,
  );
  if (proAnalytics.locked) {
    fail("pro user: advanced analytics must be unlocked");
    ok = false;
  }

  const unsubscribed = {
    ready: true,
    hasActiveEntitlements: false,
    hasFeature: () => false,
  };
  const stripeLock = resolveSidebarNavLock(
    "/dashboard/stripe/connect",
    undefined,
    "stripe",
    unsubscribed,
  );
  if (stripeLock.locked) {
    fail("Stripe Connect must remain unlocked without a paid subscription");
    ok = false;
  }
  const stripePayoutsLock = resolveSidebarNavLock(
    "/dashboard/stripe/payouts",
    undefined,
    "stripe",
    unsubscribed,
  );
  if (stripePayoutsLock.locked) {
    fail("Stripe Payouts must remain unlocked without a paid subscription");
    ok = false;
  }
  const qrUnsub = resolveSidebarNavLock(
    "/dashboard/qr-studio",
    undefined,
    "qr-studio",
    unsubscribed,
  );
  if (qrUnsub.locked) {
    fail("QR Studio must remain unlocked without an entitled subscription");
    ok = false;
  }
  const locUnsub = resolveSidebarNavLock(
    "/dashboard/locations",
    undefined,
    undefined,
    unsubscribed,
  );
  if (locUnsub.locked) {
    fail("Locations must remain unlocked without an entitled subscription");
    ok = false;
  }

  if (ok) pass("sidebar nav lock (basic vs pro)");
  return ok;
}

function extractQuotedStringsInConstArray(source: string, constName: string): string[] {
  const marker = `const ${constName}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${constName}`);
  const bracket = source.indexOf("[", start);
  const end = source.indexOf("];", bracket);
  const body = source.slice(bracket + 1, end);
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function testFrontendBackendMatrixAlignment(): boolean {
  const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));
  const fe = readFileSync(path.join(root, "src/app/lib/subscriptionCapabilities.ts"), "utf8");
  const be = readFileSync(path.join(root, "backend/src/config/subscriptionCapabilities.ts"), "utf8");
  const feBasic = extractQuotedStringsInConstArray(fe, "BASIC_CAPABILITIES");
  const beBasic = extractQuotedStringsInConstArray(be, "BASIC_CAPABILITIES");
  const feProExtra = extractQuotedStringsInConstArray(fe, "PRO_CAPABILITIES");
  const beProExtra = extractQuotedStringsInConstArray(be, "PRO_CAPABILITIES");
  const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
  let ok = true;
  if (!same(feBasic, beBasic)) {
    fail(`BASIC_CAPABILITIES drifted FE=${feBasic.join(",")} BE=${beBasic.join(",")}`);
    ok = false;
  }
  if (!same(feProExtra, beProExtra)) {
    fail(`PRO_CAPABILITIES drifted FE=${feProExtra.join(",")} BE=${beProExtra.join(",")}`);
    ok = false;
  }
  const feHasBasicLimits = /basic:\s*\{\s*maxLocations:\s*1,\s*maxTables:\s*1\s*\}/.test(fe);
  const beHasBasicLimits = /basic:\s*\{\s*maxLocations:\s*1,\s*maxTables:\s*1\s*\}/.test(be);
  if (!feHasBasicLimits || !beHasBasicLimits) {
    fail("PLAN_LIMITS basic 1/1 drifted");
    ok = false;
  }
  if (ok) pass("frontend/backend capability matrices remain aligned (backend authoritative)");
  return ok;
}

function testErrorCodeSemantics(): boolean {
  const sub = new ApiRequestError(
    "An active subscription is required to use this feature.",
    403,
    SUBSCRIPTION_REQUIRED_CODE,
  );
  const cap = new ApiRequestError("This feature is available on Pro.", 403, PLAN_CAPABILITY_REQUIRED_CODE);
  const quota = new ApiRequestError(
    "Your plan supports one table. Upgrade to Business for multiple tables.",
    403,
    PLAN_LIMIT_EXCEEDED_CODE,
  );
  let ok = true;
  if (!isApiSubscriptionRequiredError(sub)) {
    fail("SUBSCRIPTION_REQUIRED must remain classified as subscription-required");
    ok = false;
  }
  if (isApiSubscriptionRequiredError(cap)) {
    fail("PLAN_CAPABILITY_REQUIRED must not be classified as no-subscription");
    ok = false;
  }
  if (isApiSubscriptionRequiredError(quota)) {
    fail("PLAN_LIMIT_EXCEEDED must not be classified as no-subscription");
    ok = false;
  }
  if (ok) pass("API error codes distinguish no-subscription vs capability vs quota");
  return ok;
}

function testFeatureCatalogTiers(): boolean {
  let ok = true;
  for (const entry of allFeatureCatalogEntries()) {
    const expected = minimumTierForFeature(entry.featureKey);
    if (entry.requiredTier !== expected) {
      fail(`catalog ${entry.featureKey} requiredTier=${entry.requiredTier} expected=${expected}`);
      ok = false;
    }
  }
  if (ok) pass("feature catalog requiredTier matches capability matrix");
  return ok;
}

function testPhase1EmployeeProfileRegression(): boolean {
  const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));
  const staff = readFileSync(path.join(root, "src/app/pages/business/StaffManagementPage.tsx"), "utf8");
  const employeeCtl = readFileSync(
    path.join(root, "backend/src/controllers/employee.controller.ts"),
    "utf8",
  );
  let ok = true;
  if (!staff.includes("if (canSetEmployeeGoals)") || !staff.includes("payload.monthlyGoal = nextGoal")) {
    fail("StaffManagement must send monthlyGoal only when employee goals are enabled and changed");
    ok = false;
  }
  if (!staff.includes("if (assignmentsChanged)")) {
    fail("StaffManagement must keep location/table assignment payload gating");
    ok = false;
  }
  if (!staff.includes("canCreateCustomJobTitles")) {
    fail("StaffManagement must keep custom job title entitlement");
    ok = false;
  }
  if (
    !employeeCtl.includes("enforceEmployeeGoalsIfSettingMonthlyGoal") ||
    !employeeCtl.includes("isSettingNumericMonthlyGoal")
  ) {
    fail("Employee controller must gate employeeGoals only when setting a numeric goal");
    ok = false;
  }
  if (ok) pass("Phase 1 employee ordinary-profile edit guards remain intact");
  return ok;
}

function testPhase3OperationalAccess(): boolean {
  const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));
  const layout = readFileSync(path.join(root, "src/app/pages/business/qr-studio/QrStudioLayout.tsx"), "utf8");
  const locRoutes = readFileSync(path.join(root, "backend/src/routes/locations.routes.ts"), "utf8");
  const tableRoutes = readFileSync(path.join(root, "backend/src/routes/tables.routes.ts"), "utf8");
  const locService = readFileSync(path.join(root, "backend/src/services/locations.service.ts"), "utf8");
  const tipsPage = readFileSync(path.join(root, "src/app/pages/shared/TipsActivityPage.tsx"), "utf8");
  const tipsLayout = readFileSync(path.join(root, "src/app/pages/business/tips/BusinessTipsLayout.tsx"), "utf8");
  const txRoutes = readFileSync(path.join(root, "backend/src/routes/transactions.routes.ts"), "utf8");
  let ok = true;

  if (layout.includes("hasActiveEntitlements")) {
    fail("QR Studio layout must not gate the whole module on hasActiveEntitlements");
    ok = false;
  }
  if (resolveQrStudioAccessBlock(true) !== null) {
    fail("verified QR Studio access must not return a subscription block");
    ok = false;
  }
  if (resolveQrStudioAccessBlock(false) !== "verification") {
    fail("unverified QR Studio access must remain a verification block");
    ok = false;
  }

  const getLoc = locRoutes.slice(locRoutes.indexOf("router.get"), locRoutes.indexOf("router.post"));
  if (getLoc.includes("requireOperationalSubscription")) {
    fail("GET /api/locations must not require an operational subscription");
    ok = false;
  }
  if (!locRoutes.includes("requireOperationalSubscription()")) {
    fail("POST /api/locations must keep create-time operational/quota enforcement");
    ok = false;
  }

  const getTables = tableRoutes.slice(tableRoutes.indexOf("router.get"), tableRoutes.indexOf("router.post"));
  if (getTables.includes("requireOperationalSubscription") || getTables.includes("requireFeature")) {
    fail("GET /api/tables must not require subscription or tableQr merely to view");
    ok = false;
  }
  const postTables = tableRoutes.slice(tableRoutes.indexOf("router.post"));
  if (!postTables.includes('requireFeature("tableQr")')) {
    fail("POST /api/tables must keep tableQr on create");
    ok = false;
  }

  if (
    /updateLocationForBusinessUser[\s\S]*hasActiveEntitlements/.test(locService) ||
    /deleteLocationForBusinessUser[\s\S]*hasActiveEntitlements/.test(locService)
  ) {
    fail("location update/delete must not require hasActiveEntitlements");
    ok = false;
  }

  if (!tipsPage.includes('featureKey="csvExport"')) {
    fail("tips ledger must keep CSV export Pro-gated");
    ok = false;
  }
  if (!tipsLayout.includes('featureKey="advancedAnalytics"')) {
    fail("tips reporting/analytics page must remain Pro-gated");
    ok = false;
  }
  if (!txRoutes.includes('requireFeature("csvExport")')) {
    fail("CSV export route must remain requireFeature csvExport");
    ok = false;
  }
  if (ok) pass("Phase 3 operational GET/QR Studio/tips reporting gates");
  return ok;
}

function main(): void {
  const checks = [
    testBasicCapabilities(),
    testProCapabilities(),
    testEnterpriseFeatures(),
    testSidebarLocks(),
    testFrontendBackendMatrixAlignment(),
    testErrorCodeSemantics(),
    testFeatureCatalogTiers(),
    testPhase1EmployeeProfileRegression(),
    testPhase3OperationalAccess(),
  ];
  const failed = checks.filter((c) => !c).length;
  console.log(results.join("\n"));
  if (failed > 0) {
    console.error(`\n${failed} check group(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} frontend entitlement check groups passed.`);
}

main();
