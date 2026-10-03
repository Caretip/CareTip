/**
 * Bank payout history detail / timeline UX regression.
 * Run: npm run test:bank-payout-history-detail
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPayoutTimelineSteps } from "../src/app/lib/connectPayoutTimeline";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const paid = buildPayoutTimelineSteps({
  status: "paid",
  stripeCreatedAt: "2026-10-03T08:00:00.000Z",
  arrivalDate: "2026-10-05T00:00:00.000Z",
  method: "standard",
});
assert(paid.some((s) => s.kind === "initiated"), "paid payout shows initiated");
assert(paid.some((s) => s.kind === "completed"), "paid payout shows completed from arrival_date");
assert(paid.some((s) => s.kind === "in_transit"), "paid payout shows in_transit range when dates differ");

const pending = buildPayoutTimelineSteps({
  status: "in_transit",
  stripeCreatedAt: "2026-10-03T08:00:00.000Z",
  arrivalDate: "2026-10-05T00:00:00.000Z",
  method: "standard",
});
assert(pending.some((s) => s.kind === "expected_arrival"), "in_transit shows expected arrival");

const detail = read("src/app/components/connect/ConnectPayoutDetailDialog.tsx");
assert(detail.includes("PayoutBankLifecycleDetail"), "business detail uses lifecycle view");
assert(detail.includes("ConnectPayoutReconBadge"), "reconciliation retained in detail");

const employeeList = read("src/app/components/employee/EmployeeStripeBankPayoutList.tsx");
assert(employeeList.includes("EmployeeBankPayoutDetailDialog"), "employee bank list opens detail dialog");

const enrichment = read("backend/src/services/connectPayoutDisplayEnrichment.service.ts");
assert(enrichment.includes("enrichBusinessConnectPayoutDto"), "business detail enrichment present");
assert(enrichment.includes("resolveEmployeePayoutInitiationKinds"), "employee initiation lookup present");

const dto = read("backend/src/services/stripeConnectPayout.service.ts");
assert(dto.includes("stripePayoutId: row.stripePayoutId"), "DTO exposes Stripe payout id");

const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");
assert(en.includes("Payout initiated"), "EN timeline copy");
assert(de.includes("Auszahlung gestartet"), "DE timeline copy");

console.log("bank-payout-history-detail-runtime: ok");
