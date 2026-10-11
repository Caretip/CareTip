/**
 * Phase C — pure incident classification from authoritative ledger state.
 */
import {
  ScheduledPayoutFailureClassification,
  ScheduledPayoutReconciliationStatus,
  StripeConnectScheduledPayoutRequestStatus,
} from "@prisma/client";
import type { ScheduledPayoutOpsIncidentCategory } from "@prisma/client";
import type { NotificationPriority } from "@prisma/client";
import {
  SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS,
  type ScheduledPayoutLedgerSnapshot,
} from "./scheduledBankPayoutRecovery.service.js";
import { deriveManualInterventionRequired } from "./platformScheduledPayoutOperations.service.js";

export type ScheduledPayoutIncidentClassified = {
  category: ScheduledPayoutOpsIncidentCategory;
  severity: NotificationPriority;
  fingerprint: string;
};

export type ScheduledPayoutLedgerIncidentInput = {
  snapshot: ScheduledPayoutLedgerSnapshot;
  status: StripeConnectScheduledPayoutRequestStatus;
  blockedReason: string | null;
  failureClassification: ScheduledPayoutFailureClassification | null;
  reconciliationStatus: ScheduledPayoutReconciliationStatus;
  attemptCount: number;
  correlationId: string | null;
  stripePayoutId: string | null;
  failureCode: string | null;
};

export function scheduledPayoutIncidentFingerprint(parts: Record<string, string | number | null>): string {
  const keys = Object.keys(parts).sort();
  const raw = keys.map((k) => `${k}=${parts[k] ?? ""}`).join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return `fp_${Math.abs(hash).toString(16).padStart(8, "0")}`;
}

function baseFingerprint(
  category: ScheduledPayoutOpsIncidentCategory,
  row: ScheduledPayoutLedgerIncidentInput,
): string {
  return scheduledPayoutIncidentFingerprint({
    category,
    status: row.status,
    blockedReason: row.blockedReason,
    reconciliationStatus: row.reconciliationStatus,
    failureClassification: row.failureClassification,
    attemptCount: row.attemptCount,
    failureCode: row.failureCode,
    scheduleWindowKey: row.snapshot.scheduleWindowKey,
  });
}

/** Does not alert on transient retry_scheduled / retry_not_due alone. */
export function classifyScheduledPayoutLedgerIncidents(
  row: ScheduledPayoutLedgerIncidentInput,
  options?: { payoutOverdue?: boolean },
): ScheduledPayoutIncidentClassified[] {
  const out: ScheduledPayoutIncidentClassified[] = [];
  const snap = row.snapshot;
  const manual = deriveManualInterventionRequired(
    {
      status: row.status,
      blockedReason: row.blockedReason,
      failureClassification: row.failureClassification,
      reconciliationStatus: row.reconciliationStatus,
      attemptCount: row.attemptCount,
      correlationId: row.correlationId,
      stripePayoutId: row.stripePayoutId,
      failureCode: row.failureCode,
    },
    snap,
  );

  if (
    row.blockedReason === "retry_exhausted" ||
    row.attemptCount >= SCHEDULED_PAYOUT_MAX_CREATE_ATTEMPTS
  ) {
    out.push({
      category: "retry_exhausted",
      severity: "high",
      fingerprint: baseFingerprint("retry_exhausted", row),
    });
  }

  if (row.reconciliationStatus === ScheduledPayoutReconciliationStatus.inconclusive) {
    out.push({
      category: "reconciliation_inconclusive",
      severity: "high",
      fingerprint: baseFingerprint("reconciliation_inconclusive", row),
    });
  }

  if (
    row.reconciliationStatus === ScheduledPayoutReconciliationStatus.required &&
    row.status === StripeConnectScheduledPayoutRequestStatus.failed
  ) {
    out.push({
      category: "reconciliation_required",
      severity: "high",
      fingerprint: baseFingerprint("reconciliation_required", row),
    });
  }

  if (row.failureClassification === ScheduledPayoutFailureClassification.outcome_uncertain) {
    out.push({
      category: "outcome_uncertain",
      severity: "high",
      fingerprint: baseFingerprint("outcome_uncertain", row),
    });
  }

  const staleBlocked =
    row.blockedReason === "stale_pending_no_stripe_match" ||
    row.blockedReason === "stale_pending_reconcile" ||
    (row.status === StripeConnectScheduledPayoutRequestStatus.pending &&
      row.blockedReason === "reconciliation_inconclusive");
  if (staleBlocked) {
    out.push({
      category: "stale_pending_blocked",
      severity: "high",
      fingerprint: baseFingerprint("stale_pending_blocked", row),
    });
  }

  const recoveryInFlight =
    row.blockedReason === "retry_scheduled" || row.blockedReason === "retry_not_due";
  if (manual && !recoveryInFlight && !out.some((i) => i.category === "retry_exhausted")) {
    const alreadySpecific = out.length > 0;
    if (!alreadySpecific || row.blockedReason === "permanent_failure") {
      out.push({
        category: "manual_intervention_required",
        severity: "high",
        fingerprint: baseFingerprint("manual_intervention_required", row),
      });
    }
  }

  if (options?.payoutOverdue && manual) {
    out.push({
      category: "payout_overdue",
      severity: "normal",
      fingerprint: baseFingerprint("payout_overdue", row),
    });
  }

  const deduped = new Map<string, ScheduledPayoutIncidentClassified>();
  for (const item of out) deduped.set(item.category, item);
  return [...deduped.values()];
}

export function incidentCategoryStillActive(
  category: ScheduledPayoutOpsIncidentCategory,
  classified: ScheduledPayoutIncidentClassified[],
): boolean {
  return classified.some((c) => c.category === category);
}
