/**
 * Connect payout reconciliation CLI (dry-run default).
 *
 *   tsx scripts/connect-payout-config-reconciliation.ts
 *   tsx scripts/connect-payout-config-reconciliation.ts --apply --pilot-business-id=<id>
 *   tsx scripts/connect-payout-config-reconciliation.ts --apply --all-accounts --confirm-all-accounts
 */
import "../src/loadEnv.js";
import {
  formatReconciliationReportForLog,
  runConnectPayoutConfigReconciliation,
} from "../src/services/connectPayoutConfigReconciliation.service.js";
import { stripeSecretKeyMode } from "../src/utils/stripeKeyMode.js";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a === `--${name}`) return "true";
    if (a.startsWith(prefix)) return a.slice(prefix.length).trim() || null;
  }
  return null;
}

const apply = process.argv.includes("--apply");
const allAccounts = process.argv.includes("--all-accounts");
const confirmAll = process.argv.includes("--confirm-all-accounts");
const pilotBusinessId = arg("pilot-business-id");
const pilotEmployeeId = arg("pilot-employee-id");

if (apply) {
  if (stripeSecretKeyMode() === "live" && process.env.CONNECT_RECONCILIATION_ALLOW_LIVE !== "1") {
    console.error("Refusing --apply with sk_live_ without CONNECT_RECONCILIATION_ALLOW_LIVE=1");
    process.exit(2);
  }
  const hasPilot = Boolean(pilotBusinessId?.trim() || pilotEmployeeId?.trim());
  if (allAccounts) {
    if (!confirmAll) {
      console.error("Bulk --apply requires --confirm-all-accounts");
      process.exit(2);
    }
  } else if (!hasPilot) {
    console.error("--apply requires --pilot-business-id= and/or --pilot-employee-id=, or --all-accounts --confirm-all-accounts");
    process.exit(2);
  }
}

const report = await runConnectPayoutConfigReconciliation({
  mode: apply ? "apply" : "dry_run",
  pilotBusinessId: allAccounts ? null : pilotBusinessId,
  pilotEmployeeId: allAccounts ? null : pilotEmployeeId,
});

console.log(formatReconciliationReportForLog(report));
