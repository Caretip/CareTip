/**
 * Distributed processing claim with fencing token + heartbeat (Phase A.2).
 * Not a transaction with Stripe — coordinates which worker may call payouts.create.
 */
import { randomUUID } from "node:crypto";
import { StripeConnectScheduledPayoutRequestStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { SCHEDULED_PAYOUT_STALE_PENDING_MS } from "./scheduledBankPayoutRecovery.service.js";

export const SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS = SCHEDULED_PAYOUT_STALE_PENDING_MS;
export const SCHEDULED_PAYOUT_CLAIM_HEARTBEAT_MS = 2 * 60 * 1000;

/** Non-stale claim held by a scheduled worker — blocks admin reconcile/recovery mutations. */
export function isActiveScheduledPayoutProcessingClaim(
  row: { processingClaimedAt: Date | null; processingClaimToken: string | null },
  now = Date.now(),
): boolean {
  if (!row.processingClaimedAt || !row.processingClaimToken) return false;
  return now - row.processingClaimedAt.getTime() <= SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS;
}

let claimHeartbeatIntervalMsOverride: number | null = null;

/** Test-only: shorten heartbeat interval (reset to null after tests). */
export function __setScheduledPayoutClaimHeartbeatIntervalMsForTests(ms: number | null): void {
  claimHeartbeatIntervalMsOverride = ms;
}

function claimHeartbeatIntervalMs(): number {
  return claimHeartbeatIntervalMsOverride ?? SCHEDULED_PAYOUT_CLAIM_HEARTBEAT_MS;
}

const ACTIVE_CLAIM_STATUSES: StripeConnectScheduledPayoutRequestStatus[] = [
  StripeConnectScheduledPayoutRequestStatus.pending,
  StripeConnectScheduledPayoutRequestStatus.failed,
];

function newClaimToken(): string {
  return randomUUID().replace(/-/g, "").slice(0, 32);
}

export type ScheduledPayoutClaimHandle = {
  claimToken: string;
  renew: () => Promise<boolean>;
  release: () => Promise<void>;
};

export async function tryAcquireEmployeeScheduledPayoutProcessingClaim(
  ledgerId: string,
  correlationId: string,
  now = new Date(),
): Promise<{ acquired: boolean; claimToken?: string }> {
  const staleBefore = new Date(now.getTime() - SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS);
  const claimToken = newClaimToken();
  const result = await prisma.employeeStripeScheduledPayoutRequest.updateMany({
    where: {
      id: ledgerId,
      status: { in: ACTIVE_CLAIM_STATUSES },
      OR: [{ processingClaimedAt: null }, { processingClaimedAt: { lt: staleBefore } }],
    },
    data: {
      processingClaimedAt: now,
      processingClaimToken: claimToken,
      correlationId,
      status: StripeConnectScheduledPayoutRequestStatus.pending,
      blockedReason: null,
    },
  });
  if (result.count !== 1) return { acquired: false };
  return { acquired: true, claimToken };
}

export async function tryAcquireBusinessScheduledPayoutProcessingClaim(
  ledgerId: string,
  correlationId: string,
  now = new Date(),
): Promise<{ acquired: boolean; claimToken?: string }> {
  const staleBefore = new Date(now.getTime() - SCHEDULED_PAYOUT_PROCESSING_CLAIM_TTL_MS);
  const claimToken = newClaimToken();
  const result = await prisma.stripeConnectScheduledPayoutRequest.updateMany({
    where: {
      id: ledgerId,
      status: { in: ACTIVE_CLAIM_STATUSES },
      OR: [{ processingClaimedAt: null }, { processingClaimedAt: { lt: staleBefore } }],
    },
    data: {
      processingClaimedAt: now,
      processingClaimToken: claimToken,
      correlationId,
      status: StripeConnectScheduledPayoutRequestStatus.pending,
      blockedReason: null,
    },
  });
  if (result.count !== 1) return { acquired: false };
  return { acquired: true, claimToken };
}

export async function renewEmployeeScheduledPayoutProcessingClaim(
  ledgerId: string,
  claimToken: string,
  now = new Date(),
): Promise<boolean> {
  const result = await prisma.employeeStripeScheduledPayoutRequest.updateMany({
    where: { id: ledgerId, processingClaimToken: claimToken },
    data: { processingClaimedAt: now },
  });
  return result.count === 1;
}

export async function renewBusinessScheduledPayoutProcessingClaim(
  ledgerId: string,
  claimToken: string,
  now = new Date(),
): Promise<boolean> {
  const result = await prisma.stripeConnectScheduledPayoutRequest.updateMany({
    where: { id: ledgerId, processingClaimToken: claimToken },
    data: { processingClaimedAt: now },
  });
  return result.count === 1;
}

export async function releaseEmployeeScheduledPayoutProcessingClaim(
  ledgerId: string,
  claimToken: string,
): Promise<void> {
  await prisma.employeeStripeScheduledPayoutRequest.updateMany({
    where: { id: ledgerId, processingClaimToken: claimToken },
    data: { processingClaimedAt: null, processingClaimToken: null },
  });
}

export async function releaseBusinessScheduledPayoutProcessingClaim(
  ledgerId: string,
  claimToken: string,
): Promise<void> {
  await prisma.stripeConnectScheduledPayoutRequest.updateMany({
    where: { id: ledgerId, processingClaimToken: claimToken },
    data: { processingClaimedAt: null, processingClaimToken: null },
  });
}

export async function persistEmployeeScheduledPayoutLedgerIfClaimOwner(args: {
  ledgerId: string;
  claimToken: string;
  data: Record<string, unknown>;
}): Promise<boolean> {
  const result = await prisma.employeeStripeScheduledPayoutRequest.updateMany({
    where: { id: args.ledgerId, processingClaimToken: args.claimToken },
    data: args.data as never,
  });
  return result.count === 1;
}

export async function persistBusinessScheduledPayoutLedgerIfClaimOwner(args: {
  ledgerId: string;
  claimToken: string;
  data: Record<string, unknown>;
}): Promise<boolean> {
  const result = await prisma.stripeConnectScheduledPayoutRequest.updateMany({
    where: { id: args.ledgerId, processingClaimToken: args.claimToken },
    data: args.data as never,
  });
  return result.count === 1;
}

/**
 * Heartbeat loop shared by employee/business claim runners (unit-testable).
 */
export async function executeScheduledPayoutClaimHeartbeatWork<T>(
  ledgerId: string,
  claimToken: string,
  renew: (ledgerId: string, claimToken: string) => Promise<boolean>,
  release: (ledgerId: string, claimToken: string) => Promise<void>,
  fn: (handle: ScheduledPayoutClaimHandle) => Promise<T>,
): Promise<{ kind: "ok"; value: T } | { kind: "heartbeat_lost" }> {
  let heartbeatLost = false;
  const intervalMs = claimHeartbeatIntervalMs();
  const interval = setInterval(() => {
    void renew(ledgerId, claimToken).then((ok) => {
      if (!ok) heartbeatLost = true;
    });
  }, intervalMs);
  try {
    const value = await fn({
      claimToken,
      renew: () => renew(ledgerId, claimToken),
      release: () => release(ledgerId, claimToken),
    });
    const stillOwner = await renew(ledgerId, claimToken);
    if (!stillOwner || heartbeatLost) return { kind: "heartbeat_lost" };
    return { kind: "ok", value };
  } finally {
    clearInterval(interval);
    await release(ledgerId, claimToken);
  }
}

export async function runWithEmployeeScheduledPayoutClaimHeartbeat<T>(
  ledgerId: string,
  correlationId: string,
  fn: (handle: ScheduledPayoutClaimHandle) => Promise<T>,
): Promise<
  { kind: "ok"; value: T } | { kind: "not_acquired" } | { kind: "heartbeat_lost" }
> {
  const acquired = await tryAcquireEmployeeScheduledPayoutProcessingClaim(ledgerId, correlationId);
  if (!acquired.acquired || !acquired.claimToken) return { kind: "not_acquired" };
  const claimToken = acquired.claimToken;
  const heart = await executeScheduledPayoutClaimHeartbeatWork(
    ledgerId,
    claimToken,
    renewEmployeeScheduledPayoutProcessingClaim,
    releaseEmployeeScheduledPayoutProcessingClaim,
    fn,
  );
  if (heart.kind === "heartbeat_lost") return { kind: "heartbeat_lost" };
  return { kind: "ok", value: heart.value };
}

export async function runWithBusinessScheduledPayoutClaimHeartbeat<T>(
  ledgerId: string,
  correlationId: string,
  fn: (handle: ScheduledPayoutClaimHandle) => Promise<T>,
): Promise<
  { kind: "ok"; value: T } | { kind: "not_acquired" } | { kind: "heartbeat_lost" }
> {
  const acquired = await tryAcquireBusinessScheduledPayoutProcessingClaim(ledgerId, correlationId);
  if (!acquired.acquired || !acquired.claimToken) return { kind: "not_acquired" };
  const claimToken = acquired.claimToken;
  const heart = await executeScheduledPayoutClaimHeartbeatWork(
    ledgerId,
    claimToken,
    renewBusinessScheduledPayoutProcessingClaim,
    releaseBusinessScheduledPayoutProcessingClaim,
    fn,
  );
  if (heart.kind === "heartbeat_lost") return { kind: "heartbeat_lost" };
  return { kind: "ok", value: heart.value };
}
