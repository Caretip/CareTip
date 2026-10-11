/**
 * In-process heartbeat for the scheduled bank payout cron tick (per API instance).
 * Not durable across restarts or multi-instance — use with external cron/health monitoring (see D3 docs).
 */
import type { ScheduledPayoutTickObservabilitySummary } from "./scheduledBankPayoutTickObservability.service.js";

export type ScheduledPayoutTickHeartbeatState = {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastDurationMs: number | null;
  lastErrorClass: string | null;
  consecutiveFailures: number;
  /** Expected cron interval for staleness hints (ms). Default 5 minutes. */
  expectedIntervalMs: number;
};

const DEFAULT_EXPECTED_INTERVAL_MS = 5 * 60 * 1000;

let lastSuccessAt: Date | null = null;
let lastFailureAt: Date | null = null;
let lastDurationMs: number | null = null;
let lastErrorClass: string | null = null;
let consecutiveFailures = 0;
let lastSummary: ScheduledPayoutTickObservabilitySummary | null = null;

export function __resetScheduledPayoutTickHeartbeatForTests(): void {
  lastSuccessAt = null;
  lastFailureAt = null;
  lastDurationMs = null;
  lastErrorClass = null;
  consecutiveFailures = 0;
  lastSummary = null;
}

export function recordScheduledPayoutTickSuccess(
  summary: ScheduledPayoutTickObservabilitySummary,
): void {
  lastSuccessAt = new Date();
  lastDurationMs = summary.durationMs;
  lastErrorClass = null;
  consecutiveFailures = 0;
  lastSummary = summary;
}

export function recordScheduledPayoutTickFailure(errorClass: string): void {
  lastFailureAt = new Date();
  lastErrorClass = errorClass.slice(0, 64);
  consecutiveFailures += 1;
}

export function getScheduledPayoutTickHeartbeatDiagnostics(
  now = Date.now(),
  expectedIntervalMs = DEFAULT_EXPECTED_INTERVAL_MS,
): ScheduledPayoutTickHeartbeatState & {
  stale: boolean;
  lastSummaryAt: string | null;
} {
  const successIso = lastSuccessAt?.toISOString() ?? null;
  const stale =
    lastSuccessAt == null
      ? true
      : now - lastSuccessAt.getTime() > expectedIntervalMs * 2.5;
  return {
    lastSuccessAt: successIso,
    lastFailureAt: lastFailureAt?.toISOString() ?? null,
    lastDurationMs,
    lastErrorClass,
    consecutiveFailures,
    expectedIntervalMs,
    stale,
    lastSummaryAt: lastSummary?.completedAt ?? null,
  };
}

/** Bounded error classification for heartbeat (no message bodies). */
export function classifyScheduledPayoutTickError(err: unknown): string {
  if (err && typeof err === "object" && "name" in err && typeof (err as { name: string }).name === "string") {
    const name = (err as { name: string }).name;
    if (name === "AbortError") return "abort";
    return name.slice(0, 48);
  }
  return "unknown";
}
