/**
 * Architecture guard — PWA install must defer to unresolved cookie consent.
 * Run: npm run test:pwa-cookie-prompt-stacking
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pwaPrompt = read("src/app/components/PwaInstallPrompt.tsx");
const eligibility = read("src/app/hooks/usePwaInstallPromptEligibility.ts");
const routes = read("src/app/routes.tsx");
const app = read("src/app/App.tsx");

assert(
  pwaPrompt.includes("usePwaInstallPromptEligibility"),
  "PwaInstallPrompt must gate on cookie-consent eligibility",
);
assert(
  pwaPrompt.includes("!pwaEligible"),
  "PwaInstallPrompt must hide when cookie consent blocks eligibility",
);
assert(
  eligibility.includes("useCookieConsent"),
  "eligibility hook must read cookie consent context",
);
assert(
  eligibility.includes("consent != null && unlocked"),
  "eligibility requires resolved consent plus post-consent unlock",
);
assert(
  !eligibility.includes("setTimeout"),
  "must not use arbitrary timeout deferral",
);
assert(
  routes.includes("PwaInstallPrompt") && routes.includes("CookieConsentRoot"),
  "PWA prompt and cookie UI must share RootLayout (router context for deferral)",
);
assert(
  !app.includes("PwaInstallPrompt"),
  "PwaInstallPrompt must not mount outside router (needs navigation deferral)",
);

console.log("pwa-cookie-prompt-stacking-runtime: ok");
