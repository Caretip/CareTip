/**
 * Frontend contact validation + pricing/billing copy alignment.
 * Run: npm run test:contact-field-validation-frontend
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INVALID_CONTACT_COUNTRY,
  INVALID_CONTACT_PHONE,
  INVALID_WEBSITE_URL,
  normalizeOptionalContactPhone,
  normalizeOptionalWebsiteUrl,
} from "../src/app/lib/contactFieldValidation.ts";

const results: string[] = [];
let failed = 0;
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => {
  failed += 1;
  results.push(`FAIL: ${m}`);
};

function expectFailPhone(raw: string | null, country: string | null, code: string, label: string) {
  const r = normalizeOptionalContactPhone(raw, country);
  if (r.ok || r.code !== code) fail(`${label}: expected ${code} got ${r.ok ? "ok" : r.code}`);
  else pass(label);
}

function expectFailUrl(raw: string | null, label: string) {
  const r = normalizeOptionalWebsiteUrl(raw);
  if (r.ok || r.code !== INVALID_WEBSITE_URL) fail(`${label}: expected INVALID_WEBSITE_URL`);
  else pass(label);
}

const dePhone = normalizeOptionalContactPhone("15123456789", "DE");
if (dePhone.ok && dePhone.e164?.startsWith("+49")) pass("frontend DE phone normalizes to E.164");
else fail("frontend DE phone should normalize");

expectFailPhone("+49 151 23456789", "US", INVALID_CONTACT_PHONE, "frontend mismatched country/phone");
expectFailPhone("abc", "DE", INVALID_CONTACT_PHONE, "frontend malformed phone");
expectFailPhone("15123456789", "ZZ", INVALID_CONTACT_COUNTRY, "frontend unsupported country");
expectFailUrl("javascript:alert(1)", "frontend javascript URL");
expectFailUrl("data:text/html,x", "frontend data URL");
expectFailUrl("https://example", "frontend hostname without TLD");

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));
const en = JSON.parse(readFileSync(path.join(root, "src/i18n/locales/en.json"), "utf8"));
const de = JSON.parse(readFileSync(path.join(root, "src/i18n/locales/de.json"), "utf8"));

function assertTierCopy(locale: string, tiers: Record<string, Record<string, string>>) {
  const starter = Object.keys(tiers.starter)
    .filter((k) => /^f\d+$/.test(k))
    .map((k) => tiers.starter[k])
    .join(" | ");
  const business = Object.keys(tiers.business)
    .filter((k) => /^f\d+$/.test(k))
    .map((k) => tiers.business[k])
    .join(" | ");
  const enterprise = Object.keys(tiers.enterprise)
    .filter((k) => /^f\d+$/.test(k))
    .map((k) => tiers.enterprise[k])
    .join(" | ");

  if (/unlimited earnings|unbegrenzte einnahmen/i.test(starter)) {
    fail(`${locale} Basic must not claim unlimited earnings`);
  } else pass(`${locale} Basic does not claim unlimited earnings`);
  if (!/1 location|1 standort/i.test(starter) || !/1 table|1 tisch/i.test(starter)) {
    fail(`${locale} Basic must list 1 location and 1 table`);
  } else pass(`${locale} Basic lists 1 location and 1 table`);
  if (/dedicated onboarding|persönlicher ansprechpartner/i.test(business)) {
    fail(`${locale} Pro must not claim dedicated onboarding`);
  } else pass(`${locale} Pro does not claim dedicated onboarding`);
  if (/\bAPI\b/i.test(enterprise)) {
    fail(`${locale} Premium must not claim API`);
  } else pass(`${locale} Premium does not claim API`);
}

assertTierCopy("en", en.staticPages.pricing.tiers);
assertTierCopy("de", de.staticPages.pricing.tiers);

if (en.business.billing.subscriptionSummary.noActiveTitle.toLowerCase().includes("basic")) {
  fail("billing no-entitlement title must not say Basic");
} else pass("billing no-entitlement title is not Basic");

console.log(results.join("\n"));
if (failed > 0) {
  console.error(`\n${failed} frontend contact/pricing check(s) failed.`);
  process.exit(1);
}
console.log("\nAll frontend contact/pricing validation checks passed.");
