import type { ScheduledPayoutOpsIncidentCategory, ScheduledPayoutOpsIncidentPayoutType } from "@prisma/client";
import type { NotificationTemplate } from "../notifications/notificationI18n.js";

export function safeScheduledPayoutLedgerRef(ledgerId: string): string {
  const trimmed = ledgerId.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export function scheduledPayoutOpsIncidentUrl(
  payoutType: ScheduledPayoutOpsIncidentPayoutType,
  ledgerId: string,
): string {
  const params = new URLSearchParams({
    detailType: payoutType,
    detailId: ledgerId,
  });
  return `/platform-admin/revenue/scheduled-payout-operations?${params.toString()}`;
}

export function scheduledPayoutIncidentCategoryKey(category: ScheduledPayoutOpsIncidentCategory): string {
  return category;
}

export function scheduledPayoutIncidentNextActionEn(category: ScheduledPayoutOpsIncidentCategory): string {
  switch (category) {
    case "retry_exhausted":
      return "Open scheduled payout operations, review the ledger, and run recovery or reconcile before any manual Stripe action.";
    case "reconciliation_required":
      return "Reconcile the ledger against Stripe Connect payouts using the ops reconcile action.";
    case "reconciliation_inconclusive":
      return "Investigate Stripe payout history; use reconcile in ops until reconciliation is conclusive.";
    case "outcome_uncertain":
      return "Verify whether a Stripe payout was created; reconcile before retrying payout creation.";
    case "stale_pending_blocked":
      return "Treat the pending ledger as blocked; reconcile stale pending state before recovery.";
    case "manual_intervention_required":
      return "Review blocked payout state in scheduled payout operations and follow the runbook.";
    case "payout_overdue":
      return "Payout is overdue with open manual intervention; prioritize ops review and recovery.";
    default:
      return "Review scheduled payout operations.";
  }
}

export function scheduledPayoutIncidentNextActionDe(category: ScheduledPayoutOpsIncidentCategory): string {
  switch (category) {
    case "retry_exhausted":
      return "Geplante Auszahlungs-Ops öffnen, Ledger prüfen und Recovery oder Abgleich ausführen.";
    case "reconciliation_required":
      return "Ledger mit Stripe-Connect-Auszahlungen über die Ops-Abgleich-Aktion abgleichen.";
    case "reconciliation_inconclusive":
      return "Stripe-Auszahlungsverlauf prüfen; in den Ops abgleichen bis der Status eindeutig ist.";
    case "outcome_uncertain":
      return "Prüfen, ob eine Stripe-Auszahlung erstellt wurde; vor einem neuen Versuch abgleichen.";
    case "stale_pending_blocked":
      return "Ausstehenden Ledger als blockiert behandeln; veralteten Pending-Status abgleichen.";
    case "manual_intervention_required":
      return "Blockierten Auszahlungsstatus in den Ops prüfen und dem Runbook folgen.";
    case "payout_overdue":
      return "Überfällige Auszahlung mit manuellem Eingriff priorisieren und in den Ops bearbeiten.";
    default:
      return "Geplante Auszahlungs-Ops prüfen.";
  }
}

export function scheduledPayoutIncidentCategoryLabelEn(
  category: ScheduledPayoutOpsIncidentCategory,
): string {
  switch (category) {
    case "retry_exhausted":
      return "Automatic retries exhausted";
    case "reconciliation_required":
      return "Reconciliation required";
    case "reconciliation_inconclusive":
      return "Reconciliation inconclusive";
    case "outcome_uncertain":
      return "Payout outcome uncertain";
    case "stale_pending_blocked":
      return "Stale pending payout blocked";
    case "manual_intervention_required":
      return "Manual intervention required";
    case "payout_overdue":
      return "Scheduled payout overdue";
    default:
      return category;
  }
}

export function scheduledPayoutIncidentCategoryLabelDe(
  category: ScheduledPayoutOpsIncidentCategory,
): string {
  switch (category) {
    case "retry_exhausted":
      return "Automatische Wiederholungen erschöpft";
    case "reconciliation_required":
      return "Abgleich erforderlich";
    case "reconciliation_inconclusive":
      return "Abgleich uneindeutig";
    case "outcome_uncertain":
      return "Auszahlungsergebnis unklar";
    case "stale_pending_blocked":
      return "Veralteter Pending-Auszahlung blockiert";
    case "manual_intervention_required":
      return "Manueller Eingriff erforderlich";
    case "payout_overdue":
      return "Geplante Auszahlung überfällig";
    default:
      return category;
  }
}

export function buildScheduledPayoutOpsIncidentTemplate(params: {
  payoutType: ScheduledPayoutOpsIncidentPayoutType;
  category: ScheduledPayoutOpsIncidentCategory;
  subjectLabel: string;
  ledgerRef: string;
  detectedAtIso: string;
}): NotificationTemplate {
  return {
    id: "scheduled_payout_ops_incident",
    params: {
      payoutType: params.payoutType,
      category: params.category,
      subjectLabel: params.subjectLabel,
      ledgerRef: params.ledgerRef,
      detectedAtIso: params.detectedAtIso,
    },
  };
}

export function scheduledPayoutOpsIncidentDedupeKey(
  incidentId: string,
  notifyGeneration: number,
  userId: string,
): string {
  return `sched_payout_inc:${incidentId}:g${notifyGeneration}:${userId}`;
}
