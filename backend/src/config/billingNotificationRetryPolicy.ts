/** Total send attempts per notification row (initial + retries). */
export const BILLING_NOTIFICATION_MAX_SEND_ATTEMPTS_DEFAULT = 5;

/** Default delays after failed attempts 1–4 before the next attempt (ms). */
export const BILLING_NOTIFICATION_RETRY_BACKOFF_MS_DEFAULT = [
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
  2 * 60 * 60 * 1000,
] as const;

export const BILLING_NOTIFICATION_RETRY_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;

export function resolveBillingNotificationMaxSendAttempts(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.BILLING_NOTIFICATION_MAX_SEND_ATTEMPTS?.trim();
  if (!raw) return BILLING_NOTIFICATION_MAX_SEND_ATTEMPTS_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return BILLING_NOTIFICATION_MAX_SEND_ATTEMPTS_DEFAULT;
  }
  return Math.min(parsed, 10);
}

export function resolveBillingNotificationRetryBackoffMs(
  env: NodeJS.ProcessEnv = process.env,
): number[] {
  const raw = env.BILLING_NOTIFICATION_RETRY_BACKOFF_MINUTES?.trim();
  if (!raw) {
    return [...BILLING_NOTIFICATION_RETRY_BACKOFF_MS_DEFAULT];
  }
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const minutes = parts.map((p) => Number.parseInt(p, 10));
  if (minutes.length === 0 || minutes.some((m) => !Number.isFinite(m) || m < 1)) {
    return [...BILLING_NOTIFICATION_RETRY_BACKOFF_MS_DEFAULT];
  }
  return minutes.map((m) =>
    Math.min(m * 60 * 1000, BILLING_NOTIFICATION_RETRY_BACKOFF_MAX_MS),
  );
}

/**
 * After a failed send, `sendAttemptCount` is the number of attempts already made.
 * Returns null when no further automatic attempts should be scheduled.
 */
export function computeBillingNotificationNextAttemptAt(params: {
  sendAttemptCount: number;
  maxAttempts: number;
  backoffMs: number[];
  now?: Date;
  retryAfterMs?: number;
}): Date | null {
  const { sendAttemptCount, maxAttempts, backoffMs } = params;
  const now = params.now ?? new Date();
  if (sendAttemptCount >= maxAttempts) {
    return null;
  }
  if (params.retryAfterMs != null && params.retryAfterMs > 0) {
    return new Date(now.getTime() + params.retryAfterMs);
  }
  const delayIndex = sendAttemptCount - 1;
  const delay =
    delayIndex >= 0 && delayIndex < backoffMs.length
      ? backoffMs[delayIndex]
      : backoffMs[backoffMs.length - 1] ?? BILLING_NOTIFICATION_RETRY_BACKOFF_MS_DEFAULT[0];
  return new Date(now.getTime() + delay);
}

export function isBillingNotificationSendEligible(params: {
  status: string;
  sendAttemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  now?: Date;
}): boolean {
  const now = params.now ?? new Date();
  if (params.status === "exhausted" || params.status === "delivered" || params.status === "superseded") {
    return false;
  }
  if (params.status === "skipped_no_recipient") {
    return false;
  }
  if (params.sendAttemptCount >= params.maxAttempts) {
    return false;
  }
  if (params.nextAttemptAt != null && params.nextAttemptAt.getTime() > now.getTime()) {
    return false;
  }
  return params.status === "pending" || params.status === "failed" || params.status === "sending";
}
