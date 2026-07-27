import assert from "node:assert/strict";
import { getQrScanSourceCategory, translateActivitySource } from "../src/app/lib/activitySourceTranslator";

const t = (_key: string, opts?: Record<string, unknown>) => String(opts?.defaultValue ?? "");

// Small unit coverage to ensure we never leak internal scanType identifiers into the UI.
assert.equal(getQrScanSourceCategory("business_directory"), "business");
assert.equal(getQrScanSourceCategory("employee_profile"), "employee");
assert.equal(getQrScanSourceCategory("location"), "location");
assert.equal(getQrScanSourceCategory("table_slug"), "table");
assert.equal(getQrScanSourceCategory("venue"), "venue");

const translated = translateActivitySource(
  { type: "qr.scanned", params: { scanType: "business_directory" } },
  t,
);
assert.ok(translated);
assert.ok(translated.title.includes("Business QR"));
assert.ok(translated.subtitle?.includes("Guest scanned your Business QR"));

const translatedEmp = translateActivitySource(
  { type: "qr.scanned", params: { scanType: "employee", employeeName: "Eucharia Precious" } },
  t,
);
assert.ok(translatedEmp);
assert.ok(translatedEmp.title.includes("Employee QR"));
assert.ok(translatedEmp.subtitle?.includes("Guest viewed Eucharia Precious"));

console.log("activitySourceTranslator unit tests: OK");

