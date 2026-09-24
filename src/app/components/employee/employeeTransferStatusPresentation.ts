import type { EmployeeAnalyticsBundle } from "../../lib/api";

export type EmployeeTransferStatusKind =
  | "transfer_failed"
  | "transfer_review_amount"
  | "transfer_review_destination"
  | "transfer_review_duplicate"
  | "transfer_verifying"
  | "stripe_unreadable"
  | "incomplete"
  | "transfer_confirmed"
  | "transfer_pending"
  | "healthy";

export type EmployeeTransferStatusTone = "positive" | "neutral" | "warning";

export type EmployeeTransferStatusView = {
  kind: EmployeeTransferStatusKind;
  tone: EmployeeTransferStatusTone;
  titleKey: string;
  messageKey: string;
  messageParams?: Record<string, string | number>;
  /** Latest Stripe Transfer `created` among MATCHED rows (server-verified). */
  confirmedTransferAt: string | null;
};

type ReconciliationRow = EmployeeAnalyticsBundle["reconciliation"]["rows"][number];
type ReconciliationSlice = EmployeeAnalyticsBundle["reconciliation"];

const UNRESOLVED_KINDS = new Set<EmployeeTransferStatusKind>([
  "transfer_failed",
  "transfer_review_amount",
  "transfer_review_destination",
  "transfer_review_duplicate",
  "transfer_verifying",
]);

function hasRecoverableTransferFailed(rows: ReconciliationRow[]): boolean {
  return rows.some(
    (r) => r.caretipStatus === "transfer_failed" && r.caretipRemainingCents > 0,
  );
}

function reviewKind(rows: ReconciliationRow[]): EmployeeTransferStatusKind | null {
  if (rows.some((r) => r.status === "DUPLICATE_TRANSFER")) return "transfer_review_duplicate";
  if (rows.some((r) => r.status === "DESTINATION_MISMATCH")) return "transfer_review_destination";
  if (rows.some((r) => r.status === "AMOUNT_MISMATCH")) return "transfer_review_amount";
  return null;
}

function hasMissingTransfer(rows: ReconciliationRow[], stripeReadable: boolean): boolean {
  return stripeReadable && rows.some((r) => r.status === "STRIPE_TRANSFER_MISSING");
}

function hasMatchedTransfers(rows: ReconciliationRow[]): boolean {
  return rows.some((r) => r.status === "MATCHED" && r.caretipTransferredCents > 0);
}

function hasPendingRelease(rows: ReconciliationRow[]): boolean {
  return rows.some(
    (r) =>
      r.status === "CARETIP_PENDING" &&
      r.caretipRemainingCents > 0 &&
      (r.caretipStatus === "held_platform" || r.caretipStatus === "transferring"),
  );
}

function latestMatchedTransferAt(rows: ReconciliationRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.status !== "MATCHED" || !row.stripeTransferCreatedAt) continue;
    if (!latest || row.stripeTransferCreatedAt > latest) {
      latest = row.stripeTransferCreatedAt;
    }
  }
  return latest;
}

/**
 * Whether conservative background polling should continue for this status.
 * Does not poll when Stripe is unreadable (polling won't help until Stripe is reachable).
 */
export function shouldPollEmployeeTransferStatus(kind: EmployeeTransferStatusKind): boolean {
  return UNRESOLVED_KINDS.has(kind);
}

/**
 * Derives the employee-facing transfer status from authoritative reconciliation data.
 * Priority is deterministic for mixed row statuses.
 */
export function deriveEmployeeTransferStatus(
  reconciliation: ReconciliationSlice,
): EmployeeTransferStatusView {
  const {
    rows,
    stripeReadable,
    complete,
    examinedPayableCount,
    totalPayableCount,
  } = reconciliation;

  const incompleteParams = {
    examined: examinedPayableCount,
    total: totalPayableCount,
  };
  const confirmedTransferAt = latestMatchedTransferAt(rows);

  if (hasRecoverableTransferFailed(rows)) {
    return {
      kind: "transfer_failed",
      tone: "warning",
      titleKey: "employee.analytics.transferStatus.failedTitle",
      messageKey: "employee.analytics.transferStatus.failedMessage",
      confirmedTransferAt: null,
    };
  }

  const review = reviewKind(rows);
  if (review) {
    const messageKey =
      review === "transfer_review_amount"
        ? "employee.analytics.transferStatus.reviewAmountMessage"
        : review === "transfer_review_destination"
          ? "employee.analytics.transferStatus.reviewDestinationMessage"
          : "employee.analytics.transferStatus.reviewDuplicateMessage";
    return {
      kind: review,
      tone: "warning",
      titleKey: "employee.analytics.transferStatus.reviewTitle",
      messageKey,
      confirmedTransferAt: null,
    };
  }

  if (hasMissingTransfer(rows, stripeReadable)) {
    return {
      kind: "transfer_verifying",
      tone: "neutral",
      titleKey: "employee.analytics.transferStatus.verifyingTitle",
      messageKey: "employee.analytics.transferStatus.verifyingMessage",
      confirmedTransferAt: null,
    };
  }

  if (!stripeReadable) {
    return {
      kind: "stripe_unreadable",
      tone: "neutral",
      titleKey: "employee.analytics.transferStatus.unreadableTitle",
      messageKey: "employee.analytics.transferStatus.unreadableMessage",
      confirmedTransferAt: null,
    };
  }

  if (!complete) {
    return {
      kind: "incomplete",
      tone: "neutral",
      titleKey: "employee.analytics.transferStatus.incompleteTitle",
      messageKey: "employee.analytics.transferStatus.incompleteMessage",
      messageParams: incompleteParams,
      confirmedTransferAt: null,
    };
  }

  if (stripeReadable && hasMatchedTransfers(rows)) {
    return {
      kind: "transfer_confirmed",
      tone: "positive",
      titleKey: "employee.analytics.transferStatus.confirmedTitle",
      messageKey: "employee.analytics.transferStatus.confirmedMessage",
      confirmedTransferAt,
    };
  }

  if (hasPendingRelease(rows)) {
    return {
      kind: "transfer_pending",
      tone: "neutral",
      titleKey: "employee.analytics.transferStatus.pendingTitle",
      messageKey: "employee.analytics.transferStatus.pendingMessage",
      confirmedTransferAt: null,
    };
  }

  return {
    kind: "healthy",
    tone: "positive",
    titleKey: "employee.analytics.transferStatus.healthyTitle",
    messageKey: "employee.analytics.transferStatus.healthyMessage",
    confirmedTransferAt: null,
  };
}
