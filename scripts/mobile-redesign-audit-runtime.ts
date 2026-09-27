/**
 * Static checks for mobile-redesign CSS hooks and i18n text cleanup.
 * Run: npx tsx scripts/mobile-redesign-audit-runtime.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = join(import.meta.dirname, "..");

const dashboardCss = readFileSync(join(root, "src/styles/bundles/dashboard.css"), "utf8");
assert(dashboardCss.includes("caretip-redesign-mobile.css"), "dashboard bundle imports caretip-redesign-mobile.css");

const mobileCss = readFileSync(join(root, "src/styles/caretip-redesign-mobile.css"), "utf8");
assert(mobileCss.includes("caretip-payout-workspace"), "mobile css scopes payout workspace");
assert(mobileCss.includes("2.75rem"), "touch target min-height present");

const en = JSON.parse(readFileSync(join(root, "src/i18n/locales/en.json"), "utf8")) as {
  employee: { payouts: { activityHint: string } };
  business: {
    stripe: { employeeConnections: { hintConnectedBusiness: string } };
    team: { performance: { executive: { healthIndexHint: string } } };
  };
};

assert(
  !en.employee.payouts.activityHint.includes("—"),
  "EN employee activityHint should not use em dash separator",
);
assert(
  en.business.stripe.employeeConnections.hintConnectedBusiness.includes("Connected."),
  "EN hintConnectedBusiness uses period separation",
);
assert(
  en.business.team.performance.executive.healthIndexHint.includes("Not a single KPI"),
  "EN healthIndexHint readable",
);

console.log("mobile-redesign-audit-runtime.ts: ok");
