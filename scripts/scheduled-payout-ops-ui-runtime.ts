import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { payoutMethodI18nKey, payoutMethodKind } from "../src/app/lib/connectPayoutDisplay.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const routes = read("src/app/routes.tsx");
assert(routes.includes("scheduled-payout-operations"), "route registered");
assert(routes.includes("PlatformScheduledPayoutOperationsPage"), "page lazy import");
assert(
  routes.includes('revenue/connect-payouts') &&
    routes.includes('Navigate to="/platform-admin/revenue/scheduled-payout-operations"'),
  "connect-payouts redirects to scheduled payout operations",
);
assert(!routes.includes("PlatformConnectPayoutsPage"), "retired connect payouts page import");

const nav = read("src/app/components/platform/platformAdminNav.ts");
assert(nav.includes("scheduledPayoutOps"), "nav entry");
assert(!nav.includes("connect-payouts"), "connect payouts removed from platform admin nav");

const guard = read("src/app/components/PlatformAdminRoute.tsx");
assert(guard.includes("canAccessPlatformAdminWorkspace"), "platform guard uses isPlatformAdmin");

const page = read("src/app/pages/platform/revenue/PlatformScheduledPayoutOperationsPage.tsx");
assert(page.includes("colMethod"), "Method column in scheduled ops page");
assert(page.includes("payoutMethod"), "payoutMethod field rendered");
assert(page.includes("filterMethod"), "method filter on scheduled ops page");

const api = read("src/app/lib/api.ts");
assert(api.includes("payoutMethod:"), "API type includes payoutMethod");

const en = read("src/i18n/locales/en.json");
assert(en.includes("colMethod"), "en i18n Method column");
const de = read("src/i18n/locales/de.json");
assert(de.includes("colMethod"), "de i18n Method column");

assert(payoutMethodKind("instant") === "instant", "instant method mapping");
assert(payoutMethodKind("standard") === "standard", "standard method mapping");
assert(payoutMethodKind(null) === "unknown", "missing method is unknown");
assert(payoutMethodKind("card") === "unknown", "unsupported method is unknown");
assert(payoutMethodI18nKey("instant") === "business.billing.payouts.methodInstant", "instant i18n key");

console.log("scheduled-payout-ops-ui-runtime: ok");
