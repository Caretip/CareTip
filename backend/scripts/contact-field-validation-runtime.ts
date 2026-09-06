/**
 * Onboarding contact country / phone / website validation (backend).
 * Run: npm --prefix backend run test:contact-field-validation
 */
import {
  INVALID_CONTACT_COUNTRY,
  INVALID_CONTACT_PHONE,
  INVALID_WEBSITE_URL,
  normalizeOptionalContactPhone,
  normalizeOptionalWebsiteUrl,
} from "../src/lib/contactFieldValidation.ts";

const results: string[] = [];
let failed = 0;
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => {
  failed += 1;
  results.push(`FAIL: ${m}`);
};

function expectOkPhone(raw: string | null, country: string | null, label: string) {
  const r = normalizeOptionalContactPhone(raw, country);
  if (!r.ok || !r.e164) fail(`${label}: expected valid phone, got ${r.ok ? "empty" : r.code}`);
  else pass(label);
}

function expectFailPhone(raw: string | null, country: string | null, code: string, label: string) {
  const r = normalizeOptionalContactPhone(raw, country);
  if (r.ok || r.code !== code) fail(`${label}: expected ${code} got ${r.ok ? "ok" : r.code}`);
  else pass(label);
}

function expectOkUrl(raw: string | null, label: string) {
  const r = normalizeOptionalWebsiteUrl(raw);
  if (!r.ok || !r.value) fail(`${label}: expected valid URL`);
  else pass(label);
}

function expectFailUrl(raw: string | null, label: string) {
  const r = normalizeOptionalWebsiteUrl(raw);
  if (r.ok || r.code !== INVALID_WEBSITE_URL) fail(`${label}: expected INVALID_WEBSITE_URL`);
  else pass(label);
}

const emptyPhone = normalizeOptionalContactPhone("", "DE");
if (emptyPhone.ok && emptyPhone.e164 === null) pass("empty phone allowed");
else fail("empty phone should be allowed");

const emptyUrl = normalizeOptionalWebsiteUrl("");
if (emptyUrl.ok && emptyUrl.value === null) pass("empty website allowed");
else fail("empty website should be allowed");

expectOkPhone("+49 151 23456789", "DE", "DE E.164 with DE country");
expectOkPhone("15123456789", "DE", "DE national with DE country");
expectOkPhone("15123456789", "  de ", "whitespace ISO normalizes to DE");
expectFailPhone("+49 151 23456789", "US", INVALID_CONTACT_PHONE, "DE E.164 with US country");
expectFailPhone("not-a-phone", "DE", INVALID_CONTACT_PHONE, "malformed phone");
expectFailPhone("+1 202 555 0100", "DE", INVALID_CONTACT_PHONE, "US number with DE country");
expectFailPhone("015123456789", "ZZ", INVALID_CONTACT_COUNTRY, "unsupported ISO ZZ");
expectFailPhone("015123456789", "DEU", INVALID_CONTACT_COUNTRY, "alpha-3 country rejected");
expectFailPhone("015123456789", "+49", INVALID_CONTACT_COUNTRY, "calling code is not ISO");
expectFailPhone("015123456789", "abc", INVALID_CONTACT_COUNTRY, "random country text");
expectFailPhone("15123456789", null, INVALID_CONTACT_PHONE, "national number without country");
expectFailPhone("\u0000151", "DE", INVALID_CONTACT_PHONE, "control character phone");

const countryOnlyEmpty = normalizeOptionalContactPhone("", "XX");
if (countryOnlyEmpty.ok && countryOnlyEmpty.e164 === null) {
  pass("invalid country with empty phone is ignored");
} else {
  fail("empty phone must not require country");
}

expectOkUrl("https://example.com", "https example.com");
expectOkUrl("http://example.com/path", "http with path");
expectFailUrl("javascript:alert(1)", "javascript scheme");
expectFailUrl("data:text/html,hi", "data scheme");
expectFailUrl("file:///etc/passwd", "file scheme");
expectFailUrl("ftp://example.com", "ftp scheme");
expectFailUrl("http://", "http without host");
expectFailUrl("https://", "https without host");
expectFailUrl("https://.", "dot host");
expectFailUrl("https://example", "hostname without TLD");
expectFailUrl("https://user:pass@example.com", "embedded credentials");
expectFailUrl("https://example.com:bad", "invalid port");
expectFailUrl("https://example.com/%0a", "encoded newline");
expectFailUrl("example.com", "missing scheme");
expectFailUrl("https://example.com/path with space", "whitespace in URL");

console.log(results.join("\n"));
if (failed > 0) {
  console.error(`\n${failed} contact-field check(s) failed.`);
  process.exit(1);
}
console.log("\nAll contact field validation checks passed.");
