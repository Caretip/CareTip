/**
 * Employee platform-hold transfer recovery (Stripe list + idempotency window).
 *
 * Stripe idempotency keys are retained for ~24 hours (Stripe API docs). After that,
 * transfers.create with the same key may create a new transfer. Lookup via
 * transfers.list (destination-scoped, metadata filter) is required before create when
 * a payable may already have a succeeded transfer that was never persisted.
 *
 * Production reconciliation (lookup only, no transfers.create):
 *   POST /api/internal/jobs/employee-tip-release-reconciliation-tick
 *   Render cron: caretip-employee-tip-release-reconciliation (every 10 minutes UTC)
 *   Batch: EMPLOYEE_TIP_RELEASE_RECONCILE_BATCH_SIZE (default 25)
 *   Stale transferring without durable marker: EMPLOYEE_TIP_RELEASE_RECONCILE_STALE_MINUTES (default 60)
 */

const HOUR_MS = 60 * 60 * 1000;

function readPositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Max pages of transfers.list per destination (limit 100/page). Incomplete → no create. */
export const EMPLOYEE_TIP_RELEASE_TRANSFER_LOOKUP_MAX_PAGES = readPositiveInt(
  "EMPLOYEE_TIP_RELEASE_TRANSFER_LOOKUP_MAX_PAGES",
  50,
);

export const EMPLOYEE_TIP_RELEASE_TRANSFER_LOOKUP_PAGE_SIZE = 100;

/**
 * Below Stripe's ~24h idempotency retention — after this age, always Stripe-list before create.
 * Default 20h.
 */
export const EMPLOYEE_TIP_RELEASE_IDEMPOTENCY_SAFE_HOURS = readPositiveInt(
  "EMPLOYEE_TIP_RELEASE_IDEMPOTENCY_SAFE_HOURS",
  20,
);

export function employeeTipReleaseIdempotencySafeWindowMs(): number {
  return EMPLOYEE_TIP_RELEASE_IDEMPOTENCY_SAFE_HOURS * HOUR_MS;
}

/**
 * Log actionable ops warning when transferring + no stripeTransferId older than this.
 * Default 12h (configurable via EMPLOYEE_TIP_TRANSFERRING_STALE_ALERT_HOURS).
 */
export const EMPLOYEE_TIP_TRANSFERRING_STALE_ALERT_HOURS = readPositiveInt(
  "EMPLOYEE_TIP_TRANSFERRING_STALE_ALERT_HOURS",
  12,
);

export function employeeTipTransferringStaleAlertThresholdMs(): number {
  return EMPLOYEE_TIP_TRANSFERRING_STALE_ALERT_HOURS * HOUR_MS;
}

/** Row claim TTL (seconds) while a worker holds an in-flight release. */
export const EMPLOYEE_TIP_RELEASE_PROCESSING_CLAIM_TTL_MS =
  readPositiveInt("EMPLOYEE_TIP_RELEASE_PROCESSING_CLAIM_TTL_SECONDS", 300) * 1000;

/**
 * After transfers.create starts, in-flight marker outlives short claim TTL (default 30 min).
 * Expired in-flight → reclaim + lookup only; no blind create after post-reclaim empty lookup.
 */
export const EMPLOYEE_TIP_RELEASE_IN_FLIGHT_TTL_MS =
  readPositiveInt("EMPLOYEE_TIP_RELEASE_IN_FLIGHT_TTL_SECONDS", 1800) * 1000;

/** Max payables per reconciliation cron tick (lookup/reconcile only — never blind create). */
export const EMPLOYEE_TIP_RELEASE_RECONCILE_BATCH_SIZE = readPositiveInt(
  "EMPLOYEE_TIP_RELEASE_RECONCILE_BATCH_SIZE",
  25,
);

/** Stale transferring rows without durable marker still get lookup-only reconciliation. Default 1h. */
export const EMPLOYEE_TIP_RELEASE_RECONCILE_STALE_MINUTES = readPositiveInt(
  "EMPLOYEE_TIP_RELEASE_RECONCILE_STALE_MINUTES",
  60,
);

export function employeeTipReleaseReconcileStaleThresholdMs(): number {
  return EMPLOYEE_TIP_RELEASE_RECONCILE_STALE_MINUTES * 60 * 1000;
}
