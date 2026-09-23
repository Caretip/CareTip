import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = join(import.meta.dirname, "..");
const en = JSON.parse(readFileSync(join(root, "src/i18n/locales/en.json"), "utf8")) as {
  payouts: { instantTerms: Record<string, string> };
  auth: { merchantLegalAcceptance: { label: string } };
  employee: { payouts: { dashboard: { kpiPendingHint: string } } };
  tipFlow: { rating: { tags: Record<string, string> } };
};
const de = JSON.parse(readFileSync(join(root, "src/i18n/locales/de.json"), "utf8")) as typeof en;

assert(
  en.auth.merchantLegalAcceptance.label.includes("Terms & Conditions"),
  "en merchant legal label includes terms",
);
assert(
  en.auth.merchantLegalAcceptance.label.includes("Privacy Policy"),
  "en merchant legal label includes privacy",
);
assert(
  de.auth.merchantLegalAcceptance.label.includes("Datenschutzerklärung"),
  "de merchant legal label includes privacy",
);
assert(
  en.payouts.instantTerms.required.includes("Price and Services List"),
  "en instant payout required copy",
);
assert(en.employee.payouts.dashboard.kpiPendingHint.includes("settling with Stripe"), "en pending");
assert(de.employee.payouts.dashboard.kpiPendingHint.includes("Abwicklung"), "de pending");
assert(en.tipFlow.rating.tags.excellentService === "Excellent service", "en tag");
assert(de.tipFlow.rating.tags.excellentService === "Hervorragender Service", "de tag");

console.log("payout-ux-i18n.unit.ts: ok");
