/** Default reconciliation businesses examined per daily cron run. */
export const BILLING_RECONCILIATION_BATCH_SIZE_DEFAULT = 100;

/**
 * Hard cap — prevents accidental unbounded scans via misconfiguration.
 * Daily cron + ~2 Stripe calls/business ≈ 200 API calls/run (within Stripe limits).
 * Render HTTP cron caller timeout is 120s; keep batch at 100 unless profiling shows headroom.
 */
export const BILLING_RECONCILIATION_BATCH_SIZE_MAX = 100;

export function resolveBillingReconciliationBatchSize(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.BILLING_RECONCILIATION_BATCH_SIZE?.trim();
  if (!raw) {
    return BILLING_RECONCILIATION_BATCH_SIZE_DEFAULT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return BILLING_RECONCILIATION_BATCH_SIZE_DEFAULT;
  }
  return Math.min(parsed, BILLING_RECONCILIATION_BATCH_SIZE_MAX);
}
