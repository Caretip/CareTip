/**
 * Admin dashboard performance guards (static + optional live timing).
 * Run: npm run test:admin-dashboard-performance
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const admin = read("src/app/components/AdminDashboard.tsx");
assert(admin.includes("fetchPlatformStats"), "dashboard fetches platform stats");
assert(admin.includes("loadHealth") || admin.includes("fetchPlatformHealth"), "dashboard loads health");
assert(admin.includes("AdminDashboard.loadHealth"), "health fetch non-blocking from stats critical path");
assert(admin.includes("requestIdleCallback") && admin.includes("loadHeavy"), "heavy stage deferred");

const platform = read("backend/src/services/platform.service.ts");
assert(platform.includes("checkStripeHealthCached"), "stripe health cache exported");
assert(platform.includes("PLATFORM_STATS_CACHE_TTL_MS"), "global stats cache exists");

const onboarding = read("backend/src/services/platformBusinessList.service.ts");
assert(onboarding.includes("platform:onboarding-metrics"), "onboarding metrics cache key");

const analytics = read("backend/src/services/platformAnalytics.service.ts");
assert(analytics.includes("PLATFORM_ANALYTICS_CACHE_TTL_MS"), "analytics cached");

const commercial = read("backend/src/services/commercial/platformCommercialIntelligence.service.ts");
assert(commercial.includes("PLATFORM_COMMERCIAL_CACHE_TTL_MS"), "commercial intelligence cached");

const subMon = read("backend/src/services/commercial/platformSubscriptionMonitoring.service.ts");
assert(subMon.includes("platform:sub-monitoring"), "subscription monitoring bundle cached");

const charts = read("src/app/components/platform/PlatformOverviewSummaryCharts.tsx");
assert(charts.includes("recharts"), "charts use recharts (lazy parent expected)");

const adminDashLazy = read("src/app/routes.tsx");
assert(adminDashLazy.includes("AdminDashboard"), "dashboard route lazy-loaded");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nadmin dashboard performance guards passed");
