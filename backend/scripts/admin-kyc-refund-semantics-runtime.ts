/**
 * Admin KYC alert + refund/dispute semantics regression checks (no DB).
 * Run: npm run test:admin-kyc-refund-semantics (from repo root)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDisputeLedgerKind,
  isRefundLedgerKind,
  ledgerEventTypeLabel,
  ledgerReasonLabel,
  ledgerStatusLabel,
  ledgerStatusTone,
  normalizeLedgerReason,
} from "../../src/app/lib/platformRefundSemantics.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const t = (key: string) => {
  const map: Record<string, string> = {
    "admin.refundsPage.eventType.refund": "Refund",
    "admin.refundsPage.eventType.dispute": "Dispute",
    "admin.refundsPage.status.succeeded": "Succeeded",
    "admin.refundsPage.status.failed": "Failed",
    "admin.refundsPage.status.lost": "Lost (dispute)",
    "admin.refundsPage.status.won": "Won",
    "admin.refundsPage.status.needs_response": "Needs response",
    "admin.refundsPage.reason.fraudulent": "Fraudulent",
    "admin.refundsPage.reason.requested_by_customer": "Requested by customer",
    "admin.refundsPage.reason.unspecified": "Not specified",
  };
  return map[key] ?? key;
};

const dashboard = readFileSync(join(root, "src/app/components/AdminDashboard.tsx"), "utf8");
assert(!dashboard.includes("fetchKycQueueMetrics"), "overview does not fetch KYC queue metrics");
assert(!dashboard.includes("pendingKyc"), "overview does not show fake KYC pending alert");
assert(dashboard.includes("pendingOnboarding"), "overview uses onboarding pending alert when applicable");

const kycRoute = readFileSync(join(root, "src/app/pages/platform/BusinessVerificationPage.tsx"), "utf8");
assert(kycRoute.includes("PlatformKycComingSoonPage"), "KYC admin route is coming-soon surface");

const refundsPage = readFileSync(
  join(root, "src/app/pages/platform/revenue/PlatformRefundsPage.tsx"),
  "utf8",
);
assert(refundsPage.includes("ledgerEventTypeLabel"), "refunds table uses event type labels");
assert(refundsPage.includes("colType"), "refunds table has type column");
assert(!refundsPage.includes("reason: row.reason ?? row.kind"), "UI does not fall back reason to kind");

assert(isRefundLedgerKind("refund"), "refund kind");
assert(isDisputeLedgerKind("dispute"), "dispute kind");
assert(normalizeLedgerReason("dispute") === null, "kind is not a reason");
assert(ledgerEventTypeLabel("refund", t) === "Refund", "refund type label");
assert(ledgerEventTypeLabel("dispute", t) === "Dispute", "dispute type label");
assert(ledgerStatusLabel("succeeded", "refund", t) === "Succeeded", "refund succeeded status");
assert(ledgerStatusLabel("failed", "refund", t) === "Failed", "refund failed status");
assert(ledgerStatusLabel("lost", "dispute", t) === "Lost (dispute)", "dispute lost status");
assert(ledgerStatusLabel("won", "dispute", t) === "Won", "dispute won status");
assert(ledgerStatusLabel("needs_response", "dispute", t) === "Needs response", "needs response");
assert(ledgerReasonLabel("fraudulent", t) === "Fraudulent", "fraudulent reason");
assert(ledgerReasonLabel("requested_by_customer", t) === "Requested by customer", "customer reason");
assert(ledgerStatusTone("lost", "dispute") === "dispute", "lost uses dispute tone not failure");
assert(ledgerStatusTone("failed", "refund") === "failure", "refund failed tone");

const en = JSON.parse(readFileSync(join(root, "src/i18n/locales/en.json"), "utf8")) as {
  admin: { refundsPage: { statusReasonNote: string; reason: { fraudulentHint: string } } };
};
assert(
  en.admin.refundsPage.statusReasonNote.toLowerCase().includes("reason"),
  "EN refunds note separates reason from status",
);
assert(
  !en.admin.refundsPage.statusReasonNote.toLowerCase().includes("lost because"),
  "no causal fraudulent/lost wording in note",
);
assert(en.admin.refundsPage.reason.fraudulentHint.length > 20, "fraudulent hint explains Stripe category");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nadmin KYC + refund/dispute semantics checks passed");
