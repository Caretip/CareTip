/** One-shot boost so post-billing foreground sync is not skipped by cooldown. */

let boostUntilMs = 0;

export function boostForegroundSyncAfterBilling(windowMs = 45_000): void {
  boostUntilMs = Date.now() + windowMs;
}

export function shouldBypassForegroundSyncCooldown(nowMs = Date.now()): boolean {
  return nowMs < boostUntilMs;
}
