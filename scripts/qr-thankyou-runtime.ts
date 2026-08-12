/**
 * QR thank-you fallback regression (Node stub + unresolved i18n keys).
 *
 *   npm run test:qr-thankyou
 */
import assert from "node:assert/strict";
import {
  DEFAULT_QR_THANK_YOU_MESSAGE,
  looksLikeUnresolvedI18nKey,
  resolveQrThankYouMessage,
} from "../src/app/lib/qrThankYouCopy.ts";
import i18nStub from "../backend/src/qr/stubs/i18n.ts";

function run() {
  assert.equal(looksLikeUnresolvedI18nKey("business.branding.defaultThankYouMessage"), true);
  assert.equal(looksLikeUnresolvedI18nKey("BUSINESS.BRANDING.DEFAULTTHANKYOUMESSAGE"), true);
  assert.equal(looksLikeUnresolvedI18nKey(DEFAULT_QR_THANK_YOU_MESSAGE), false);
  assert.equal(looksLikeUnresolvedI18nKey("Thank you for your tip!"), false);

  assert.equal(
    resolveQrThankYouMessage(false, null, "business.branding.defaultThankYouMessage"),
    DEFAULT_QR_THANK_YOU_MESSAGE,
  );
  assert.equal(
    resolveQrThankYouMessage(false, null, "BUSINESS.BRANDING.DEFAULTTHANKYOUMESSAGE"),
    DEFAULT_QR_THANK_YOU_MESSAGE,
  );
  assert.equal(
    resolveQrThankYouMessage(true, "Thanks for tipping us!", "unused"),
    "Thanks for tipping us!",
  );
  assert.equal(
    resolveQrThankYouMessage(true, "business.branding.defaultThankYouMessage", DEFAULT_QR_THANK_YOU_MESSAGE),
    DEFAULT_QR_THANK_YOU_MESSAGE,
  );

  assert.equal(
    i18nStub.t("business.branding.defaultThankYouMessage", {
      defaultValue: DEFAULT_QR_THANK_YOU_MESSAGE,
    }),
    DEFAULT_QR_THANK_YOU_MESSAGE,
  );
  assert.equal(
    i18nStub.t("business.branding.defaultThankYouMessage"),
    "business.branding.defaultThankYouMessage",
  );

  const resolved = resolveQrThankYouMessage(
    false,
    null,
    i18nStub.t("business.branding.defaultThankYouMessage", {
      defaultValue: DEFAULT_QR_THANK_YOU_MESSAGE,
    }),
  );
  assert.equal(resolved, DEFAULT_QR_THANK_YOU_MESSAGE);
  assert.ok(!looksLikeUnresolvedI18nKey(resolved));
  assert.ok(!resolved.toUpperCase().includes("DEFAULTTHANKYOUMESSAGE"));

  console.log("qr-thankyou-runtime: OK");
}

run();
