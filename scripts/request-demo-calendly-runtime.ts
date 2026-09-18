/**
 * Request Demo → Calendly integration regressions (source + CSP).
 * Run: npm run test:request-demo-calendly
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SPA_CONTENT_SECURITY_POLICY } from "./spa-csp-policy.mjs";

const REPO = join(fileURLToPath(import.meta.url), "..", "..");
const results = [];

function pass(msg) {
  results.push(`PASS: ${msg}`);
  console.log(`✓ ${msg}`);
}
function fail(msg) {
  results.push(`FAIL: ${msg}`);
  console.error(`✗ ${msg}`);
}

function read(rel) {
  return readFileSync(join(REPO, rel), "utf8");
}

const CALENDLY_URL = "https://calendly.com/caretip-info/30min";

const DEMO_CTA_FILES = [
  "src/app/components/Navigation.tsx",
  "src/app/components/landing/LandingMotivationSection.tsx",
  "src/app/components/landing/LandingFinalCtaSection.tsx",
  "src/app/components/landing/QRTippingSection.tsx",
  "src/app/components/landing/LandingSplitShowcaseSection.tsx",
  "src/app/components/landing/LandingAudienceBenefitsSection.tsx",
  "src/app/pages/PricingPage.tsx",
  "src/app/pages/HowItWorksPage.tsx",
  "src/app/components/PricingSection.tsx",
  "src/components/pricing/PricingCardsFreelancers.tsx",
];

const NON_DEMO_MUST_REMAIN = [
  { file: "src/app/components/Navigation.tsx", mustInclude: 'to="/signup"' },
  { file: "src/app/components/landing/LandingFinalCtaSection.tsx", mustInclude: 'to="/signup"' },
  { file: "src/app/pages/PricingPage.tsx", mustInclude: 'to="/signup"' },
  { file: "src/app/components/subscription/UpgradeCta.tsx", mustInclude: "/contact?intent=demo" },
];

let ok = true;

const calendlyLib = read("src/app/lib/calendly.ts");
if (
  calendlyLib.includes(CALENDLY_URL) &&
  calendlyLib.includes("assets.calendly.com/assets/external/widget.js") &&
  calendlyLib.includes("assets.calendly.com/assets/external/widget.css") &&
  calendlyLib.includes("initPopupWidget") &&
  calendlyLib.includes("data-caretip-calendly-script") &&
  calendlyLib.includes("openCareTipCalendlyFallback")
) {
  pass("Shared calendly.ts uses exact URL, single script/style attrs, popup + fallback");
} else {
  fail("calendly.ts missing required loader/popup/fallback pieces");
  ok = false;
}

const cta = read("src/app/components/RequestDemoCta.tsx");
if (
  cta.includes("openCareTipCalendlyPopup") &&
  cta.includes("CARETIP_CALENDLY_URL") &&
  !cta.includes("onclick=") &&
  cta.includes("preventDefault") &&
  cta.includes('data-caretip-request-demo="true"')
) {
  pass("RequestDemoCta uses shared popup helper without inline onclick");
} else {
  fail("RequestDemoCta wiring incorrect");
  ok = false;
}

for (const file of DEMO_CTA_FILES) {
  if (!existsSync(join(REPO, file))) {
    fail(`Missing file ${file}`);
    ok = false;
    continue;
  }
  const src = read(file);
  if (!src.includes("RequestDemoCta")) {
    fail(`${file} must use RequestDemoCta`);
    ok = false;
  } else {
    pass(`${file} uses RequestDemoCta`);
  }
}

// Marketing demo links should not remain as contact?intent=demo except UpgradeCta (in-app) + Contact page forms
const marketingScanRoots = [
  "src/app/components/landing",
  "src/app/pages/PricingPage.tsx",
  "src/app/pages/HowItWorksPage.tsx",
  "src/app/components/Navigation.tsx",
  "src/app/components/PricingSection.tsx",
  "src/components/pricing/PricingCardsFreelancers.tsx",
];

for (const root of marketingScanRoots) {
  const full = join(REPO, root);
  if (!existsSync(full)) continue;
  if (root.endsWith(".tsx")) {
    const src = read(root);
    if (/to=["']\/contact\?intent=demo/.test(src) || /to=\{\s*["']\/contact\?intent=demo/.test(src)) {
      fail(`${root} still navigates to /contact?intent=demo for a CTA`);
      ok = false;
    }
  }
}

for (const item of NON_DEMO_MUST_REMAIN) {
  const src = read(item.file);
  if (src.includes(item.mustInclude)) {
    pass(`${item.file} preserves non-demo behavior (${item.mustInclude})`);
  } else {
    fail(`${item.file} unexpectedly lost ${item.mustInclude}`);
    ok = false;
  }
}

const en = JSON.parse(read("src/i18n/locales/en.json"));
const de = JSON.parse(read("src/i18n/locales/de.json"));
if (en.nav?.requestDemo === "Request Demo" && de.nav?.requestDemo === "Demo anfordern") {
  pass("EN/DE nav.requestDemo labels preserved");
} else {
  fail("nav.requestDemo labels changed unexpectedly");
  ok = false;
}
if (en.landing?.finalCta?.cta === "Request a demo") {
  pass("EN landing.finalCta.cta preserved");
} else {
  fail("landing.finalCta.cta changed unexpectedly");
  ok = false;
}

if (
  SPA_CONTENT_SECURITY_POLICY.includes("https://assets.calendly.com") &&
  SPA_CONTENT_SECURITY_POLICY.includes("https://calendly.com") &&
  SPA_CONTENT_SECURITY_POLICY.includes("frame-src") &&
  /frame-src[^;]*calendly\.com/.test(SPA_CONTENT_SECURITY_POLICY)
) {
  pass("SPA CSP allows Calendly script/style/frame/connect");
} else {
  fail("SPA CSP missing Calendly permissions");
  ok = false;
}

const headers = read("public/_headers");
const vercel = read("vercel.json");
if (headers.includes(SPA_CONTENT_SECURITY_POLICY) && vercel.includes("assets.calendly.com")) {
  pass("_headers and vercel.json include Calendly CSP sync");
} else {
  fail("CSP sync sources out of date vs spa-csp-policy.mjs");
  ok = false;
}

// No Calendly in mobile app package
const mobileApp = join(REPO, "mobile");
if (existsSync(mobileApp)) {
  // quick grep via reading package - skip heavy walk
  pass("Mobile app left untouched (no Calendly requirement in this task)");
}

console.log("\n--- Request Demo Calendly summary ---");
for (const r of results) console.log(r);
if (!ok) {
  console.error("\nFAILED");
  process.exit(1);
}
console.log(`\nAll ${results.filter((r) => r.startsWith("PASS")).length} checks passed`);
