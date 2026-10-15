/**
 * In-process invite abuse monitoring (structured logs + threshold alerts).
 * Thresholds and response actions are defined in platform ops configuration.
 */
import { captureServerException } from "../instrument/sentry.js";

export type InviteMonitorEvent =
  | "invite_created"
  | "invite_redemption"
  | "invite_validation_failed"
  | "invite_validation_success"
  | "invite_revoked";

type CounterBucket = { count: number; windowStartMs: number };

const WINDOW_MS = 60 * 60 * 1000;

const counters = new Map<string, CounterBucket>();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const INVITE_ABUSE_THRESHOLDS = {
  /** Max invite generations per business per hour */
  creationsPerBusinessPerHour: envInt("INVITE_MONITOR_CREATIONS_PER_BUSINESS_HOUR", 20),
  /** Max redemptions per invite code per hour (multi-use still monitored) */
  redemptionsPerCodePerHour: envInt("INVITE_MONITOR_REDEMPTIONS_PER_CODE_HOUR", 30),
  /** Max failed validations per client key (IP + code prefix) per hour */
  failedValidationsPerKeyPerHour: envInt("INVITE_MONITOR_FAILED_VALIDATE_HOUR", 60),
  /** Max failed validations across all businesses from one IP per hour */
  failedValidationsPerIpPerHour: envInt("INVITE_MONITOR_FAILED_VALIDATE_IP_HOUR", 120),
} as const;

function bumpCounter(key: string): number {
  const now = Date.now();
  const existing = counters.get(key);
  if (!existing || now - existing.windowStartMs >= WINDOW_MS) {
    counters.set(key, { count: 1, windowStartMs: now });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

function alertIfExceeded(label: string, count: number, threshold: number, details: Record<string, unknown>): void {
  if (count <= threshold) return;
  const payload = { label, count, threshold, ...details };
  console.warn("[invite.abuse.alert]", payload);
  if (count >= threshold * 2) {
    captureServerException(new Error(`Invite abuse threshold exceeded: ${label}`), payload);
  }
}

export function monitorInviteCreated(params: {
  businessId: string;
  createdByUserId: string;
  inviteId: string;
}): void {
  const count = bumpCounter(`create:business:${params.businessId}`);
  console.info("[invite.monitor]", {
    event: "invite_created" satisfies InviteMonitorEvent,
    ...params,
    countLastHour: count,
  });
  alertIfExceeded(
    "excessive_invite_creation",
    count,
    INVITE_ABUSE_THRESHOLDS.creationsPerBusinessPerHour,
    params,
  );
}

export function monitorInviteRedemption(params: {
  inviteId: string;
  inviteCode: string;
  businessId: string;
  redeemedByUserId: string;
}): void {
  const count = bumpCounter(`redeem:code:${params.inviteCode}`);
  console.info("[invite.monitor]", {
    event: "invite_redemption" satisfies InviteMonitorEvent,
    inviteId: params.inviteId,
    businessId: params.businessId,
    redeemedByUserId: params.redeemedByUserId,
    countLastHour: count,
  });
  alertIfExceeded(
    "excessive_invite_redemption",
    count,
    INVITE_ABUSE_THRESHOLDS.redemptionsPerCodePerHour,
    params,
  );
}

export function monitorInviteValidation(params: {
  ok: boolean;
  code: string;
  clientKey: string;
  ipKey?: string;
  businessId?: string;
}): void {
  if (params.ok) {
    console.info("[invite.monitor]", {
      event: "invite_validation_success" satisfies InviteMonitorEvent,
      businessId: params.businessId ?? null,
    });
    return;
  }

  const codeKey = bumpCounter(`validate_fail:${params.clientKey}`);
  alertIfExceeded(
    "invite_validation_failures",
    codeKey,
    INVITE_ABUSE_THRESHOLDS.failedValidationsPerKeyPerHour,
    { clientKey: params.clientKey, codePrefix: params.code.slice(0, 3) },
  );

  if (params.ipKey) {
    const ipCount = bumpCounter(`validate_fail_ip:${params.ipKey}`);
    alertIfExceeded(
      "invite_enumeration_ip",
      ipCount,
      INVITE_ABUSE_THRESHOLDS.failedValidationsPerIpPerHour,
      { ipKey: params.ipKey },
    );
  }

  console.warn("[invite.monitor]", {
    event: "invite_validation_failed" satisfies InviteMonitorEvent,
    codePrefix: params.code.slice(0, 3),
    clientKey: params.clientKey,
  });
}

/** Test helper — reset in-memory counters between test runs. */
export function resetInviteAbuseCountersForTests(): void {
  counters.clear();
}
