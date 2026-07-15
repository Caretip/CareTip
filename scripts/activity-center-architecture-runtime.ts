/**
 * Activity Center architecture regression guard.
 * Fails if Activity Center modules import forbidden dependencies (tip ledger / analytics / legacy streams).
 *
 * Run: npm run test:activity-center-architecture
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GUARDED_FILES = [
  "src/app/pages/business/tips/BusinessActivityCenterPage.tsx",
  "src/app/hooks/useActivityCenterFeed.ts",
  "src/app/components/business/insights/ActivityCenterFeed.tsx",
  "src/app/lib/realtime/subscribeActivityCreated.ts",
];

/** Symbols that must not appear on import lines in guarded Activity Center modules. */
const FORBIDDEN_IMPORT_SYMBOLS = [
  "useBusinessTipsModuleData",
  "listBusinessTips",
  "useBusinessAnalytics",
  "subscribeTipReceived",
  "useLiveActivityStream",
  "LiveTipFeed",
  "ActivityTimeline",
  "TipsOverviewMetricCards",
  "LiveActivityCenter",
];

/** Orphaned modules that must stay deleted. */
const MUST_NOT_EXIST = [
  "src/app/hooks/useLiveActivityStream.ts",
  "src/app/components/business/insights/LiveTipFeed.tsx",
  "src/app/components/business/insights/ActivityTimeline.tsx",
  "src/app/components/business/insights/TipsOverviewMetricCards.tsx",
  "src/app/components/business/insights/LiveActivityCenter.tsx",
  "src/app/pages/business/tips/BusinessTipsLivePage.tsx",
];

let failed = false;

function fail(msg: string) {
  console.error(`FAIL: ${msg}`);
  failed = true;
}

function importLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => /^\s*import\b/.test(line));
}

for (const rel of MUST_NOT_EXIST) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) {
    fail(`orphaned file still present: ${rel}`);
  } else {
    console.log(`OK: orphan absent — ${rel}`);
  }
}

for (const rel of GUARDED_FILES) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    fail(`guarded file missing: ${rel}`);
    continue;
  }
  const text = fs.readFileSync(abs, "utf8");
  const imports = importLines(text).join("\n");
  for (const symbol of FORBIDDEN_IMPORT_SYMBOLS) {
    if (new RegExp(`\\b${symbol}\\b`).test(imports)) {
      fail(`${rel} imports forbidden dependency: ${symbol}`);
    }
  }
  if (
    /subscribeTipReceived|useBusinessTipsModuleData|useBusinessAnalytics|useLiveActivityStream|listBusinessTips/.test(
      imports,
    )
  ) {
    fail(`${rel} import path reconnects Activity Center to tip/analytics/legacy stream`);
  }
  console.log(`OK: no forbidden imports — ${rel}`);
}

const routesPath = path.join(root, "src/app/routes.tsx");
const routesText = fs.readFileSync(routesPath, "utf8");
if (!/BusinessActivityCenterPage/.test(routesText)) {
  fail("routes.tsx must lazy-load BusinessActivityCenterPage");
} else {
  console.log("OK: routes.tsx → BusinessActivityCenterPage");
}
if (/BusinessTipsLivePage/.test(routesText)) {
  fail("routes.tsx still references BusinessTipsLivePage");
} else {
  console.log("OK: routes.tsx no longer references BusinessTipsLivePage");
}

if (failed) {
  console.error("\nActivity Center architecture regression check FAILED.");
  process.exit(1);
}

console.log("\nActivity Center architecture regression check passed.");
