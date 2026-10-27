/**
 * Read-only inventory by default. Does not clear overrides unless both confirm flags are set.
 *
 *   npx tsx scripts/connect-settlement-default-migration.ts
 *   npx tsx scripts/connect-settlement-default-migration.ts --apply --confirm-test-mode-clear --confirm-business-express-eligibility
 *
 * Refuses any key other than sk_test_. Never send this at live Stripe.
 * Candidates are business Express DE test accounts with explicit override 3.
 * Employee recipient accounts, live accounts, and incomplete reads are excluded.
 * A clear is an empty delay_days_override, never 0. Success requires a following read
 * with no override and effective delay 3. A failed read-back is reported and stops
 * the run. The previous override is not written back.
 */
import "../src/loadEnv.js";
import {
  formatSettlementMigrationReport,
  runSettlementDefaultMigration,
} from "../src/services/connectSettlementDefaultMigration.service.js";
import { stripeSecretKeyMode } from "../src/utils/stripeKeyMode.js";

const apply = process.argv.includes("--apply");
const confirmTestModeClear = process.argv.includes("--confirm-test-mode-clear");
const confirmBusinessExpressEligibility = process.argv.includes("--confirm-business-express-eligibility");

if (stripeSecretKeyMode() !== "test") {
  console.error("Refusing settlement migration inventory: STRIPE_SECRET_KEY is not a test key.");
  process.exit(2);
}

if (apply && (!confirmTestModeClear || !confirmBusinessExpressEligibility)) {
  console.error(
    "Refusing --apply. Required: --confirm-test-mode-clear --confirm-business-express-eligibility",
  );
  process.exit(2);
}

const report = await runSettlementDefaultMigration({
  mode: apply ? "apply" : "dry_run",
  confirmTestModeClear,
  confirmBusinessExpressEligibility,
});

console.log(formatSettlementMigrationReport(report));
if (report.blocker) process.exit(2);
