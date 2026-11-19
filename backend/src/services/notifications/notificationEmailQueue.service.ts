/**
 * Durable outbox for notification emails (`notification_email_deliveries`).
 *
 * Guarantee: at least one send attempt per logical email, retried with backoff until Resend
 * accepts it, a permanent error is returned, or the attempt budget runs out. Every row stores the
 * fully rendered message and a stable idempotency key, so a retry after an uncertain outcome
 * (crash or timeout after Resend accepted) sends the same bytes with the same key and Resend
 * answers with the original result instead of delivering again. Resend keeps keys for 24 hours,
 * so rows stop retrying after DELIVERY_WINDOW_MS. Exactly-once is NOT claimed: an outcome that
 * stays uncertain past that window could still produce a repeat.
 *
 * Concurrency: rows are claimed with `FOR UPDATE SKIP LOCKED` and a lease, so any number of
 * workers on any instance never process the same row at once. A worker that dies leaves its lease
 * to expire; the next claim takes the row over. Results are written only while the writer still
 * holds the lease, so a slow worker cannot overwrite a newer outcome.
 *
 * Raw SQL is used on purpose: the claim needs SKIP LOCKED, and timestamps go through
 * sqlUtcTimestamp() like the other financial queries (columns are timestamp without time zone).
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { sqlUtcTimestamp } from "../../utils/sqlUtcTimestamp.js";
import {
  getResendFromAddress,
  sendResendEmailWithOutcome,
  type ResendSendOutcome,
} from "../resendClient.js";

export const DEFAULT_MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
const LEASE_MS = 2 * 60_000;
/** Inside Resend's 24-hour idempotency window, with margin. */
export const DELIVERY_WINDOW_MS = 23 * 60 * 60_000;
const RETENTION_MS = 30 * 24 * 60 * 60_000;

export type DeliveryErrorKind =
  | "rate_limited"
  | "provider_error"
  | "network"
  | "provider_auth"
  | "not_configured"
  | "idempotency_in_flight"
  | "invalid_message"
  | "rejected"
  | "expired_window"
  | "attempts_exhausted";

/* ---------------- test seams ---------------- */

let clockForTests: (() => number) | null = null;
let randomForTests: (() => number) | null = null;
const workerId = `w-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;

export function __setNotificationQueueClockForTests(fn: (() => number) | null): void {
  clockForTests = fn;
}
export function __setNotificationQueueRandomForTests(fn: (() => number) | null): void {
  randomForTests = fn;
}

function now(): Date {
  return new Date(clockForTests ? clockForTests() : Date.now());
}

/* ---------------- retry policy ---------------- */

/**
 * Exponential backoff with equal jitter: half the step is fixed, half random, so a burst of
 * failures spreads out instead of retrying in lockstep. Retry-After from Resend is a floor.
 */
export function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  const step = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1));
  const rand = randomForTests ? randomForTests() : Math.random();
  const jittered = step / 2 + rand * (step / 2);
  return Math.round(Math.max(jittered, retryAfterMs ?? 0));
}

export function classifyOutcome(
  outcome: ResendSendOutcome,
): { result: "sent" } | { result: "retry" | "fail"; kind: DeliveryErrorKind; httpStatus?: number; retryAfterMs?: number } {
  if (outcome.kind === "sent") return { result: "sent" };
  if (outcome.kind === "not_configured") return { result: "retry", kind: "not_configured" };
  const status = outcome.httpStatus;
  const code = outcome.errorCode ?? "";
  if (outcome.kind === "retryable") {
    if (status === 429) return { result: "retry", kind: "rate_limited", httpStatus: status, retryAfterMs: outcome.retryAfterMs };
    if (status && status >= 500) return { result: "retry", kind: "provider_error", httpStatus: status };
    return { result: "retry", kind: "network", httpStatus: status };
  }
  // Permanent per the adapter. Two cases are worth retrying in the queue:
  if (status === 401 || status === 403) return { result: "retry", kind: "provider_auth", httpStatus: status };
  if (status === 409 && /concurrent/i.test(code)) {
    return { result: "retry", kind: "idempotency_in_flight", httpStatus: status };
  }
  if (status === 422 || /validation/i.test(code)) return { result: "fail", kind: "invalid_message", httpStatus: status };
  return { result: "fail", kind: "rejected", httpStatus: status };
}

/* ---------------- enqueue ---------------- */

export type EnqueueNotificationEmailInput = {
  idempotencyKey: string;
  userId: string;
  businessId?: string | null;
  notificationId?: string | null;
  kind: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  maxAttempts?: number;
};

/**
 * Persist one logical email. A repeated key returns the existing row and creates nothing, so a
 * duplicate event never produces a second email. Throws if the database is unavailable; callers
 * then fall back to a direct send.
 */
export async function enqueueNotificationEmail(
  input: EnqueueNotificationEmailInput,
): Promise<{ id: string; created: boolean }> {
  const key = input.idempotencyKey.trim().slice(0, 191);
  if (!key) throw new Error("idempotencyKey is required");
  const at = now();
  const id = `ned_${crypto.randomBytes(12).toString("hex")}`;
  const rows = await prisma.$queryRaw<{ id: string; created: boolean }[]>(Prisma.sql`
    INSERT INTO "notification_email_deliveries"
      ("id", "idempotency_key", "user_id", "business_id", "notification_id", "kind", "to_email",
       "subject", "html", "text", "status", "attempt_count", "max_attempts", "next_attempt_at",
       "created_at", "updated_at")
    VALUES
      (${id}, ${key}, ${input.userId}, ${input.businessId ?? null}, ${input.notificationId ?? null},
       ${input.kind.slice(0, 64)}, ${input.to.trim().toLowerCase().slice(0, 320)},
       ${input.subject.slice(0, 512)}, ${input.html}, ${input.text}, 'pending', 0,
       ${Math.max(1, Math.min(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 20))},
       ${sqlUtcTimestamp(at)}, ${sqlUtcTimestamp(at)}, ${sqlUtcTimestamp(at)})
    ON CONFLICT ("idempotency_key") DO NOTHING
    RETURNING "id", true AS "created"
  `);
  if (rows[0]) return rows[0];
  const existing = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "notification_email_deliveries" WHERE "idempotency_key" = ${key} LIMIT 1
  `);
  if (!existing[0]) throw new Error("delivery row vanished after conflict");
  return { id: existing[0].id, created: false };
}

/* ---------------- claim and process ---------------- */

type ClaimedRow = {
  id: string;
  idempotency_key: string;
  to_email: string;
  subject: string;
  html: string;
  text: string;
  kind: string;
  attempt_count: number;
  max_attempts: number;
  created_at: Date;
};

async function claim(limit: number, onlyId?: string): Promise<ClaimedRow[]> {
  const at = now();
  const leaseUntil = new Date(at.getTime() + LEASE_MS);
  const target = onlyId ? Prisma.sql`AND "id" = ${onlyId}` : Prisma.empty;
  // The rows are picked once in a CTE and updated by join. `WHERE id IN (SELECT ... LIMIT n
  // FOR UPDATE SKIP LOCKED)` is not safe: Postgres may evaluate that subquery more than once
  // and claim more than `limit` rows.
  return prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
    WITH picked AS (
      SELECT "id" FROM "notification_email_deliveries"
      WHERE (
        ("status" IN ('pending', 'retry_scheduled') AND "next_attempt_at" <= ${sqlUtcTimestamp(at)})
        OR ("status" = 'processing' AND "lease_until" < ${sqlUtcTimestamp(at)})
      ) ${target}
      ORDER BY "next_attempt_at" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "notification_email_deliveries" AS d
    SET "status" = 'processing',
        "lease_owner" = ${workerId},
        "lease_until" = ${sqlUtcTimestamp(leaseUntil)},
        "attempt_count" = d."attempt_count" + 1,
        "last_attempt_at" = ${sqlUtcTimestamp(at)},
        "updated_at" = ${sqlUtcTimestamp(at)}
    FROM picked
    WHERE d."id" = picked."id"
    RETURNING d."id", d."idempotency_key", d."to_email", d."subject", d."html", d."text", d."kind",
              d."attempt_count", d."max_attempts", d."created_at"
  `);
}

/** Write a result only while this worker still owns the lease. */
async function finish(
  row: ClaimedRow,
  update: { status: "delivered" | "retry_scheduled" | "failed"; nextAttemptAt?: Date; kind?: DeliveryErrorKind; httpStatus?: number; messageId?: string },
): Promise<boolean> {
  const at = now();
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE "notification_email_deliveries"
    SET "status" = ${update.status}::"NotificationEmailDeliveryStatus",
        "lease_owner" = NULL,
        "lease_until" = NULL,
        "next_attempt_at" = ${sqlUtcTimestamp(update.nextAttemptAt ?? at)},
        "last_error_kind" = ${update.kind ?? null},
        "last_http_status" = ${update.httpStatus ?? null},
        "provider_message_id" = COALESCE(${update.messageId ?? null}, "provider_message_id"),
        "delivered_at" = ${update.status === "delivered" ? sqlUtcTimestamp(at) : Prisma.sql`"delivered_at"`},
        "failed_at" = ${update.status === "failed" ? sqlUtcTimestamp(at) : Prisma.sql`"failed_at"`},
        "updated_at" = ${sqlUtcTimestamp(at)}
    WHERE "id" = ${row.id} AND "lease_owner" = ${workerId} AND "status" = 'processing'
  `);
  if (n === 0) {
    console.warn("[notificationQueue] result not written: lease was taken over", { deliveryId: row.id });
  }
  return n > 0;
}

export type ProcessedResult = "delivered" | "retry_scheduled" | "failed" | "lost_lease";

async function processClaimed(row: ClaimedRow): Promise<ProcessedResult> {
  const at = now();
  if (at.getTime() - new Date(row.created_at).getTime() > DELIVERY_WINDOW_MS) {
    await finish(row, { status: "failed", kind: "expired_window" });
    console.error("[notificationQueue] delivery expired before Resend accepted it", { deliveryId: row.id, kind: row.kind });
    return "failed";
  }
  if (row.attempt_count > row.max_attempts) {
    await finish(row, { status: "failed", kind: "attempts_exhausted" });
    return "failed";
  }

  let outcome: ResendSendOutcome;
  try {
    outcome = await sendResendEmailWithOutcome(`queue:${row.kind}`, {
      from: getResendFromAddress(),
      to: [row.to_email],
      subject: row.subject,
      html: row.html,
      text: row.text,
      idempotencyKey: row.idempotency_key,
    });
  } catch {
    outcome = { kind: "retryable" };
  }

  const c = classifyOutcome(outcome);
  if (c.result === "sent") {
    const ok = await finish(row, { status: "delivered", messageId: outcome.kind === "sent" ? outcome.messageId : undefined });
    return ok ? "delivered" : "lost_lease";
  }
  if (c.result === "retry" && row.attempt_count < row.max_attempts) {
    const next = new Date(at.getTime() + retryDelayMs(row.attempt_count, c.retryAfterMs));
    const ok = await finish(row, { status: "retry_scheduled", nextAttemptAt: next, kind: c.kind, httpStatus: c.httpStatus });
    console.warn("[notificationQueue] delivery will be retried", {
      deliveryId: row.id,
      kind: row.kind,
      attempt: row.attempt_count,
      error: c.kind,
      retryInSec: Math.round((next.getTime() - at.getTime()) / 1000),
    });
    return ok ? "retry_scheduled" : "lost_lease";
  }
  const finalKind: DeliveryErrorKind = c.result === "retry" ? "attempts_exhausted" : c.kind;
  const ok = await finish(row, { status: "failed", kind: finalKind, httpStatus: c.httpStatus });
  console.error("[notificationQueue] delivery failed permanently", {
    deliveryId: row.id,
    kind: row.kind,
    attempts: row.attempt_count,
    error: finalKind,
    lastError: c.kind,
  });
  return ok ? "failed" : "lost_lease";
}

/** Try one row right away (used straight after enqueue). Does nothing if another worker has it. */
export async function processNotificationEmailDelivery(id: string): Promise<ProcessedResult | "not_claimed"> {
  const rows = await claim(1, id);
  if (!rows[0]) return "not_claimed";
  return processClaimed(rows[0]);
}

export type DeliveryTickResult = {
  claimed: number;
  delivered: number;
  retryScheduled: number;
  failed: number;
  lostLease: number;
  pruned: number;
};

let tickInFlight: Promise<DeliveryTickResult> | null = null;

/** Claim and process due rows. Overlapping calls in one process share a single run. */
export function runNotificationEmailDeliveryTick(opts?: { limit?: number }): Promise<DeliveryTickResult> {
  if (tickInFlight) return tickInFlight;
  tickInFlight = (async () => {
    const result: DeliveryTickResult = { claimed: 0, delivered: 0, retryScheduled: 0, failed: 0, lostLease: 0, pruned: 0 };
    const rows = await claim(Math.max(1, Math.min(opts?.limit ?? 25, 100)));
    result.claimed = rows.length;
    for (const row of rows) {
      const r = await processClaimed(row);
      if (r === "delivered") result.delivered += 1;
      else if (r === "retry_scheduled") result.retryScheduled += 1;
      else if (r === "failed") result.failed += 1;
      else result.lostLease += 1;
    }
    result.pruned = await pruneFinishedDeliveries();
    if (result.claimed > 0) console.info("[notificationQueue] tick", result);
    return result;
  })().finally(() => {
    tickInFlight = null;
  });
  return tickInFlight;
}

/** Finished rows hold personal data (address, message); keep them 30 days for support, then drop. */
async function pruneFinishedDeliveries(limit = 500): Promise<number> {
  const cutoff = new Date(now().getTime() - RETENTION_MS);
  return prisma.$executeRaw(Prisma.sql`
    DELETE FROM "notification_email_deliveries"
    WHERE "id" IN (
      SELECT "id" FROM "notification_email_deliveries"
      WHERE "status" IN ('delivered', 'failed', 'cancelled') AND "updated_at" < ${sqlUtcTimestamp(cutoff)}
      LIMIT ${limit}
    )
  `);
}

/* ---------------- operational visibility ---------------- */

export type NotificationEmailQueueHealth = {
  pending: number;
  retryScheduled: number;
  processing: number;
  expiredLeases: number;
  failedLast24h: number;
  deliveredLast24h: number;
  oldestDueAgeSeconds: number | null;
};

/** Counts only: no addresses, subjects or message bodies. */
export async function getNotificationEmailQueueHealth(): Promise<NotificationEmailQueueHealth> {
  const at = now();
  const dayAgo = new Date(at.getTime() - 24 * 60 * 60_000);
  const rows = await prisma.$queryRaw<
    {
      pending: bigint;
      retry_scheduled: bigint;
      processing: bigint;
      expired_leases: bigint;
      failed_24h: bigint;
      delivered_24h: bigint;
      oldest_due: Date | null;
    }[]
  >(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE "status" = 'pending') AS pending,
      COUNT(*) FILTER (WHERE "status" = 'retry_scheduled') AS retry_scheduled,
      COUNT(*) FILTER (WHERE "status" = 'processing') AS processing,
      COUNT(*) FILTER (WHERE "status" = 'processing' AND "lease_until" < ${sqlUtcTimestamp(at)}) AS expired_leases,
      COUNT(*) FILTER (WHERE "status" = 'failed' AND "failed_at" >= ${sqlUtcTimestamp(dayAgo)}) AS failed_24h,
      COUNT(*) FILTER (WHERE "status" = 'delivered' AND "delivered_at" >= ${sqlUtcTimestamp(dayAgo)}) AS delivered_24h,
      MIN("next_attempt_at") FILTER (
        WHERE "status" IN ('pending', 'retry_scheduled') AND "next_attempt_at" <= ${sqlUtcTimestamp(at)}
      ) AS oldest_due
    FROM "notification_email_deliveries"
    WHERE "status" IN ('pending', 'retry_scheduled', 'processing')
       OR "updated_at" >= ${sqlUtcTimestamp(dayAgo)}
  `);
  const r = rows[0];
  const oldest = r?.oldest_due ? new Date(r.oldest_due) : null;
  return {
    pending: Number(r?.pending ?? 0),
    retryScheduled: Number(r?.retry_scheduled ?? 0),
    processing: Number(r?.processing ?? 0),
    expiredLeases: Number(r?.expired_leases ?? 0),
    failedLast24h: Number(r?.failed_24h ?? 0),
    deliveredLast24h: Number(r?.delivered_24h ?? 0),
    oldestDueAgeSeconds: oldest ? Math.max(0, Math.round((at.getTime() - oldest.getTime()) / 1000)) : null,
  };
}

/** The table is missing until the migration runs (e.g. a dev server on an unmigrated database). */
export function isQueueTableMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /notification_email_deliveries/.test(msg) && /does not exist|42P01/i.test(msg);
}

/* ---------------- Queue operating mode ---------------- */

export const QUEUE_MIGRATION_NAME = "20261119120000_notification_email_deliveries";

export type QueueMode = "durable" | "pre_migration" | "unknown";

let durableLatched = false;

/** Called after any successful outbox write: from then on this process never sends directly. */
export function markQueueDurable(): void {
  durableLatched = true;
}

/** Test seam: forget the latch (simulates a process restart). */
export function __resetQueueModeForTests(): void {
  durableLatched = false;
}

/**
 * Decide what an outbox write failure means. Direct sending is allowed only in an intentional
 * pre-migration state: the table is missing AND the migration has never been applied. Anything
 * else (database down, migration recorded but table missing, the outbox already worked in this
 * process) is not a reason to bypass the queue.
 */
export async function resolveQueueModeAfterFailure(err: unknown): Promise<QueueMode> {
  if (durableLatched) return "durable";
  if (!isQueueTableMissingError(err)) return "unknown";
  try {
    const rows = await prisma.$queryRaw<{ applied: boolean }[]>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE "migration_name" = ${QUEUE_MIGRATION_NAME} AND "rolled_back_at" IS NULL
      ) AS applied
    `);
    return rows[0]?.applied ? "unknown" : "pre_migration";
  } catch {
    return "unknown";
  }
}

/** When the queue migration finished, or null if it has not been applied. */
export async function queueMigrationFinishedAt(): Promise<Date | null> {
  const rows = await prisma.$queryRaw<{ finished_at: Date | null }[]>(Prisma.sql`
    SELECT "finished_at" FROM "_prisma_migrations"
    WHERE "migration_name" = ${QUEUE_MIGRATION_NAME} AND "rolled_back_at" IS NULL AND "finished_at" IS NOT NULL
    ORDER BY "finished_at" DESC LIMIT 1
  `);
  return rows[0]?.finished_at ? new Date(rows[0].finished_at) : null;
}
