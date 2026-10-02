/**
 * Dashboard performance: shared entitlements, no duplicate profile fetches, admin staging.
 * Run: npm run test:dashboard-performance
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const businessLayout = read("src/app/layouts/BusinessLayout.tsx");
if (
  businessLayout.includes("<BusinessEntitlementsProvider>") &&
  businessLayout.includes("<BusinessSidebar") &&
  businessLayout.indexOf("<BusinessEntitlementsProvider>") < businessLayout.indexOf("<BusinessSidebar")
) {
  pass("Business entitlements provider wraps sidebar + outlet (single profile fetch)");
} else {
  fail("BusinessEntitlementsProvider must wrap sidebar, not only the outlet");
}

const employeeLayout = read("src/app/layouts/EmployeeLayout.tsx");
if (
  employeeLayout.includes("<EmployeeEntitlementsProvider>") &&
  employeeLayout.includes("<EmployeeSidebar") &&
  employeeLayout.indexOf("<EmployeeEntitlementsProvider>") < employeeLayout.indexOf("<EmployeeSidebar")
) {
  pass("Employee entitlements provider wraps sidebar + outlet");
} else {
  fail("EmployeeEntitlementsProvider must wrap the employee shell");
}

const employeeDash = read("src/app/pages/employee/EmployeeDashboard.tsx");
if (
  employeeDash.includes("useEmployeeEntitlementsContext") &&
  employeeDash.includes("peekEmployeeProfileCache") &&
  employeeDash.includes("isEntitlementsSessionPrimed")
) {
  pass("Employee dashboard reuses shell entitlements and cached profile");
} else {
  fail("Employee dashboard still independently bootstraps entitlements/profile");
}

const employeeAnalytics = read("src/app/hooks/useEmployeeDashboardAnalytics.ts");
if (
  employeeAnalytics.includes("needsInitialPeriodNetwork") &&
  employeeAnalytics.includes("inflight_attach_incomplete") &&
  employeeAnalytics.includes("mount_load_start")
) {
  pass("Employee analytics start on activate without waiting for a period toggle");
} else {
  fail("Employee analytics still defer the first period fetch behind a toggle");
}

const businessDashStats = read("src/app/hooks/useBusinessDashboardStats.ts");
if (
  businessDashStats.includes('scope: advancedAnalyticsEnabledRef.current ? "aboveFold" : "summary"') &&
  businessDashStats.includes('scope: "analytics"') &&
  !businessDashStats.includes('scope: advancedAnalyticsEnabledRef.current ? "full"')
) {
  pass("Business overview stats split aboveFold KPIs from deferred analytics scope");
} else {
  fail("useBusinessDashboardStats must not block KPIs on scope=full");
}

const feedback = read("src/app/components/business/RecentCustomerFeedbackPanel.tsx");
if (
  feedback.includes("useBusinessEntitlementsContext") &&
  feedback.includes("businessEntitlements == null")
) {
  pass("Customer feedback teaser reuses business entitlements context");
} else {
  fail("RecentCustomerFeedbackPanel must not fetch entitlements independently when context exists");
}

if (!feedback.includes("useInViewActive") && !feedback.includes("panelVisible")) {
  pass("Customer feedback teaser does not gate API on viewport scroll");
} else {
  fail("RecentCustomerFeedbackPanel must not require scroll to start feedback fetch");
}

const featureGate = read("src/app/components/subscription/FeatureGate.tsx");
if (
  featureGate.includes("useEmployeeEntitlementsContext") &&
  featureGate.includes("useSharedEmployee") &&
  featureGate.includes("enabled && !useSharedBusiness && !useSharedEmployee")
) {
  pass("FeatureGate reuses business and employee entitlement contexts");
} else {
  fail("FeatureGate duplicate entitlement fetch not gated");
}

const admin = read("src/app/components/AdminDashboard.tsx");
if (
  admin.includes('user?.role !== "platform_admin"') &&
  admin.includes("requestIdleCallback") &&
  admin.includes("loadHeavy") &&
  admin.includes("take: VERIFICATION_TEASER_LIMIT") &&
  admin.includes("take: RECENT_ACTIVITY_LIMIT") &&
  admin.includes("fetchPlatformStats") &&
  admin.includes("loadHealth")
) {
  pass("Admin overview waits for auth, stats-first KPIs, defers heavy APIs, bounded lists");
} else {
  fail("AdminDashboard staging/auth/bounded lists drifted");
}

const platformSvc = read("backend/src/services/platform.service.ts");
if (platformSvc.includes("checkStripeHealthCached") && platformSvc.includes("platform:stripe-health")) {
  pass("Platform Stripe health uses short-lived cache for admin dashboard");
} else {
  fail("checkStripeHealthCached missing");
}

const onboardingList = read("backend/src/services/platformBusinessList.service.ts");
if (onboardingList.includes("platform:onboarding-metrics") && onboardingList.includes("getCachedOrLoad")) {
  pass("Onboarding queue metrics cached for dashboard secondary stage");
} else {
  fail("Onboarding metrics cache missing");
}

if (admin.includes("fetchPlatformCommercialIntelligence") && admin.includes("loadHeavy")) {
  pass("Admin still loads commercial intelligence (counts not hardcoded)");
} else {
  fail("Admin commercial metrics must remain real API data");
}

const api = read("src/app/lib/api.ts");
if (api.includes("export function peekEmployeeProfileCache") && api.includes("employeeProfileInflight")) {
  pass("Employee profile client cache/peek remains for request reuse");
} else {
  fail("Employee profile cache helpers drifted");
}

const prismaSchema = read("backend/prisma/schema.prisma");
if (
  prismaSchema.includes("model Table") &&
  prismaSchema.includes("@@index([locationId])") &&
  prismaSchema.includes('@@map("venue_tables")')
) {
  pass("venue_tables.location_id is indexed for location-scoped table queries");
} else {
  fail("Table.locationId index missing from Prisma schema");
}

const physicalQrOrders = read("backend/src/services/physicalQr/physicalQrOrder.service.ts");
if (
  physicalQrOrders.includes("listPhysicalQrOrdersForBusiness") &&
  physicalQrOrders.includes('orderBy: { placedAt: "desc" }')
) {
  pass("Physical QR business history uses placedAt (composite businessId+placedAt index)");
} else {
  fail("Physical QR business list must order by placedAt");
}

const failed = results.filter((r) => r.startsWith("FAIL:"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} dashboard-performance check(s) failed`);
  process.exit(1);
}
console.log("\nAll dashboard-performance checks passed");
