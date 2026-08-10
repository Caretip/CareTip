/**
 * Static contract: CareTip web-app branded startup loader stays one coherent system.
 * Run: node scripts/caretip-web-branded-loader-contract.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const results = [];
const pass = (m) => results.push(`PASS: ${m}`);
const fail = (m) => results.push(`FAIL: ${m}`);

const html = read("index.html");
const polish = read("src/styles/caretip-ux-polish.css");
const globals = read("src/styles/globals.css");
const mark = read("src/app/components/CareTipPageLoader.tsx");
const screen = read("src/app/components/AppBrandedLoadingScreen.tsx");
const manager = read("src/app/context/AppLoadingManager.tsx");
const bridge = read("src/app/lib/htmlMarketingBootBridge.ts");
const main = read("src/main.tsx");

if (html.includes('id="caretip-html-boot"') && html.includes("caretip-html-boot__indeterminate") && html.includes("caretip-html-boot__tagline")) {
  pass("HTML cold-boot uses CareTip mark + indeterminate track + tagline");
} else fail("HTML cold-boot mark/track/tagline missing");

if (html.includes('role="status"') && html.includes('aria-busy="true"') && html.includes("caretip-html-boot__brand")) {
  pass("HTML boot has loading semantics + brand label");
} else fail("HTML boot a11y semantics incomplete");

if (
  polish.includes("app-branded-loader__indeterminate") &&
  polish.includes("prefers-reduced-motion") &&
  !polish.includes("app-branded-loader__spinner")
) {
  pass("React CSS uses indeterminate bar + reduced-motion (no legacy orbit spinner)");
} else fail("React branded loader CSS incomplete");

if (globals.includes("prefers-reduced-motion") && globals.includes(".app-setup-loading--exiting")) {
  pass("Overlay fade respects reduced-motion");
} else fail("Overlay reduced-motion missing");

if (
  mark.includes("CareTipBrandedLoaderMark") &&
  mark.includes("app-branded-loader__indeterminate") &&
  mark.includes("/brand/caretip-app-icon.svg") &&
  mark.includes("common.preparingWorkspace") &&
  mark.includes("app-branded-loader__tagline")
) {
  pass("Shared CareTipBrandedLoaderMark uses app icon + bar + workspace tagline");
} else fail("CareTipBrandedLoaderMark contract failed");

if (screen.includes("CareTipBrandedLoaderMark") && manager.includes("AppBrandedLoadingScreen")) {
  pass("AppLoadingManager hosts AppBrandedLoadingScreen (single React overlay)");
} else fail("React overlay host wiring missing");

if (bridge.includes("caretip-html-boot") && main.includes("dismissHtmlMarketingBootBridge")) {
  pass("Bootstrap failure dismisses HTML boot; bridge owns HTML fade-out");
} else fail("HTML boot bridge / failure path incomplete");

/* No second competing splash page component introduced */
const splashPages = [
  "src/app/pages/SplashPage.tsx",
  "src/app/pages/BrandedSplashPage.tsx",
  "src/app/components/NewCareTipSplash.tsx",
];
for (const rel of splashPages) {
  try {
    read(rel);
    fail(`unexpected extra splash file present: ${rel}`);
  } catch {
    pass(`no competing splash page at ${rel}`);
  }
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL"));
if (failed.length) {
  console.error(`\n${failed.length} failure(s)`);
  process.exit(1);
}
console.log(`\nAll ${results.length} CareTip web branded-loader checks passed.`);
