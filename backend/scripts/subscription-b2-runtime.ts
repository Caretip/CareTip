/**
 * Phase B.2.1 — Backend entitlement enforcement runtime checks.
 * Run: npm run test:subscription-b2
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { BusinessSubscriptionTier } from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  businessTipsQueryRequiresAdvancedAnalytics,
  employeeTipsListQueryRequiresAdvancedAnalytics,
  type FeatureKey,
  type SubscriptionCapability,
  capabilitiesForTier,
  hasSubscriptionCapability,
} from "../src/config/subscriptionCapabilities.js";
import { buildNestedSubscriptionCreateData } from "../src/services/subscription.service.js";
import {
  PLAN_LIMIT_EXCEEDED_CODE,
  getSubscriptionTierForBusinessId,
  hasFeature,
  hasFeatureForTier,
  isEntitlementDeniedError,
  maskEmployeeGoalsInResponse,
} from "../src/services/subscriptionEntitlement.service.js";
import { createLocationForBusinessUser, deleteLocationForBusinessUser, listLocationsForBusinessUser, updateLocationForBusinessUser } from "../src/services/locations.service.js";
import { createTableForBusinessUser, listTablesForBusinessUser } from "../src/services/tables.service.js";
import { updateManagerBusinessProfile } from "../src/services/business.service.js";

const BASIC_CAPS: SubscriptionCapability[] = [
  "tipManagement",
  "employeeQr",
  "locationQr",
  "tableQr",
  "basicAnalytics",
  "qrTemplates",
  "physicalQrPrinting",
  "teamManagement",
];

const PRO_ONLY_CAPS: FeatureKey[] = [
  "brandingCustomization",
  "advancedAnalytics",
  "csvExport",
  "multiLocation",
  "employeeGoals",
  "customerFeedback",
];

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function createTestBusiness(
  tier: BusinessSubscriptionTier,
): Promise<{ businessId: string; userId: string }> {
  const tag = `b2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: {
          name: `${tag} venue`,
          slug: `${tag}-venue`,
          subscriptionTier: tier,
          subscription: {
            create: buildNestedSubscriptionCreateData({
              subscriptionTier: tier,
              source: "email_signup",
            }),
          },
        },
      },
    },
    include: { business: true },
  });
  if (!user.business) throw new Error("business missing after create");
  return { businessId: user.business.id, userId: user.id };
}

async function createUnentitledTestBusiness(): Promise<{ businessId: string; userId: string }> {
  const tag = `b2-none-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      business: {
        create: {
          name: `${tag} venue`,
          slug: `${tag}-venue`,
        },
      },
    },
    include: { business: true },
  });
  if (!user.business) throw new Error("business missing after create");
  return { businessId: user.business.id, userId: user.id };
}

function testTierMatrix(): boolean {
  let ok = true;
  for (const feature of BASIC_CAPS) {
    if (!hasFeatureForTier(BusinessSubscriptionTier.basic, feature)) {
      fail(`basic must have capability ${feature}`);
      ok = false;
    }
    if (!hasFeatureForTier(BusinessSubscriptionTier.premium, feature)) {
      fail(`premium must have capability ${feature}`);
      ok = false;
    }
  }
  for (const feature of PRO_ONLY_CAPS) {
    if (hasFeatureForTier(BusinessSubscriptionTier.basic, feature)) {
      fail(`basic must not have pro capability ${feature}`);
      ok = false;
    }
    if (!hasFeatureForTier(BusinessSubscriptionTier.premium, feature)) {
      fail(`premium must have pro capability ${feature}`);
      ok = false;
    }
    if (!hasFeatureForTier(BusinessSubscriptionTier.enterprise, feature)) {
      fail(`enterprise must have pro capability ${feature}`);
      ok = false;
    }
  }
  if (ok) {
    pass("tier matrix: basic limited, pro advanced on premium+");
  }
  return ok;
}

function testTipsQueryHelpers(): boolean {
  let ok = true;
  if (!businessTipsQueryRequiresAdvancedAnalytics({ scope: "full" })) {
    fail("business tips: scope=full should require advanced analytics");
    ok = false;
  }
  if (!businessTipsQueryRequiresAdvancedAnalytics({ scope: "analytics" })) {
    fail("business tips: scope=analytics should require advanced analytics");
    ok = false;
  }
  if (businessTipsQueryRequiresAdvancedAnalytics({ range: "week" })) {
    fail("business tips: preset range only should not require advanced analytics");
    ok = false;
  }
  if (businessTipsQueryRequiresAdvancedAnalytics({ employeeId: "emp-1" })) {
    fail("business tips: employee filter must not require advanced analytics");
    ok = false;
  }
  if (businessTipsQueryRequiresAdvancedAnalytics({ locationId: "loc-1" })) {
    fail("business tips: location filter must not require advanced analytics");
    ok = false;
  }
  if (businessTipsQueryRequiresAdvancedAnalytics({ tableId: "tbl-1" })) {
    fail("business tips: table filter must not require advanced analytics");
    ok = false;
  }
  if (businessTipsQueryRequiresAdvancedAnalytics({ range: "custom" })) {
    fail("business tips: custom range must not require advanced analytics");
    ok = false;
  }
  if (employeeTipsListQueryRequiresAdvancedAnalytics({ range: "custom" })) {
    fail("employee tips list: custom range must not require advanced analytics");
    ok = false;
  }
  if (employeeTipsListQueryRequiresAdvancedAnalytics({ range: "month" })) {
    fail("employee tips list: preset month should not require advanced analytics");
    ok = false;
  }
  if (ok) pass("tips query helpers: filters operational, reporting scopes remain Pro");
  return ok;
}

function testMaskEmployeeGoals(): boolean {
  const masked = maskEmployeeGoalsInResponse(
    { goal: { id: "g1" }, monthlyGoal: 100, tips: [] },
    false,
  );
  if (masked.goal !== null || masked.monthlyGoal !== null) {
    fail("maskEmployeeGoalsInResponse should null goal fields when disabled");
    return false;
  }
  const kept = maskEmployeeGoalsInResponse(
    { goal: { id: "g1" }, monthlyGoal: 100 },
    true,
  );
  if (kept.goal === null || kept.monthlyGoal === null) {
    fail("maskEmployeeGoalsInResponse should preserve goal fields when enabled");
    return false;
  }
  pass("maskEmployeeGoalsInResponse strips goals for basic tier responses");
  return true;
}

async function testMissingTierDefaultsNone(): Promise<boolean> {
  const tier = await getSubscriptionTierForBusinessId("nonexistent-business-id-b21");
  if (tier !== null) {
    fail(`missing business tier should be null, got ${tier}`);
    return false;
  }
  pass("getSubscriptionTierForBusinessId: missing business returns null");
  return true;
}

async function testHasFeatureDbTiers(): Promise<boolean> {
  const basic = await createTestBusiness(BusinessSubscriptionTier.basic);
  const premium = await createTestBusiness(BusinessSubscriptionTier.premium);
  const enterprise = await createTestBusiness(BusinessSubscriptionTier.enterprise);

  let ok = true;
  for (const feature of BASIC_CAPS) {
    if (!(await hasFeature(basic.businessId, feature))) {
      fail(`hasFeature DB: basic business should have ${feature}`);
      ok = false;
    }
  }
  for (const feature of PRO_ONLY_CAPS) {
    if (await hasFeature(basic.businessId, feature)) {
      fail(`hasFeature DB: basic business should not have ${feature}`);
      ok = false;
    }
    if (!(await hasFeature(premium.businessId, feature))) {
      fail(`hasFeature DB: premium business should have ${feature}`);
      ok = false;
    }
    if (!(await hasFeature(enterprise.businessId, feature))) {
      fail(`hasFeature DB: enterprise business should have ${feature}`);
      ok = false;
    }
  }
  if (ok) {
    pass("hasFeature(businessId): basic limited, pro features on premium + enterprise");
  }
  return ok;
}

async function testMultiLocationBasicCap(): Promise<boolean> {
  const { userId } = await createTestBusiness(BusinessSubscriptionTier.basic);
  await createLocationForBusinessUser(userId, "Primary site");
  try {
    await createLocationForBusinessUser(userId, "Second site");
    fail("basic tier should not create a second location");
    return false;
  } catch (err) {
    if (!isEntitlementDeniedError(err)) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`basic second location: expected quota entitlement error, got: ${msg}`);
      return false;
    }
    if (err.payload.code !== PLAN_LIMIT_EXCEEDED_CODE) {
      fail(`basic second location: expected PLAN_LIMIT_EXCEEDED, got ${err.payload.code}`);
      return false;
    }
    if (!err.payload.message.includes("one location")) {
      fail(`basic second location: unexpected message: ${err.payload.message}`);
      return false;
    }
    if (/active subscription is required/i.test(err.payload.message)) {
      fail("basic second location must not use subscription-required copy");
      return false;
    }
  }
  pass("multi-location: basic first location allowed, second blocked as quota");
  return true;
}

async function testMultiLocationPremiumUnlimited(): Promise<boolean> {
  const { userId } = await createTestBusiness(BusinessSubscriptionTier.premium);
  await createLocationForBusinessUser(userId, "Site A");
  await createLocationForBusinessUser(userId, "Site B");
  pass("multi-location: premium may create multiple locations");
  return true;
}

async function testTablesBasicCap(): Promise<boolean> {
  const { userId } = await createTestBusiness(BusinessSubscriptionTier.basic);
  const loc = await createLocationForBusinessUser(userId, "Dining room");
  await createTableForBusinessUser(userId, { name: "Table 1", locationId: loc.id });
  try {
    await createTableForBusinessUser(userId, { name: "Table 2", locationId: loc.id });
    fail("basic tier should not create a second table");
    return false;
  } catch (err) {
    if (!isEntitlementDeniedError(err)) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`basic second table: expected quota entitlement error, got: ${msg}`);
      return false;
    }
    if (err.payload.code !== PLAN_LIMIT_EXCEEDED_CODE) {
      fail(`basic second table: expected PLAN_LIMIT_EXCEEDED, got ${err.payload.code}`);
      return false;
    }
    if (!err.payload.message.includes("one table")) {
      fail(`basic second table: unexpected message: ${err.payload.message}`);
      return false;
    }
    if (/active subscription is required/i.test(err.payload.message)) {
      fail("basic second table must not use subscription-required copy");
      return false;
    }
    if (/multi-location/i.test(err.payload.message)) {
      fail("basic second table must not use multi-location copy");
      return false;
    }
  }
  pass("tables: basic first table allowed, second blocked as quota");
  return true;
}

async function testOperationalAccessWithoutEntitlement(): Promise<boolean> {
  const unentitled = await createUnentitledTestBusiness();
  const other = await createTestBusiness(BusinessSubscriptionTier.basic);
  const loc = await prisma.location.create({
    data: { name: "Owned site", businessId: unentitled.businessId },
  });
  await prisma.table.create({
    data: {
      name: "Owned table",
      locationId: loc.id,
      qrSlug: `t-${unentitled.businessId.slice(0, 12)}`,
    },
  });

  const listed = await listLocationsForBusinessUser(unentitled.userId);
  if (!listed.some((row) => row.id === loc.id)) {
    fail("unentitled manager must GET their own locations");
    return false;
  }
  const tables = await listTablesForBusinessUser(unentitled.userId);
  if (!tables.some((row) => row.name === "Owned table")) {
    fail("unentitled manager must GET their own tables");
    return false;
  }

  const renamed = await updateLocationForBusinessUser(unentitled.userId, loc.id, "Renamed site");
  if (renamed.name !== "Renamed site") {
    fail("unentitled manager must edit an owned location");
    return false;
  }

  try {
    await updateLocationForBusinessUser(other.userId, loc.id, "Hijack");
    fail("cross-business location update must be rejected");
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/not found/i.test(msg)) {
      fail(`cross-business update: unexpected error ${msg}`);
      return false;
    }
  }

  await updateManagerBusinessProfile(unentitled.userId, { name: "Unentitled venue" });

  await deleteLocationForBusinessUser(unentitled.userId, loc.id);
  const afterDelete = await listLocationsForBusinessUser(unentitled.userId);
  if (afterDelete.some((row) => row.id === loc.id)) {
    fail("owned location delete did not remove the row");
    return false;
  }

  pass("operational GET/edit/delete locations+tables do not require a subscription");
  return true;
}

async function testBasicProfileAndLocationLifecycle(): Promise<boolean> {
  const { userId } = await createTestBusiness(BusinessSubscriptionTier.basic);
  await updateManagerBusinessProfile(userId, { name: "Basic profile venue" });
  const loc = await createLocationForBusinessUser(userId, "First site");
  const edited = await updateLocationForBusinessUser(userId, loc.id, "First site edited");
  if (edited.name !== "First site edited") {
    fail("basic manager must edit the existing location");
    return false;
  }
  await deleteLocationForBusinessUser(userId, loc.id);
  await createLocationForBusinessUser(userId, "Recreated site");
  pass("basic profile edit, location edit/delete, and recreate-after-delete follow quota");
  return true;
}

async function main() {
  let ok = true;
  ok = testTierMatrix() && ok;
  ok = testTipsQueryHelpers() && ok;
  ok = testMaskEmployeeGoals() && ok;
  ok = (await testMissingTierDefaultsNone()) && ok;
  ok = (await testHasFeatureDbTiers()) && ok;
  ok = (await testMultiLocationBasicCap()) && ok;
  ok = (await testMultiLocationPremiumUnlimited()) && ok;
  ok = (await testTablesBasicCap()) && ok;
  ok = (await testOperationalAccessWithoutEntitlement()) && ok;
  ok = (await testBasicProfileAndLocationLifecycle()) && ok;

  if (capabilitiesForTier(BusinessSubscriptionTier.basic).length !== BASIC_CAPS.length) {
    fail("basic tier capability count mismatch");
    ok = false;
  } else {
    pass("capabilitiesForTier: basic returns limited capability set");
  }

  console.log("Phase B.2.1 backend entitlements runtime checks\n");
  for (const line of results) {
    console.log(line);
  }

  if (!ok) {
    process.exitCode = 1;
    console.log("\nRESULT: FAIL");
    return;
  }
  console.log("\nRESULT: PASS");
}

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
