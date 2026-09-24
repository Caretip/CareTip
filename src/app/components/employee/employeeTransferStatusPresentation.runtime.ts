/**
 * Employee transfer status presentation regressions.
 * Run: npx tsx src/app/components/employee/employeeTransferStatusPresentation.runtime.ts
 */
import assert from "node:assert/strict";
import {
  deriveEmployeeTransferStatus,
  shouldPollEmployeeTransferStatus,
} from "./employeeTransferStatusPresentation";
import type { EmployeeAnalyticsBundle } from "../../lib/api";

function reconciliation(
  overrides: Partial<EmployeeAnalyticsBundle["reconciliation"]> &
    Pick<EmployeeAnalyticsBundle["reconciliation"], "rows">,
): EmployeeAnalyticsBundle["reconciliation"] {
  return {
    needsAttention: false,
    stripeReadable: true,
    complete: true,
    examinedPayableCount: overrides.rows.length,
    totalPayableCount: overrides.rows.length,
    payablesTruncated: false,
    transfersHasMore: false,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

const matchedRow = {
  payableId: "p1",
  transactionId: "t1",
  status: "MATCHED" as const,
  caretipPayableCents: 1000,
  caretipTransferredCents: 1000,
  caretipRemainingCents: 0,
  caretipStatus: "transferred",
  stripeTransferId: "tr_1",
  stripeTransferAmountCents: 1000,
  stripeTransferCreatedAt: "2026-09-24T14:35:00.000Z",
  stripeDestination: "acct_1",
  employeeStripeAccountId: "acct_1",
};

// 1. stripeReadable=false → informational, not verifying
const unreadable = deriveEmployeeTransferStatus(
  reconciliation({
    rows: [
      {
        ...matchedRow,
        status: "STRIPE_TRANSFER_MISSING",
        caretipStatus: "destination_settled",
        stripeTransferId: null,
        stripeTransferCreatedAt: null,
      },
    ],
    stripeReadable: false,
  }),
);
assert.equal(unreadable.kind, "stripe_unreadable");
assert.equal(unreadable.tone, "neutral");

// 2. MATCHED + readable → transfer confirmed (not paidToStripe shortcut)
const confirmed = deriveEmployeeTransferStatus(reconciliation({ rows: [matchedRow] }));
assert.equal(confirmed.kind, "transfer_confirmed");
assert.equal(confirmed.confirmedTransferAt, matchedRow.stripeTransferCreatedAt);

// 3. STRIPE_TRANSFER_MISSING + readable → verifying
const verifying = deriveEmployeeTransferStatus(
  reconciliation({
    rows: [
      {
        ...matchedRow,
        status: "STRIPE_TRANSFER_MISSING",
        stripeTransferId: null,
        stripeTransferAmountCents: null,
        stripeTransferCreatedAt: null,
      },
    ],
    stripeReadable: true,
  }),
);
assert.equal(verifying.kind, "transfer_verifying");

// 4–6. review states
assert.equal(
  deriveEmployeeTransferStatus(
    reconciliation({ rows: [{ ...matchedRow, status: "AMOUNT_MISMATCH" }] }),
  ).kind,
  "transfer_review_amount",
);
assert.equal(
  deriveEmployeeTransferStatus(
    reconciliation({ rows: [{ ...matchedRow, status: "DESTINATION_MISMATCH" }] }),
  ).kind,
  "transfer_review_destination",
);
assert.equal(
  deriveEmployeeTransferStatus(
    reconciliation({ rows: [{ ...matchedRow, status: "DUPLICATE_TRANSFER" }] }),
  ).kind,
  "transfer_review_duplicate",
);

// 7. transfer_failed
const failed = deriveEmployeeTransferStatus(
  reconciliation({
    rows: [
      {
        ...matchedRow,
        status: "CARETIP_PENDING",
        caretipStatus: "transfer_failed",
        caretipTransferredCents: 0,
        caretipRemainingCents: 500,
        stripeTransferCreatedAt: null,
      },
    ],
  }),
);
assert.equal(failed.kind, "transfer_failed");

// 8. pending release
const pending = deriveEmployeeTransferStatus(
  reconciliation({
    rows: [
      {
        ...matchedRow,
        status: "CARETIP_PENDING",
        caretipStatus: "held_platform",
        caretipTransferredCents: 0,
        caretipRemainingCents: 500,
        stripeTransferCreatedAt: null,
      },
    ],
    stripeReadable: true,
    complete: true,
  }),
);
assert.equal(pending.kind, "transfer_pending");

// 9. transition: missing → matched on refetch
const beforeMatch = deriveEmployeeTransferStatus(
  reconciliation({
    rows: [
      {
        ...matchedRow,
        status: "STRIPE_TRANSFER_MISSING",
        stripeTransferId: null,
        stripeTransferCreatedAt: null,
      },
    ],
    stripeReadable: true,
  }),
);
assert.equal(beforeMatch.kind, "transfer_verifying");

const afterMatch = deriveEmployeeTransferStatus(reconciliation({ rows: [matchedRow] }));
assert.equal(afterMatch.kind, "transfer_confirmed");

const afterMismatch = deriveEmployeeTransferStatus(
  reconciliation({ rows: [{ ...matchedRow, status: "AMOUNT_MISMATCH" }] }),
);
assert.equal(afterMismatch.kind, "transfer_review_amount");

// 10. two-employee isolation (presentation layer)
const employeeA = deriveEmployeeTransferStatus(reconciliation({ rows: [matchedRow] }));
const employeeB = deriveEmployeeTransferStatus(
  reconciliation({
    rows: [
      {
        ...matchedRow,
        payableId: "p2",
        status: "STRIPE_TRANSFER_MISSING",
        stripeTransferId: null,
        stripeTransferCreatedAt: null,
      },
    ],
    stripeReadable: true,
  }),
);
const employeeC = deriveEmployeeTransferStatus(
  reconciliation({ rows: [{ ...matchedRow, status: "AMOUNT_MISMATCH" }] }),
);
assert.equal(employeeA.kind, "transfer_confirmed");
assert.equal(employeeB.kind, "transfer_verifying");
assert.equal(employeeC.kind, "transfer_review_amount");
assert.notEqual(employeeA.kind, employeeB.kind);

const employeeBConfirmed = deriveEmployeeTransferStatus(reconciliation({ rows: [matchedRow] }));
assert.equal(employeeBConfirmed.kind, "transfer_confirmed");

// 11. polling only for unresolved states
assert.equal(shouldPollEmployeeTransferStatus("transfer_verifying"), true);
assert.equal(shouldPollEmployeeTransferStatus("transfer_confirmed"), false);
assert.equal(shouldPollEmployeeTransferStatus("stripe_unreadable"), false);

// 12. paidToStripeEur alone must NOT confirm without MATCHED
const noMatchButPaid = deriveEmployeeTransferStatus(
  reconciliation({
    rows: [
      {
        ...matchedRow,
        status: "CARETIP_PENDING",
        caretipStatus: "held_platform",
        caretipTransferredCents: 0,
        caretipRemainingCents: 0,
        stripeTransferCreatedAt: null,
      },
    ],
    stripeReadable: true,
    complete: true,
  }),
);
assert.equal(noMatchButPaid.kind, "healthy");

console.log("employee-transfer-status-presentation: OK");
