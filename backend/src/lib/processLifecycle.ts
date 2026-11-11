/**
 * Process-wide shutdown flag. While draining, health checks report 503 so a load balancer stops
 * sending new work here, and requests already in flight are allowed to finish.
 */
let draining = false;

export function markProcessDraining(): void {
  draining = true;
}

export function isProcessDraining(): boolean {
  return draining;
}

const DEFAULT_SHUTDOWN_DRAIN_MS = 25_000;
const MIN_SHUTDOWN_DRAIN_MS = 5_000;
const MAX_SHUTDOWN_DRAIN_MS = 120_000;

/**
 * Time in-flight requests get after SIGTERM before the process exits anyway. Keep it below the
 * host's own kill delay (Render sends SIGKILL 30s after SIGTERM unless configured otherwise).
 */
export function shutdownDrainMs(): number {
  const n = Number.parseInt(process.env.SHUTDOWN_DRAIN_MS?.trim() ?? "", 10);
  if (!Number.isFinite(n)) return DEFAULT_SHUTDOWN_DRAIN_MS;
  return Math.min(MAX_SHUTDOWN_DRAIN_MS, Math.max(MIN_SHUTDOWN_DRAIN_MS, n));
}
