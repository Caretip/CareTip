import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const nav = read("src/app/components/platform/platformAdminNav.ts");
assert(nav.includes("scheduledPayoutOps"), "nav entry");

const guard = read("src/app/components/PlatformAdminRoute.tsx");
assert(guard.includes("canAccessPlatformAdminWorkspace"), "platform guard uses isPlatformAdmin");

const en = read("src/i18n/locales/en.json");
assert(en.includes("scheduledPayoutOps"), "en i18n");
const de = read("src/i18n/locales/de.json");
assert(de.includes("scheduledPayoutOps"), "de i18n");

console.log("scheduled-payout-ops-ui-runtime: ok");
