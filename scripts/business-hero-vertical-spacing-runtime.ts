/**
 * Business dashboard hero — KPI → Stripe metrics vertical rhythm (no transform hacks).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(
  path.join(repoRoot, "src/styles/business-dashboard-hierarchy.css"),
  "utf8",
);

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(css.includes("dashboard-hero-financial__hint-slot"), "hint slot override");
assert(css.includes("min-height: 0"), "removed reserved hint min-height for business");
assert(!css.includes("translateY"), "no transform hack");
assert(css.includes("margin-top: 0.125rem"), "tighter payout zone offset");
assert(css.includes("flex: 0 1 auto"), "desktop CTA block no longer stretches");
assert(css.includes("employee-dashboard .employee-dashboard-hero .dashboard-hero-financial-panel"), "employee hero parity");
assert(css.includes("employee-qr-signature"), "employee QR CTA spacing");

console.log("business-hero-vertical-spacing-runtime: ok");
