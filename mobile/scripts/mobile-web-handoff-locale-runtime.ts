/**
 * Mobile → web handoff locale hint (validated de|en only).
 *
 *   npm run test:mobile-web-handoff-locale
 */
import assert from "node:assert/strict";
import {
  appendMobileWebHandoffLangParam,
  parseMobileWebHandoffLang,
} from "../utils/mobileWebHandoffLocale";

assert.equal(parseMobileWebHandoffLang("de"), "de");
assert.equal(parseMobileWebHandoffLang("EN"), "en");
assert.equal(parseMobileWebHandoffLang("fr"), null);
assert.equal(parseMobileWebHandoffLang("<script>"), null);

const base = "https://app.caretip.com/mobile-auth?token=abc&purpose=billing";
assert.equal(
  appendMobileWebHandoffLangParam(base, "de"),
  "https://app.caretip.com/mobile-auth?token=abc&purpose=billing&lang=de",
);
assert.equal(
  appendMobileWebHandoffLangParam(base, "invalid"),
  "https://app.caretip.com/mobile-auth?token=abc&purpose=billing&lang=de",
);

console.log("mobile-web-handoff-locale-runtime: OK");
