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
const bootLocale = read("public/boot-locale.js");
const main = read("src/main.tsx");
const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");

if (html.includes('id="caretip-html-boot"') && html.includes("caretip-html-boot__indeterminate") && html.includes("caretip-html-boot__tagline")) {
  pass("HTML cold-boot uses CareTip mark + indeterminate track + tagline");
} else fail("HTML cold-boot mark/track/tagline missing");

if (
  !html.includes("caretip-html-boot-message") &&
  !html.includes("caretip-html-boot-sub") &&
  !html.includes("caretip-html-boot__brand") &&
  html.includes("Getting things ready")
) {
  pass("HTML cold-boot has a single getting-ready sentence (no brand word + extra lines)");
} else fail("HTML cold-boot still has extra copy besides the tagline");

if (html.includes('role="status"') && html.includes('aria-busy="true"') && html.includes("caretip-html-boot-tagline")) {
  pass("HTML boot has loading semantics + one visible sentence");
} else fail("HTML boot a11y semantics incomplete");

if (html.includes("resolveBootTagline") && bootLocale.includes("resolveBootTagline") && bootLocale.includes("settingUpWorkspace")) {
  pass("HTML boot tagline is path-aware (guest / onboarding / default)");
} else fail("HTML boot path-aware tagline missing");

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
  mark.includes("common.gettingReady") &&
  mark.includes("app-branded-loader__tagline") &&
  !mark.includes("app-branded-loader__brand") &&
  !mark.includes("LoadingSpinner")
) {
  pass("Shared CareTipBrandedLoaderMark uses app icon + bar + one getting-ready sentence");
} else fail("CareTipBrandedLoaderMark contract failed");

if (screen.includes("CareTipBrandedLoaderMark") && manager.includes("AppBrandedLoadingScreen")) {
  pass("AppLoadingManager hosts AppBrandedLoadingScreen (single React overlay)");
} else fail("React overlay host wiring missing");

if (
  screen.includes("tagline={status}") &&
  screen.includes("app-setup-loading--instant") &&
  !screen.includes("max-w-sm text-center text-sm font-medium")
) {
  pass("AppBrandedLoadingScreen uses one tagline and an opaque instant cover");
} else fail("AppBrandedLoadingScreen still stacks a second loading message or fades in over page copy");

const contexts = read("src/app/lib/appLoadingContexts.ts");
if (
  contexts.includes('p.startsWith("/onboarding")') &&
  contexts.includes("common.creatingWorkspace")
) {
  pass("Cold-boot and route copy for /onboarding share Setting up your workspace");
} else fail("Onboarding boot copy is not aligned");

const onboarding = read("src/app/pages/BusinessOnboardingPage.tsx");
if (
  onboarding.includes("AuthBootstrapShell") &&
  onboarding.includes("onboardingHoldMessage") &&
  onboarding.includes("publishingOnboarding") &&
  onboarding.includes("GlobalAppLoadingHold")
) {
  pass("Onboarding page replaces the form during init/publish instead of stacking loaders");
} else fail("Onboarding page still stacks form copy under a second loader");

if (
  bridge.includes("caretip-html-boot-tagline") &&
  bridge.includes("setHtmlBootBridgeTagline") &&
  manager.includes("setHtmlBootBridgeTagline") &&
  !manager.includes("onlyAMoment") &&
  !manager.includes("setHtmlBootBridgeSub")
) {
  pass("HTML boot bridge updates the single tagline (no second onlyAMoment line)");
} else fail("HTML boot still tries to set a second sentence");

if (
  onboarding.includes("common.creatingWorkspace") &&
  mark.includes("taglineOverride") &&
  screen.includes("tagline={status}")
) {
  pass("Onboarding setup copy is a tagline override, not a stacked sentence");
} else fail("Onboarding workspace setup copy is not wired as a single tagline");

const authPage = read("src/app/components/AuthPage.tsx");
const mobileAuth = read("src/app/components/auth/mobileWeb/MobileWebAuthShell.tsx");
if (
  authPage.includes("auth.page.creatingAccountWait") &&
  !authPage.includes("common.creatingWorkspace") &&
  mobileAuth.includes("auth.page.creatingAccountWait") &&
  !mobileAuth.includes("common.creatingWorkspace")
) {
  pass("Signup form wait copy is account creation, not workspace setup");
} else fail("Signup still uses workspace-create copy on the auth form");

if (en.includes('"gettingReady": "Getting things ready') && de.includes('"gettingReady": "Wird eingerichtet')) {
  pass("EN/DE default loading copy is product language (not Preparing/Creating workspace)");
} else fail("Default gettingReady copy missing");

if (
  !en.includes("Preparing your workspace") &&
  !en.includes("Creating your workspace") &&
  !en.includes("Creating workspace") &&
  !de.includes("Ihr Workspace wird vorbereitet") &&
  !de.includes("Ihr Workspace wird erstellt")
) {
  pass("Old competing workspace sentences are gone from locale files");
} else fail("Locale files still contain competing Preparing/Creating workspace copy");

if (bridge.includes("caretip-html-boot") && main.includes("dismissHtmlMarketingBootBridge")) {
  pass("Bootstrap failure dismisses HTML boot; bridge owns HTML fade-out");
} else fail("HTML boot bridge / failure path incomplete");

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
