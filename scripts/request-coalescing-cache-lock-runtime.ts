/**
 * Request coalescing + cache-lock architecture regression (static + behavioral).
 * Run: npm run test:request-coalescing-cache-lock
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(root);

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

const shortCache = read("backend/src/utils/shortLivedCache.ts");
if (shortCache.includes("inflight") && shortCache.includes("getCachedOrLoad")) {
  pass("Backend shortLivedCache combines TTL cache with in-flight dedupe");
} else {
  fail("shortLivedCache must dedupe concurrent loaders");
}

const serialized = read("backend/src/utils/serializedByKey.ts");
if (serialized.includes("runSerializedByKey")) {
  pass("Backend runSerializedByKey serializes hot dashboard DB paths");
} else {
  fail("serializedByKey missing");
}

const businessSvc = read("backend/src/services/business.service.ts");
if (
  businessSvc.includes("getCachedOrLoad") &&
  businessSvc.includes("runSerializedByKey(`biz-stats-aboveFold:")
) {
  pass("Business stats use cache lock + serialized key per business/timeframe/scope");
} else {
  fail("business.service stats caching drifted");
}

const api = read("src/app/lib/api.ts");
if (api.includes("businessStatsInflight") && api.includes("businessStatsClientCacheKey")) {
  pass("Client getBusinessStats coalesces identical in-flight scope/timeframe");
} else {
  fail("business stats client coalescing drifted");
}

if (api.includes("businessCustomerFeedbackInflight")) {
  pass("Client customer feedback list coalesces identical in-flight queries");
} else {
  fail("listBusinessCustomerFeedback must dedupe concurrent identical calls");
}

const bundleSvc = read("src/app/lib/businessAnalytics/businessAnalyticsService.ts");
if (
  bundleSvc.includes("getOrCreateInFlightRequest") &&
  bundleSvc.includes("businessAnalyticsBundleInflightKey")
) {
  pass("Business analytics bundle coalesces concurrent bundle loads");
} else {
  fail("fetchBusinessAnalyticsBundle must coalesce in-flight network work");
}

const dashStats = read("src/app/hooks/useBusinessDashboardStats.ts");
if (dashStats.includes("statsLoadInflightByTfRef")) {
  pass("Business dashboard hook joins per-timeframe stats loads");
} else {
  fail("useBusinessDashboardStats inflight join missing");
}

const feedback = read("src/app/components/business/RecentCustomerFeedbackPanel.tsx");
if (!feedback.includes("useInViewActive")) {
  pass("Customer feedback dashboard teaser does not viewport-gate fetch");
} else {
  fail("feedback must not require scroll to start request");
}

const reset = read("src/app/lib/resetAllClientSessionCaches.ts");
if (reset.includes("clearInFlightRequest")) {
  pass("Logout clears shared in-flight coalescing map");
} else {
  fail("resetAllClientSessionCaches must clear in-flight requests");
}

const tsx = path.join(repoRoot, "backend/node_modules/tsx/dist/cli.mjs");

const front = spawnSync(process.execPath, [tsx, path.join(repoRoot, "src/app/lib/getOrCreateInFlightRequest.runtime.ts")], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (front.status === 0) {
  pass("getOrCreateInFlightRequest behavioral suite");
} else {
  fail(`getOrCreateInFlightRequest.runtime.ts failed: ${front.stderr || front.stdout}`);
}

const back = spawnSync(process.execPath, [tsx, path.join(repoRoot, "backend/scripts/short-lived-cache-coalescing-runtime.ts")], {
  cwd: path.join(repoRoot, "backend"),
  encoding: "utf8",
});
if (back.status === 0) {
  pass("shortLivedCache concurrent-miss behavioral suite");
} else {
  fail(`short-lived-cache-coalescing-runtime.ts failed: ${back.stderr || back.stdout}`);
}

const failed = results.filter((r) => r.startsWith("FAIL:"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nRequest coalescing / cache-lock checks passed.");
