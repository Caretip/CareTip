/**
 * Albertina Part A — guest tip confirmation email wiring.
 * Run: npm --prefix backend run test:tip-guest-confirmation-email
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { buildTipGuestConfirmationContent } from "../src/emails/i18nEmail.js";
import { resolveEmailLocaleFromCheckoutSession } from "../src/services/tipGuestConfirmationEmail.service.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

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

const schema = read("backend/prisma/schema.prisma");
if (schema.includes("guestConfirmationEmailSentAt")) {
  pass("Transaction stores guestConfirmationEmailSentAt for idempotent sends");
} else {
  fail("Missing guestConfirmationEmailSentAt on Transaction");
}

const stripeSvc = read("backend/src/services/stripe.service.ts");
if (
  stripeSvc.includes("scheduleTipGuestConfirmationEmailForCheckoutSession") &&
  stripeSvc.includes("scheduleTipGuestConfirmationEmailForPaymentIntent")
) {
  pass("Stripe success handlers schedule guest confirmation email");
} else {
  fail("Stripe handlers missing guest confirmation email scheduling");
}

if (stripeSvc.includes("customer_email") && stripeSvc.includes("receipt_email")) {
  pass("Tip checkout forwards guest email to Stripe for confirmation delivery");
} else {
  fail("Tip checkout missing guest email → Stripe wiring");
}

const emailSvc = read("backend/src/services/tipGuestConfirmationEmail.service.ts");
if (emailSvc.includes("claimGuestConfirmationSend") && emailSvc.includes("releaseGuestConfirmationClaim")) {
  pass("Email service uses claim/release idempotency without failing tips");
} else {
  fail("Email service idempotency incomplete");
}

if (
  emailSvc.includes("parseTipGuestPresentationLocale") &&
  emailSvc.includes("session.metadata?.locale")
) {
  pass("Guest confirmation email prefers checkout metadata.locale");
} else {
  fail("Guest confirmation email missing metadata.locale resolution");
}

const stripeLocale = read("backend/src/services/stripe.service.ts");
if (stripeLocale.includes("metadata.locale = guestLocale")) {
  pass("Tip checkout stores guest locale on Stripe session metadata");
} else {
  fail("Tip checkout missing locale metadata");
}

const enFromMeta = resolveEmailLocaleFromCheckoutSession({
  id: "cs_test",
  metadata: { locale: "en" },
  locale: "de",
} as Parameters<typeof resolveEmailLocaleFromCheckoutSession>[0]);
assert.equal(enFromMeta, "en");
pass("resolveEmailLocaleFromCheckoutSession honors metadata.locale");

const successUi = read("src/app/pages/customer/TipSuccessExperience.tsx");
if (successUi.includes("showReceipt = false") && !successUi.match(/showReceipt\s*=\s*true/)) {
  pass("Tip success UI defaults to hiding customer receipt reference");
} else {
  fail("Tip success UI still defaults to showing receipt");
}

const en = JSON.parse(read("src/i18n/locales/en.json"));
if (en.tipFlow?.success?.reviewOnGoogleHint?.includes("Google")) {
  pass("EN external review buttons name Google destination");
} else {
  fail("EN review destination hint missing");
}

const de = JSON.parse(read("src/i18n/locales/de.json"));
if (de.tipFlow?.success?.externalReviewsHint?.includes("CareTip")) {
  pass("DE external review copy states user leaves CareTip");
} else {
  fail("DE external review hint missing CareTip clarification");
}

const enMail = buildTipGuestConfirmationContent({
  locale: "en",
  amountEur: 5,
  employeeName: "Maria",
  businessName: "Demo Venue",
  receiptNumber: "CT-26-TEST1234",
});
assert.match(enMail.subject, /tip was sent/i);
assert.match(enMail.text, /CT-26-TEST1234/);
pass("EN guest confirmation email includes receipt reference in body");

const deMail = buildTipGuestConfirmationContent({
  locale: "de",
  amountEur: 10,
  employeeName: "Maria",
  businessName: "Demo Betrieb",
  receiptNumber: "CT-26-ABCD1234",
});
assert.match(deMail.subject, /Trinkgeld/);
assert.match(deMail.text, /CT-26-ABCD1234/);
pass("DE guest confirmation email includes receipt reference in body");

if (failed > 0) {
  console.error(`\ntip-guest-confirmation-email-runtime: ${failed} failed`);
  process.exit(1);
}
console.log("\ntip-guest-confirmation-email-runtime: ok");
