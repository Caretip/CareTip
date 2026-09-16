/**
 * Focused runtime checks for language-specific CareTip legal PDFs.
 * Run: npx tsx backend/scripts/merchant-legal-acceptance-runtime.ts
 */
import assert from "node:assert/strict";
import {
  CARETIP_PLV_VALID_FROM,
  careTipControlledPdfSha256,
  getCareTipControlledLegalDocMeta,
  normalizeCareTipLegalLanguage,
  parseCareTipControlledLegalDocId,
  readCareTipControlledPdf,
} from "../src/lib/caretipControlledLegalDocs.js";

function pass(name: string) {
  console.log(`PASS ${name}`);
}

{
  assert.equal(parseCareTipControlledLegalDocId("avv"), "avv");
  assert.equal(parseCareTipControlledLegalDocId("dpa"), "avv");
  assert.equal(parseCareTipControlledLegalDocId("plv"), "plv");
  assert.equal(normalizeCareTipLegalLanguage("en-US"), "en");
  assert.equal(normalizeCareTipLegalLanguage("de"), "de");
  assert.equal(normalizeCareTipLegalLanguage(undefined), "de");
  pass("ids + language normalize");
}

{
  const plvDe = readCareTipControlledPdf("plv", "de");
  const plvEn = readCareTipControlledPdf("plv", "en");
  const avvDe = readCareTipControlledPdf("avv", "de");
  const avvEn = readCareTipControlledPdf("avv", "en");
  assert.equal(plvDe.subarray(0, 4).toString("utf8"), "%PDF");
  assert.equal(plvEn.subarray(0, 4).toString("utf8"), "%PDF");
  assert.notEqual(careTipControlledPdfSha256("plv", "de"), careTipControlledPdfSha256("plv", "en"));
  assert.notEqual(careTipControlledPdfSha256("avv", "de"), careTipControlledPdfSha256("avv", "en"));
  assert.ok(plvDe.length > 1000 && plvEn.length > 1000);
  assert.ok(avvDe.length > 1000 && avvEn.length > 1000);
  pass("language-specific PDF bytes differ");
}

{
  const plvDe = getCareTipControlledLegalDocMeta("plv", "de");
  const plvEn = getCareTipControlledLegalDocMeta("plv", "en");
  assert.equal(plvDe.language, "de");
  assert.equal(plvEn.language, "en");
  assert.equal(plvDe.validFrom, CARETIP_PLV_VALID_FROM);
  assert.match(plvDe.apiPath, /lang=de/);
  assert.match(plvEn.apiPath, /lang=en/);
  pass("metadata includes language query");
}

console.log("All language-routing legal PDF checks passed.");
