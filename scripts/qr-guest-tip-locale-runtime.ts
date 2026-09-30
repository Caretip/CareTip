/**
 * QR guest tip journey locale + confirmation email wiring checks.
 * Run: npm run test:qr-guest-tip-locale
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  parseTipGuestPresentationLocale,
  buildTipGuestConfirmationContent,
} from "../backend/src/emails/i18nEmail.js";
import { resolveEmailLocaleFromCheckoutSession } from "../backend/src/services/tipGuestConfirmationEmail.service.js";

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

assert.equal(parseTipGuestPresentationLocale("de"), "de");
assert.equal(parseTipGuestPresentationLocale("en"), "en");
assert.equal(parseTipGuestPresentationLocale("fr"), null);
assert.equal(parseTipGuestPresentationLocale("../../../etc/passwd"), null);
pass("parseTipGuestPresentationLocale accepts en/de only");

const deSession = resolveEmailLocaleFromCheckoutSession({
  id: "cs_test",
  metadata: { locale: "de" },
  locale: "en",
} as Parameters<typeof resolveEmailLocaleFromCheckoutSession>[0]);
assert.equal(deSession, "de");
pass("Checkout session metadata.locale wins over Stripe session.locale for email");

const stripeOnly = resolveEmailLocaleFromCheckoutSession({
  id: "cs_test",
  metadata: {},
  locale: "de",
} as Parameters<typeof resolveEmailLocaleFromCheckoutSession>[0]);
assert.equal(stripeOnly, "de");
pass("Stripe checkout session.locale used when metadata missing");

const switcher = read("src/app/pages/customer/CustomerJourneyLanguageSwitcher.tsx");
if (
  switcher.includes("changeCustomerJourneyLanguage") &&
  switcher.includes("CustomerJourneyLanguageSwitcher")
) {
  pass("Customer journey language switcher uses shared i18n (in-place)");
} else {
  fail("Missing CustomerJourneyLanguageSwitcher in-place i18n wiring");
}

const header = read("src/app/pages/customer/CustomerJourneyHeader.tsx");
if (header.includes("CustomerJourneyLanguageSwitcher")) {
  pass("Language switcher mounted on customer journey header");
} else {
  fail("CustomerJourneyHeader missing language switcher");
}

const checkout = read("src/app/lib/startGuestTipCheckout.ts");
if (checkout.includes("getGuestTipPresentationLocale") && checkout.includes("locale:")) {
  pass("Guest checkout sends presentation locale to API");
} else {
  fail("startGuestTipCheckout missing locale");
}

const stripeSvc = read("backend/src/services/stripe.service.ts");
if (stripeSvc.includes("metadata.locale = guestLocale") && stripeSvc.includes("locale: guestLocale")) {
  pass("Stripe checkout persists guest locale on session + PI metadata");
} else {
  fail("stripe.service missing guest locale persistence");
}

const deMail = buildTipGuestConfirmationContent({
  locale: "de",
  amountEur: 5,
  employeeName: "Anna",
  businessName: "Café",
  receiptNumber: "CT-26-LOCALE",
});
assert.match(deMail.subject, /Trinkgeld/);
pass("DE confirmation email template renders");

if (failed > 0) {
  console.error(`\nqr-guest-tip-locale-runtime: ${failed} failed`);
  process.exit(1);
}
console.log("\nqr-guest-tip-locale-runtime: ok");
