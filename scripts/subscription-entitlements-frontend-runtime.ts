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
import { resolveSidebarNavLock } from "../src/app/components/business/sidebar/sidebarNavLock";

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

  if (ok) pass("sidebar nav lock (basic vs pro)");
  return ok;
}

function main(): void {
  const checks = [
    testBasicCapabilities(),
    testProCapabilities(),
    testEnterpriseFeatures(),
    testSidebarLocks(),
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
