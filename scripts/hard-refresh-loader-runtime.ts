/**
 * P0 hard-refresh loader — page data must not extend global overlay.
 * Run: npm run test:hard-refresh-loader
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const businessBoot = read("src/app/lib/useBusinessPageBoot.ts");
assert(
  !businessBoot.includes("useExtendGlobalLoaderUntilReady"),
  "useBusinessPageBoot must not extend the global branded loader for page data",
);
assert(
  businessBoot.includes("useRegisterPagePaintReady"),
  "useBusinessPageBoot keeps paint latch for cold handoff",
);

const billingHook = read("src/app/hooks/useBillingStatus.ts");
assert(
  billingHook.includes("isProtectedApiReady") && billingHook.includes("subscribeAuthSessionFlags"),
  "useBillingStatus must gate fetch on protected API readiness",
);
assert(
  billingHook.includes("BILLING_STATUS_REQUEST_TIMEOUT_MS"),
  "useBillingStatus must bound billing request duration",
);

const billingApi = read("src/app/lib/api.ts");
assert(
  /fetchBillingStatus\(opts\?: \{ signal\?: AbortSignal \}\)/.test(billingApi),
  "fetchBillingStatus must accept AbortSignal for timeout/cancel",
);

const billingPanel = read("src/app/components/business/settings/BusinessSettingsBillingPanel.tsx");
assert(
  !billingPanel.includes("GlobalAppLoadingHold"),
  "billing panel must use inline loading, not global hold placeholder",
);

console.log("hard-refresh-loader-runtime: ok");
