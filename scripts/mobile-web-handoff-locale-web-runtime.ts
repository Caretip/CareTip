/**
 * Web-side mobile handoff locale parsing.
 *
 *   npm run test:mobile-web-handoff-locale-web
 */
import assert from "node:assert/strict";
import {
  appendMobileWebHandoffLangParam,
  parseMobileWebHandoffLang,
} from "../src/app/lib/mobileWebHandoffLocale";

assert.equal(parseMobileWebHandoffLang("en"), "en");
assert.equal(parseMobileWebHandoffLang(""), null);

const url = appendMobileWebHandoffLangParam(
  "https://caretip.app/mobile-auth?token=tok",
  "en",
);
assert.match(url, /lang=en$/);

console.log("mobile-web-handoff-locale-web-runtime: OK");
