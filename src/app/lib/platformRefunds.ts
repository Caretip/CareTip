import type { PlatformRefundLedgerRow } from "./api";

/**
 * Stripe refund / dispute ledger row for admin UI.
 * Source: GET /api/platform/refunds → tip_refunds table (Stripe webhooks).
 * Never map tipStatus=failed into this shape.
 */
export type RefundRecord = {
  refundId: string;
  originalTransactionId: string;
  businessName: string;
  employeeName: string;
  refundAmountEur: number;
  originalAmountEur: number;
  reason: string;
  status: string;
  kind: string;
  requestedAt: string;
  processedAt: string | null;
  paymentProvider: string;
  stripePaymentIntentId: string | null;
  source: PlatformRefundLedgerRow;
};

export function mapLedgerRefundRow(row: PlatformRefundLedgerRow): RefundRecord {
  return {
    refundId: row.stripeRefundId ?? row.stripeDisputeId ?? row.id,
    originalTransactionId: row.tipId ?? row.stripePaymentIntentId ?? "—",
    businessName: row.businessName,
    employeeName: "—",
    refundAmountEur: row.amountEur,
    originalAmountEur: row.originalAmountEur ?? row.amountEur,
    reason: row.reason ?? row.kind,
    status: row.status,
    kind: row.kind,
    requestedAt: row.occurredAt,
    processedAt: row.status === "succeeded" || row.status === "won" || row.status === "lost" ? row.occurredAt : null,
    paymentProvider: "Stripe",
    stripePaymentIntentId: row.stripePaymentIntentId,
    source: row,
  };
}
