/**
 * Period leaderboard preview uses the same eligibility as the overview employee chart.
 * Run: node ./node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json ./src/app/lib/overviewLeaderboardPreview.runtime.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOverviewLeaderboardPreview } from "./businessDashboardChartData";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const people = [
  { id: "zero", name: "Zero", avatar: null, tipsTotal: 0, isActive: true, activationStatus: "active", emailVerified: true },
  { id: "inactive", name: "Inactive", avatar: null, tipsTotal: 90, isActive: false, activationStatus: "active", emailVerified: true },
  { id: "pending", name: "Pending", avatar: null, tipsTotal: 80, isActive: true, activationStatus: "pending_activation", emailVerified: true },
  { id: "unverified", name: "Unverified", avatar: null, tipsTotal: 70, isActive: true, activationStatus: "active", emailVerified: false },
  { id: "c", name: "Cara", avatar: null, tipsTotal: 12, isActive: true, activationStatus: "active", emailVerified: true },
  { id: "a", name: "Ada", avatar: "/uploads/ada.png", tipsTotal: 40, isActive: true, activationStatus: "active", emailVerified: true },
  { id: "b", name: "Ben", avatar: null, tipsTotal: 25, isActive: true, activationStatus: "active", emailVerified: true },
  { id: "d", name: "Dina", avatar: null, tipsTotal: 8, isActive: true, activationStatus: "active", emailVerified: true },
];

const preview = buildOverviewLeaderboardPreview(people, 3);
assert.deepEqual(
  preview.map((row) => [row.id, row.name, row.tips, row.avatar]),
  [
    ["a", "Ada", 40, "/uploads/ada.png"],
    ["b", "Ben", 25, null],
    ["c", "Cara", 12, null],
  ],
);
assert.equal(buildOverviewLeaderboardPreview([], 3).length, 0);
assert.equal(buildOverviewLeaderboardPreview(undefined, 3).length, 0);
assert.equal(buildOverviewLeaderboardPreview([people[4]], 3).length, 1);
assert.equal(buildOverviewLeaderboardPreview([people[5], people[6]], 3).length, 2);
assert.equal(buildOverviewLeaderboardPreview([people[5], people[0]], 3)[0]?.id, "a");

const dashboard = read("src/app/pages/business/BusinessDashboard.tsx");
assert(!dashboard.includes("useBusinessTipsModuleData"), "overview must not call the monthly leaderboard hook");
assert(dashboard.includes('featureKey="advancedAnalytics"'), "overview charts stay behind advancedAnalytics");
assert(!dashboard.includes("showLockedCard={false}"), "overview keeps the existing locked card");
assert(dashboard.includes("buildOverviewLeaderboardPreview"), "preview is derived in the overview");

const charts = read("src/app/pages/business/BusinessDashboardAnalyticsCharts.tsx");
assert(charts.includes("TOP_PERFORMERS_PAGE_PATH"), "view leaderboard uses the existing route constant");
assert(!charts.includes("BarChart"), "employee bar chart is removed from the overview");
assert(!charts.includes("useBusinessTipsModuleData"), "charts do not load the monthly leaderboard");
assert(charts.includes("overviewLeaderboardTitle"), "period leaderboard has its own heading");

const leaderboardPage = read("src/app/components/business/insights/TeamLeaderboard.tsx");
assert(!leaderboardPage.includes("buildOverviewLeaderboardPreview"), "dedicated leaderboard is unchanged");

const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");
for (const key of [
  "overviewLeaderboardTitle",
  "overviewLeaderboardView",
  "overviewLeaderboardEmpty",
  "overviewLeaderboardAria",
]) {
  assert(en.includes(`"${key}"`), `EN ${key}`);
  assert(de.includes(`"${key}"`), `DE ${key}`);
}
assert(en.includes("View leaderboard"));
assert(en.includes("No tips recorded for this period yet."));
assert(de.includes("Rangliste anzeigen"));
assert(de.includes("Für diesen Zeitraum wurde noch kein Trinkgeld erfasst."));

const layout = read("src/styles/business-overview-workspace.css");
assert(layout.includes("minmax(0, 2fr) minmax(0, 1fr)"), "desktop split is about two-thirds chart and one-third leaderboard");
assert(layout.includes("container-name: overview-analytics"), "panels stack until the content area is wide enough");

console.log("overview-leaderboard-preview: ok");
