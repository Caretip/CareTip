/**
 * Landing performance validation — network waterfall + bundle snapshot.
 * Usage: E2E_BASE_URL=http://127.0.0.1:4173 node scripts/landing-phase-validation.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173").replace(/\/$/, "");
const outDir = path.join(process.cwd(), "test-results", "landing-validation");
fs.mkdirSync(outDir, { recursive: true });

function fileKb(name) {
  const stat = fs.statSync(path.join(process.cwd(), "dist", "assets", name));
  return Math.round(stat.size / 1024);
}

function analyzeBundle() {
  const assetsDir = path.join(process.cwd(), "dist", "assets");
  if (!fs.existsSync(assetsDir)) return null;
  const files = fs.readdirSync(assetsDir);
  const pick = (prefix) => files.find((f) => f.startsWith(prefix) && f.endsWith(".js"));
  return {
    landingPageChunkKb: fileKb(pick("LandingPage-")),
    indexJsKb: fileKb(files.find((f) => f.startsWith("index-") && f.endsWith(".js"))),
    hospitalityChunkKb: fileKb(pick("HospitalityTeamsUnifiedSection-")),
    simpleSetupChunkKb: fileKb(pick("SimpleSetupSection-")),
    heroImages: files.filter((f) => /^(wyc|wyo|formemobile0[12])-/.test(f)),
  };
}

function isImageUrl(url) {
  return /\.(avif|webp|jpe?g|png|gif)(\?|$)/i.test(url);
}

function isBelowFoldChunk(url) {
  return /HospitalityTeamsUnified|BusinessLanding|EmployeeLanding|LandingFeatures|PaymentsSection|LandingRealLife|SimpleSetup|LandingMotivation/i.test(
    url,
  );
}

function isSecondaryHero(url) {
  return /wyo-|formemobile02-/i.test(url);
}

function isLcpHero(url) {
  return /wyc-|formemobile01-/i.test(url);
}

const browser = await chromium.launch();
const viewportProfile = process.env.VALIDATION_VIEWPORT === "mobile"
  ? { width: 390, height: 844 }
  : { width: 1366, height: 768 };
const context = await browser.newContext({ viewport: viewportProfile });
const page = await context.newPage();

const initialRequests = [];
const allRequests = [];
const requestStart = new Map();

page.on("request", (req) => {
  const url = req.url();
  const at = Date.now() - navigationStartedAt;
  requestStart.set(url, at);
  allRequests.push({ url, type: req.resourceType(), at });
});

page.on("response", (res) => {
  const url = res.url();
  const entry = allRequests.find((r) => r.url === url && r.status == null);
  if (entry) entry.status = res.status();
});

const navigationStartedAt = Date.now();
await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });

await page.waitForSelector('[data-hero-frame="wyc"] img', { timeout: 15_000 });
await page.waitForFunction(
  () => {
    const img = document.querySelector('[data-hero-frame="wyc"] img');
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  },
  { timeout: 15_000 },
);

const heroReadyAt = Date.now() - navigationStartedAt;
const snapshotAtHero = allRequests.filter((r) => r.at <= heroReadyAt + 200);

const imageRequestsAtHero = snapshotAtHero.filter((r) => isImageUrl(r.url));
const lcpImagesAtHero = imageRequestsAtHero.filter((r) => isLcpHero(r.url));
const secondaryHeroAtHero = imageRequestsAtHero.filter((r) => isSecondaryHero(r.url));
const belowFoldAtHero = snapshotAtHero.filter((r) => isBelowFoldChunk(r.url));

await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(3000);

const scrollEndAt = Date.now() - navigationStartedAt;
const afterScroll = allRequests.filter((r) => r.at > heroReadyAt + 200 && r.at <= scrollEndAt);
const belowFoldAfterScroll = afterScroll.filter((r) => isBelowFoldChunk(r.url));
const secondaryHeroAfterLcp = afterScroll.filter((r) => isSecondaryHero(r.url) && isImageUrl(r.url));

const urlCounts = {};
for (const r of allRequests) {
  if (!isImageUrl(r.url)) continue;
  const key = r.url.split("?")[0];
  urlCounts[key] = (urlCounts[key] ?? 0) + 1;
}
const duplicateImages = Object.entries(urlCounts).filter(([, n]) => n > 1);

const cls = await page.evaluate(() => {
  let cls = 0;
  for (const entry of performance.getEntriesByType("layout-shift")) {
    if (!entry.hadRecentInput) cls += entry.value;
  }
  return cls;
});

await browser.close();

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  viewport: process.env.VALIDATION_VIEWPORT === "mobile" ? "390x844 mobile" : "1366x768 desktop",
  bundle: analyzeBundle(),
  network: {
    totalRequestsAtHeroReady: snapshotAtHero.length,
    imageRequestsAtHeroReady: imageRequestsAtHero.length,
    lcpHeroImagesAtHeroReady: lcpImagesAtHero.map((r) => path.basename(r.url.split("?")[0])),
    secondaryHeroImagesBeforeLcp: secondaryHeroAtHero.map((r) => path.basename(r.url.split("?")[0])),
    belowFoldChunksBeforeHero: belowFoldAtHero.map((r) => path.basename(r.url.split("?")[0])),
    belowFoldChunksAfterScroll: belowFoldAfterScroll.map((r) => path.basename(r.url.split("?")[0])),
    secondaryHeroImagesAfterLcp: secondaryHeroAfterLcp.map((r) => path.basename(r.url.split("?")[0])),
    duplicateImageUrls: duplicateImages.map(([url, count]) => ({
      file: path.basename(url),
      count,
    })),
    firstFiveImageRequests: imageRequestsAtHero
      .slice(0, 8)
      .map((r) => path.basename(r.url.split("?")[0])),
  },
  layoutShiftObserved: cls,
  checks: {
    heroLcpRequestedAtHero: lcpImagesAtHero.length >= 1,
    noSecondaryHeroBeforeLcp: secondaryHeroAtHero.length === 0,
    noBelowFoldBeforeHero: belowFoldAtHero.length === 0,
    belowFoldLoadsOnScroll: belowFoldAfterScroll.length > 0,
    secondaryHeroDeferred: secondaryHeroAfterLcp.length >= 1 || secondaryHeroAtHero.length === 0,
    noDuplicateImages: duplicateImages.length === 0,
    clsAcceptable: cls < 0.1,
  },
};

fs.writeFileSync(path.join(outDir, "network-validation.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

const failed = Object.entries(report.checks).filter(([, ok]) => !ok);
process.exit(failed.length ? 1 : 0);
