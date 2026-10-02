import type { TFunction } from "i18next";
import type { PlatformAdminStatusTone } from "../components/platform/PlatformAdminDesignPrimitives";

export function isDisputeLedgerKind(kind: string): boolean {
  const k = kind.toLowerCase();
  return k === "dispute" || k === "chargeback";
}

export function isRefundLedgerKind(kind: string): boolean {
  return kind.toLowerCase() === "refund";
}

/** Stripe reason code — never substitute ledger kind when reason is missing. */
export function normalizeLedgerReason(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "refund" || lower === "dispute" || lower === "chargeback") return null;
  return trimmed;
}

export function ledgerEventTypeLabel(kind: string, t: TFunction): string {
  if (isDisputeLedgerKind(kind)) {
    return t("admin.refundsPage.eventType.dispute");
  }
  if (isRefundLedgerKind(kind)) {
    return t("admin.refundsPage.eventType.refund");
  }
  const key = `admin.refundsPage.kind.${kind}`;
  const label = t(key);
  return label === key ? kind.replace(/_/g, " ") : label;
}

export function ledgerStatusLabel(status: string, kind: string, t: TFunction): string {
  const key = `admin.refundsPage.status.${status}`;
  const label = t(key);
  if (label !== key) return label;
  return status.replace(/_/g, " ");
}

export function ledgerReasonLabel(reason: string | null | undefined, t: TFunction): string {
  const normalized = normalizeLedgerReason(reason);
  if (!normalized) return t("admin.refundsPage.reason.unspecified");
  const key = `admin.refundsPage.reason.${normalized}`;
  const label = t(key);
  return label === key ? normalized.replace(/_/g, " ") : label;
}

export function ledgerStatusTone(status: string, kind: string): PlatformAdminStatusTone {
  const s = status.toLowerCase();
  if (s === "succeeded" || s === "processed" || s === "won") return "success";
  if (s === "failed" || s === "canceled" || s === "cancelled") return "failure";
  if (s === "lost") return "dispute";
  if (s === "needs_response" || s === "pending") return "pending";
  if (isDisputeLedgerKind(kind)) return "attention";
  return "neutral";
}

export function ledgerEventTypeTone(kind: string): PlatformAdminStatusTone {
  return isDisputeLedgerKind(kind) ? "dispute" : "neutral";
}
