/** Run: npm run preflight:stripe-connect-phase2-9 — secret-safe Connect go-live preflight. */
import "dotenv/config";
import "./loadEnv.js";
import {
  formatStripeConnectGoLivePreflight,
  inspectStripeConnectPreflight,
  preflightTextLeaksSecrets,
} from "./config/stripeConnectProductionPreflight.js";

const report = inspectStripeConnectPreflight(process.env);
const text = formatStripeConnectGoLivePreflight(report);

if (preflightTextLeaksSecrets(text, process.env)) {
  console.error("Preflight aborted: output would leak a secret.");
  process.exit(1);
}

console.log("CareTip Stripe Connect Phase 2.9 go-live preflight");
console.log("(no secrets, no Stripe mutations, Render/Dashboard not inspected)\n");
console.log(text);
console.log("");

if (report.stripeSecretKey.mode === "LIVE") {
  console.log("WARNING: LIVE key detected in this process. Do not run Stripe mutations from this environment.");
}

if (report.environmentLabel === "PRODUCTION_PROCESS" && report.frontendUrl.validity === "INVALID") {
  process.exitCode = 1;
}
