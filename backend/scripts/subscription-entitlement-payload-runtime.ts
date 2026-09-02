/**
 * Phase 2 — subscription vs capability vs quota error payload semantics.
 * Run: npm run test:subscription-entitlement-payload --prefix backend
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { BusinessSubscriptionTier } from "@prisma/client";
import {
  capabilitiesForTier,
  getPlanLimitsForTier,
} from "../src/config/subscriptionCapabilities.js";
import {
  EMPTY_SUBSCRIPTION_ENTITLEMENTS,
  PLAN_CAPABILITY_REQUIRED_CODE,
  PLAN_LIMIT_EXCEEDED_CODE,
  SUBSCRIPTION_REQUIRED_CODE,
  featureAccessDeniedPayload,
  planLimitExceededPayload,
  subscriptionRequiredPayload,
  type SubscriptionEntitlementState,
} from "../src/services/subscriptionEntitlement.service.js";
import { prisma } from "../src/prisma.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const INTERNAL_LEAK =
  /premium|enterprise|employeeGoals|tableQr|SUBSCRIPTION_REQUIRED|PLAN_LIMIT_EXCEEDED|PLAN_CAPABILITY_REQUIRED|\bbasic\b/i;

function entitledBasicState(): SubscriptionEntitlementState {
  return {
    status: "active",
    plan: "basic",
    capabilities: capabilitiesForTier(BusinessSubscriptionTier.basic),
    limits: getPlanLimitsForTier(BusinessSubscriptionTier.basic),
    subscriptionTier: BusinessSubscriptionTier.basic,
    hasActiveEntitlements: true,
    accessSource: "subscription",
    sponsoredProgrammeKey: null,
  };
}

function assertFriendlyMessage(label: string, message: string): boolean {
  if (!message.trim()) {
    fail(`${label}: empty user message`);
    return false;
  }
  if (INTERNAL_LEAK.test(message)) {
    fail(`${label}: user message leaked internal value: ${message}`);
    return false;
  }
  return true;
}

let ok = true;

const noEntitlement = subscriptionRequiredPayload("employeeGoals");
if (
  noEntitlement.code === SUBSCRIPTION_REQUIRED_CODE &&
  /active subscription is required/i.test(noEntitlement.message) &&
  assertFriendlyMessage("no entitlement", noEntitlement.message)
) {
  pass("no entitlement → SUBSCRIPTION_REQUIRED + active-subscription copy");
} else {
  fail("no entitlement payload");
  ok = false;
}

const missingPro = featureAccessDeniedPayload(entitledBasicState(), "employeeGoals");
if (
  missingPro.code === PLAN_CAPABILITY_REQUIRED_CODE &&
  /available on Pro/i.test(missingPro.message) &&
  !/active subscription is required/i.test(missingPro.message) &&
  assertFriendlyMessage("missing Pro capability", missingPro.message)
) {
  pass("entitled Basic missing Pro capability → PLAN_CAPABILITY_REQUIRED, not subscription-required");
} else {
  fail(`missing Pro capability payload: ${JSON.stringify(missingPro)}`);
  ok = false;
}

const noSubSameFeature = featureAccessDeniedPayload(EMPTY_SUBSCRIPTION_ENTITLEMENTS, "employeeGoals");
if (
  noSubSameFeature.code === SUBSCRIPTION_REQUIRED_CODE &&
  /active subscription is required/i.test(noSubSameFeature.message)
) {
  pass("unentitled + missing capability still uses subscription-required");
} else {
  fail("unentitled featureAccessDeniedPayload drifted");
  ok = false;
}

const tableQuota = planLimitExceededPayload("tables", BusinessSubscriptionTier.basic);
if (
  tableQuota.code === PLAN_LIMIT_EXCEEDED_CODE &&
  /one table/i.test(tableQuota.message) &&
  !/active subscription is required/i.test(tableQuota.message) &&
  !/multi-location/i.test(tableQuota.message) &&
  assertFriendlyMessage("table quota", tableQuota.message)
) {
  pass("table quota → PLAN_LIMIT_EXCEEDED, distinct from subscription-required");
} else {
  fail(`table quota payload: ${JSON.stringify(tableQuota)}`);
  ok = false;
}

const locationQuota = planLimitExceededPayload("locations", BusinessSubscriptionTier.basic);
if (
  locationQuota.code === PLAN_LIMIT_EXCEEDED_CODE &&
  /one location/i.test(locationQuota.message) &&
  !/active subscription is required/i.test(locationQuota.message) &&
  assertFriendlyMessage("location quota", locationQuota.message)
) {
  pass("location quota → PLAN_LIMIT_EXCEEDED, distinct from subscription-required");
} else {
  fail(`location quota payload: ${JSON.stringify(locationQuota)}`);
  ok = false;
}

const basicLimits = getPlanLimitsForTier(BusinessSubscriptionTier.basic);
const proLimits = getPlanLimitsForTier(BusinessSubscriptionTier.premium);
if (basicLimits.maxLocations === 1 && basicLimits.maxTables === 1) {
  pass("Basic limits remain 1 location / 1 table");
} else {
  fail(`Basic limits drifted: ${JSON.stringify(basicLimits)}`);
  ok = false;
}
if (proLimits.maxLocations == null && proLimits.maxTables == null) {
  pass("Pro location/table limits remain unlimited");
} else {
  fail(`Pro limits drifted: ${JSON.stringify(proLimits)}`);
  ok = false;
}

const basicCaps = capabilitiesForTier(BusinessSubscriptionTier.basic);
if (basicCaps.includes("tableQr") && !basicCaps.includes("multiLocation") && !basicCaps.includes("employeeGoals")) {
  pass("Basic has tableQr; multiLocation and employeeGoals remain Pro");
} else {
  fail("Basic capability matrix drifted");
  ok = false;
}

console.log("Phase 2 entitlement payload semantics\n");
console.log(results.join("\n"));
if (!ok) {
  console.error("\nRESULT: FAIL");
  process.exitCode = 1;
} else {
  console.log("\nRESULT: PASS");
}

void prisma.$disconnect();
