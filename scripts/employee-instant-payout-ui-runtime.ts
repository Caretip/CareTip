/**
 * Employee Instant Payout Connect UI — presentation states (no Stripe calls).
 * Run: npx tsx scripts/employee-instant-payout-ui-runtime.ts
 */
import {
  employeeInstantCtaEnabled,
  employeeInstantFeePercentLabel,
  employeeInstantShowCta,
  employeeInstantUiMode,
} from "../src/app/components/employee/employeeInstantPayoutPresentation.ts";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
function pass(id: string, detail: string) {
  results.push({ id, pass: true, detail });
}
function fail(id: string, detail: string) {
  results.push({ id, pass: false, detail });
}

const below = employeeInstantUiMode({ eligible: false, reason: "below_minimum" });
if (below === "threshold" && employeeInstantShowCta(below) && !employeeInstantCtaEnabled(below)) {
  pass("below-min", "below €30 shows disabled Instant CTA");
} else {
  fail("below-min", below);
}

const exact = employeeInstantUiMode({ eligible: true, reason: "eligible" });
if (exact === "ready" && employeeInstantShowCta(exact) && employeeInstantCtaEnabled(exact)) {
  pass("eligible", "eligible Instant CTA is enabled");
} else {
  fail("eligible", exact);
}

const hidden = employeeInstantUiMode({ eligible: false, reason: "not_connected" });
if (hidden === "hidden" && !employeeInstantShowCta(hidden)) {
  pass("not-connected", "not connected hides Instant CTA (account Connect CTA remains)");
} else {
  fail("not-connected", hidden);
}

const blocked = employeeInstantUiMode({ eligible: false, reason: "no_instant_destination" });
if (blocked === "blocked" && !employeeInstantShowCta(blocked)) {
  pass("no-destination", "no Instant destination does not show Instant CTA");
} else {
  fail("no-destination", blocked);
}

const fee = employeeInstantFeePercentLabel({
  feeConfigured: true,
  platformFeeCents: 42,
  targetTotalFeeBps: 250,
});
const misleading = employeeInstantFeePercentLabel({
  feeConfigured: true,
  platformFeeCents: 42,
  targetTotalFeeBps: 244,
});
if (fee === "2.5%" && misleading === null) {
  pass("fee-label", "shows 2.5% from target 250 bps; ignores 244 gross-denominator bps");
} else {
  fail("fee-label", JSON.stringify({ fee, misleading }));
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id} — ${r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
