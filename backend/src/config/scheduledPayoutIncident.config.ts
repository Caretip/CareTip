/** Minutes after scheduled due time before `payout_overdue` may fire (requires manual intervention). */
export function scheduledPayoutIncidentOverdueMinutes(): number {
  const raw = process.env.SCHEDULED_PAYOUT_INCIDENT_OVERDUE_MINUTES?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 60) return parsed;
  return 24 * 60;
}

/** Minimum minutes between notification delivery attempts for the same open generation. */
export function scheduledPayoutIncidentNotifyRetryMinutes(): number {
  const raw = process.env.SCHEDULED_PAYOUT_INCIDENT_NOTIFY_RETRY_MINUTES?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 5) return parsed;
  return 30;
}

export const SCHEDULED_PAYOUT_INCIDENT_LEDGER_BATCH = 120;
export const SCHEDULED_PAYOUT_INCIDENT_OPEN_RESOLVE_BATCH = 80;

/** Delivery work items processed per incident sync (oldest pending first). */
export const SCHEDULED_PAYOUT_INCIDENT_DELIVERY_BATCH = 50;

/** Open incidents scanned for delivery row ensure per sync. */
export const SCHEDULED_PAYOUT_INCIDENT_NOTIFY_INCIDENT_BATCH = 60;

/** Lease for a single in-app delivery claim (minutes). Default 10. */
export function scheduledPayoutIncidentDeliveryClaimLeaseMinutes(): number {
  const raw = process.env.SCHEDULED_PAYOUT_INCIDENT_DELIVERY_CLAIM_LEASE_MINUTES?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 2) return parsed;
  return 10;
}
