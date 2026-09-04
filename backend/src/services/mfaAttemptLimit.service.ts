import { checkAndIncrementLimitDistributed, peekLimitDistributed } from "../utils/rateLimitStore.js";
import { securityRateLimits } from "../config/securityRateLimit.config.js";

const LOCK_MSG = "Too many failed verification attempts. Please try again later.";

function failureKey(userId: string): string {
  return `mfa:fail:user:${userId}`;
}

export function mfaLockoutMessage(): string {
  return LOCK_MSG;
}

export class MfaVerifyLockedError extends Error {
  constructor() {
    super(LOCK_MSG);
    this.name = "MfaVerifyLockedError";
  }
}

/** Call before processing a TOTP verify attempt (does not increment counters). */
export async function assertMfaVerifyAllowed(userId: string): Promise<void> {
  const { lock } = securityRateLimits.mfaFailure;
  const windowMs = lock.lockoutMs > 0 ? lock.lockoutMs : lock.windowMs;
  const peek = await peekLimitDistributed({
    key: failureKey(userId),
    maxPerWindow: lock.maxFailures,
    windowMs,
  });
  if (!peek.allowed) {
    throw new MfaVerifyLockedError();
  }
}

/** Record a failed TOTP attempt; may activate lockout for the failure window. */
export async function recordMfaVerifyFailure(userId: string): Promise<void> {
  const { lock } = securityRateLimits.mfaFailure;
  const windowMs = lock.lockoutMs > 0 ? lock.lockoutMs : lock.windowMs;
  await checkAndIncrementLimitDistributed({
    key: failureKey(userId),
    maxPerWindow: lock.maxFailures,
    windowMs,
  });
}

export async function clearMfaVerifyFailures(_userId: string): Promise<void> {
  // Failure buckets expire with their window; no explicit clear required.
}
