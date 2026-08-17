/**
 * Dry-run reporting for retention workers.
 *
 * Dry run never mutates data. Logs must not include personal identifiers
 * (email, name, phone, IP, customerName).
 */

export type RetentionDryRunAction =
  | "WOULD_ANONYMIZE"
  | "WOULD_REDACT"
  | "WOULD_DELETE"
  | "WOULD_TOMBSTONE"
  | "WOULD_BACKFILL"
  | "WOULD_ENQUEUE"
  | "WOULD_SKIP_LEGAL_HOLD"
  | "WOULD_SKIP_UNKNOWN_HOLD"
  | "WOULD_SKIP_NOT_ELIGIBLE"
  | "WOULD_SKIP_FINANCIAL_PRESERVE"
  | "WOULD_SKIP_ALREADY_DONE";

export type RetentionDryRunRecord = {
  action: RetentionDryRunAction;
  category: string;
  record: string;
  reason: string;
  retentionExpiry: string | null;
  legalHold: boolean | "unknown";
  financialPreservation: "preserved" | "n/a" | "exception";
};

export function formatDryRunLine(row: RetentionDryRunRecord): string {
  const hold =
    row.legalHold === "unknown" ? "unknown" : row.legalHold ? "true" : "false";
  return [
    row.action,
    `category=${row.category}`,
    `record=${row.record}`,
    `reason=${row.reason}`,
    `retention_expiry=${row.retentionExpiry ?? "n/a"}`,
    `legal_hold=${hold}`,
    `financial_preservation=${row.financialPreservation}`,
  ].join(" ");
}

/** Structured log line — ids only, never PII values. */
export function logDryRunRecord(row: RetentionDryRunRecord): void {
  console.info(`[retention-dry-run] ${formatDryRunLine(row)}`);
}

export function summarizeDryRun(rows: RetentionDryRunRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.action] = (counts[row.action] ?? 0) + 1;
  }
  counts.total = rows.length;
  return counts;
}
