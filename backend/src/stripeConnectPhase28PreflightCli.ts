/** Run: npm run preflight:stripe-connect-phase2-8 — secret-safe Connect production-readiness printout. */
import "dotenv/config";
import "./loadEnv.js";
import {
  formatStripeConnectPreflight,
  inspectStripeConnectPreflight,
  preflightTextLeaksSecrets,
} from "./config/stripeConnectProductionPreflight.js";

const report = inspectStripeConnectPreflight(process.env);
const text = formatStripeConnectPreflight(report);

if (preflightTextLeaksSecrets(text, process.env)) {
  console.error("Preflight aborted: output would leak a secret.");
  process.exit(1);
}

console.log("CareTip Stripe Connect Phase 2.8 configuration preflight");
console.log("(no secrets, no Stripe mutations, Render not inspected)\n");
console.log(text);
console.log("");

if (report.stripeSecretKey.mode === "LIVE") {
  console.log("WARNING: LIVE key detected in this process. Do not run Stripe mutations from this environment.");
}

if (report.environmentLabel === "PRODUCTION_PROCESS" && report.frontendUrl.validity === "INVALID") {
  process.exitCode = 1;
}
