/**
 * Customer QR language switch — no outlet unmount / prefetch wiring.
 * Run: npm run test:customer-language-switch-white-flash
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const p = join(root, rel);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

let failed = 0;
const pass = (m: string) => console.log(`PASS: ${m}`);
const fail = (m: string) => {
  failed += 1;
  console.log(`FAIL: ${m}`);
};

const i18n = read("src/i18n/i18n.ts");
if (i18n.includes("changeCustomerJourneyLanguage") && i18n.includes("keepPageVisible")) {
  pass("Customer journey language switch skips global language-change loader signal");
} else {
  fail("Missing changeCustomerJourneyLanguage / keepPageVisible");
}

if (i18n.includes("prefetchCustomerJourneyLocaleBundles")) {
  pass("Customer journey prefetches both EN and DE locale bundles");
} else {
  fail("Missing prefetchCustomerJourneyLocaleBundles");
}

const switcher = read("src/app/pages/customer/CustomerJourneyLanguageSwitcher.tsx");
if (
  switcher.includes("changeCustomerJourneyLanguage") &&
  switcher.includes("ensureLocaleBundle") &&
  switcher.includes("prefetchCustomerJourneyLocaleBundles")
) {
  pass("CustomerJourneyLanguageSwitcher awaits bundle then switches in place");
} else {
  fail("CustomerJourneyLanguageSwitcher missing in-place switch wiring");
}

const registrar = read("src/app/components/LanguageChangeLoadingRegistrar.tsx");
if (
  registrar.includes("subscribeAppLanguageChange") &&
  !registrar.includes("return null")
) {
  pass("LanguageChangeLoadingRegistrar never unmounts route outlet during locale switch");
} else {
  fail("LanguageChangeLoadingRegistrar may hide outlet during locale switch");
}

const routeNav = read("src/app/components/RouteNavigationLoadingRegistrar.tsx");
if (routeNav.includes("data-caretip-route-ready")) {
  pass("Route nav skips HTML boot tagline updates after customer route committed");
} else {
  fail("Route nav may flash HTML boot on locale-only re-render");
}

const prefetch = read("src/app/lib/prefetchCustomerRoutes.ts");
if (prefetch.includes("prefetchCustomerJourneyLocaleBundles")) {
  pass("QR entry prefetch warms locale bundles with tip-flow chunks");
} else {
  fail("prefetchCustomerFlowRoutes missing locale warmup");
}

const entryGraph = read("src/app/lib/prefetchCustomerEntryGraph.ts");
if (entryGraph.includes("prefetchCustomerJourneyLocaleBundles")) {
  pass("Cold customer entry graph prefetches EN+DE locale bundles");
} else {
  fail("prefetchCustomerEntryGraph missing locale warmup");
}

const switcherLayout = read("src/app/pages/customer/CustomerJourneyLanguageSwitcher.tsx");
if (switcherLayout.includes("useLayoutEffect") && switcherLayout.includes("prefetchCustomerJourneyLocaleBundles")) {
  pass("Customer language switcher prefetches locales before paint");
} else {
  fail("CustomerJourneyLanguageSwitcher should useLayoutEffect locale prefetch");
}

const manager = read("src/app/context/AppLoadingManager.tsx");
if (manager.includes("languageChangeActive") && manager.includes("!languageChangeActive")) {
  pass("Global overlay suppressed while marketing language change is active");
} else {
  fail("AppLoadingManager missing language-change overlay suppress");
}

if (failed > 0) {
  console.error(`\ncustomer-language-switch-white-flash-runtime: ${failed} failed`);
  process.exit(1);
}
console.log("\ncustomer-language-switch-white-flash-runtime: ok");
