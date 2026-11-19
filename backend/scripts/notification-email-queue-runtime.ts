/**
 * Durable notification email outbox against a disposable database. Resend is reached only
 * through the test seam. Clock and jitter are controlled.
 * Run: CARETIP_ISOLATED_POSTGRES_URL=postgresql://...@127.0.0.1:PORT/db node scripts/safe-test.mjs test:notification-email-queue
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/prisma.ts";
import {
  __setSendResendEmailOutcomeFnForTests,
  type ResendMailPayload,
  type ResendSendOutcome,
} from "../src/services/resendClient.ts";
import {
  DELIVERY_WINDOW_MS,
  __setNotificationQueueClockForTests,
  __setNotificationQueueRandomForTests,
  enqueueNotificationEmail,
  getNotificationEmailQueueHealth,
  processNotificationEmailDelivery,
  retryDelayMs,
  runNotificationEmailDeliveryTick,
} from "../src/services/notifications/notificationEmailQueue.service.ts";
import {
  __setNotificationQueueKickForTests,
  queueLocalizedUserNotificationEmail,
  renderLocalizedUserNotificationEmail,
} from "../src/services/localizedNotificationEmail.service.ts";
import { deliverUserNotification } from "../src/services/notifications/notificationOrchestrator.service.ts";
import { employeeTipEmailRequest } from "../src/services/notifications/employeeTipNotificationPrefs.ts";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}
process.env.FRONTEND_URL = "https://caretip.example";
console.info = () => {};
console.warn = () => {};
const realError = console.error;
console.error = () => {};

const MIN = 60_000;
let clock = Date.parse("2026-11-19T10:00:00.000Z");
__setNotificationQueueClockForTests(() => clock);
let jitter = 0.5;
__setNotificationQueueRandomForTests(() => jitter);
__setNotificationQueueKickForTests(() => undefined); // tests drive processing explicitly

const sends: ResendMailPayload[] = [];
let outcomes: ResendSendOutcome[] = [];
__setSendResendEmailOutcomeFnForTests(async (_tag, payload) => {
  sends.push(payload);
  return outcomes.length > 1 ? outcomes.shift()! : (outcomes[0] ?? { kind: "sent", messageId: "m" });
});

const tag = `q-${Date.now()}`;
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, role: "MANAGER", preferredLocale: "de" } });

type Row = {
  status: string;
  attempt_count: number;
  next_attempt_at: Date;
  last_error_kind: string | null;
  provider_message_id: string | null;
  idempotency_key: string;
};
async function row(id: string): Promise<Row> {
  const r = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT status::text AS status, attempt_count, next_attempt_at, last_error_kind, provider_message_id, idempotency_key
    FROM notification_email_deliveries WHERE id = ${id}`);
  return r[0]!;
}
let seq = 0;
async function enqueue(extra: Partial<Parameters<typeof enqueueNotificationEmail>[0]> = {}) {
  seq += 1;
  return enqueueNotificationEmail({
    idempotencyKey: `${tag}:${seq}`,
    userId: user.id,
    kind: "test",
    to: user.email,
    subject: `Subject ${seq}`,
    html: `<p>Body ${seq}</p>`,
    text: `Body ${seq}`,
    ...extra,
  });
}
async function clearDue() {
  // Park other tests' rows so each check only sees its own.
  await prisma.$executeRaw(Prisma.sql`UPDATE notification_email_deliveries SET status = 'cancelled' WHERE status IN ('pending','retry_scheduled','processing')`);
}

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await clearDue();
    sends.length = 0;
    outcomes = [];
    jitter = 0.5;
    await fn();
    passed += 1;
  } catch (err) {
    console.error = realError;
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

try {
  await check("enqueue persists a pending row; the same key never creates a second", async () => {
    const a = await enqueue({ idempotencyKey: `${tag}:dup` });
    const b = await enqueue({ idempotencyKey: `${tag}:dup` });
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.id, b.id);
    assert.equal((await row(a.id)).status, "pending");
  });

  await check("success is recorded with the provider message id", async () => {
    const { id } = await enqueue();
    outcomes = [{ kind: "sent", messageId: "msg_1" }];
    assert.equal(await processNotificationEmailDelivery(id), "delivered");
    const r = await row(id);
    assert.equal(r.status, "delivered");
    assert.equal(r.provider_message_id, "msg_1");
    assert.equal(sends[0].idempotencyKey, r.idempotency_key);
  });

  await check("5xx, 429 and network failures are retried with the same key; backoff grows", async () => {
    const { id } = await enqueue();
    outcomes = [
      { kind: "retryable", httpStatus: 503 },
      { kind: "retryable", httpStatus: 429, retryAfterMs: 5 * MIN },
      { kind: "retryable" },
      { kind: "sent", messageId: "late" },
    ];
    assert.equal(await processNotificationEmailDelivery(id), "retry_scheduled");
    let r = await row(id);
    assert.equal(r.last_error_kind, "provider_error");
    assert.equal(r.next_attempt_at.getTime() - clock, retryDelayMs(1)); // 45s with jitter 0.5
    assert.equal((await runNotificationEmailDeliveryTick()).claimed, 0, "not due yet");
    clock = r.next_attempt_at.getTime();
    await runNotificationEmailDeliveryTick();
    r = await row(id);
    assert.equal(r.last_error_kind, "rate_limited");
    assert.ok(r.next_attempt_at.getTime() - clock >= 5 * MIN, "Retry-After is a floor");
    clock = r.next_attempt_at.getTime();
    await runNotificationEmailDeliveryTick();
    r = await row(id);
    assert.equal(r.last_error_kind, "network");
    clock = r.next_attempt_at.getTime();
    await runNotificationEmailDeliveryTick();
    r = await row(id);
    assert.equal(r.status, "delivered");
    assert.equal(r.attempt_count, 4);
    assert.equal(new Set(sends.map((s) => s.idempotencyKey)).size, 1, "one key across all retries");
    assert.equal(new Set(sends.map((s) => s.html)).size, 1, "byte-identical payload across retries");
  });

  await check("exponential backoff with jitter spreads retries", async () => {
    jitter = 0;
    const lo = [1, 2, 3, 4].map((a) => retryDelayMs(a));
    jitter = 1;
    const hi = [1, 2, 3, 4].map((a) => retryDelayMs(a));
    assert.deepEqual(lo, [30_000, 60_000, 120_000, 240_000]);
    assert.deepEqual(hi, [60_000, 120_000, 240_000, 480_000]);
    jitter = 1;
    assert.equal(retryDelayMs(20), 60 * MIN, "capped at one hour");
  });

  await check("permanent rejections stop at once", async () => {
    const { id } = await enqueue();
    outcomes = [{ kind: "permanent", httpStatus: 422, errorCode: "validation_error" }];
    assert.equal(await processNotificationEmailDelivery(id), "failed");
    assert.equal((await row(id)).last_error_kind, "invalid_message");
    clock += 2 * 60 * MIN;
    assert.equal((await runNotificationEmailDeliveryTick()).claimed, 0);
    assert.equal(sends.length, 1);
  });

  await check("the attempt budget is respected", async () => {
    const { id } = await enqueue({ maxAttempts: 3 });
    outcomes = [{ kind: "retryable", httpStatus: 500 }];
    await processNotificationEmailDelivery(id);
    for (let i = 0; i < 4; i += 1) {
      clock += 2 * 60 * MIN;
      await runNotificationEmailDeliveryTick();
    }
    const r = await row(id);
    assert.equal(r.status, "failed");
    assert.equal(r.last_error_kind, "attempts_exhausted");
    assert.equal(sends.length, 3);
  });

  await check("a crashed worker's row is taken over after the lease and sent with the same key", async () => {
    const { id } = await enqueue();
    // Worker A claims and "crashes" mid-send: the row stays processing with a lease.
    await prisma.$executeRaw(Prisma.sql`
      UPDATE notification_email_deliveries
      SET status = 'processing', lease_owner = 'dead-worker', attempt_count = 1,
          lease_until = ${new Date(clock + 2 * MIN).toISOString()}::timestamptz AT TIME ZONE 'UTC'
      WHERE id = ${id}`);
    assert.equal((await runNotificationEmailDeliveryTick()).claimed, 0, "lease still valid");
    clock += 3 * MIN;
    const t = await runNotificationEmailDeliveryTick();
    assert.equal(t.claimed, 1);
    const r = await row(id);
    assert.equal(r.status, "delivered");
    assert.equal(sends[0].idempotencyKey, r.idempotency_key, "same key, so Resend drops a repeat");
  });

  await check("a worker that lost its lease cannot overwrite the newer result", async () => {
    const { id } = await enqueue();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    __setSendResendEmailOutcomeFnForTests(async (_t, p) => {
      sends.push(p);
      if (first) {
        first = false;
        await gate; // worker A hangs past its lease
        return { kind: "retryable", httpStatus: 503 };
      }
      return { kind: "sent", messageId: "from-B" };
    });
    const slow = processNotificationEmailDelivery(id);
    await new Promise((r) => setTimeout(r, 100));
    clock += 3 * MIN;
    // Worker B (simulated by stealing the lease) takes the row over and delivers.
    await prisma.$executeRaw(Prisma.sql`UPDATE notification_email_deliveries SET lease_owner = 'other' WHERE id = ${id}`);
    await prisma.$executeRaw(Prisma.sql`UPDATE notification_email_deliveries SET status='delivered', provider_message_id='from-B', lease_owner = NULL WHERE id = ${id}`);
    release();
    assert.equal(await slow, "lost_lease");
    const r = await row(id);
    assert.equal(r.status, "delivered");
    assert.equal(r.provider_message_id, "from-B");
    __setSendResendEmailOutcomeFnForTests(async (_tag, payload) => {
      sends.push(payload);
      return outcomes.length > 1 ? outcomes.shift()! : (outcomes[0] ?? { kind: "sent", messageId: "m" });
    });
  });

  await check("two workers racing for one row: exactly one claims it", async () => {
    const { id } = await enqueue();
    const results = await Promise.all([processNotificationEmailDelivery(id), processNotificationEmailDelivery(id)]);
    assert.deepEqual([...results].sort(), ["delivered", "not_claimed"]);
    assert.equal(sends.length, 1);
  });

  await check("rows stop retrying inside Resend's 24-hour idempotency window", async () => {
    const { id } = await enqueue();
    outcomes = [{ kind: "retryable", httpStatus: 503 }];
    await processNotificationEmailDelivery(id);
    clock += DELIVERY_WINDOW_MS + MIN;
    await runNotificationEmailDeliveryTick();
    const r = await row(id);
    assert.equal(r.status, "failed");
    assert.equal(r.last_error_kind, "expired_window");
    assert.equal(sends.length, 1, "no send after the window");
  });

  await check("a tick claims at most its limit, so a backlog is worked in bounded batches", async () => {
    for (let i = 0; i < 7; i += 1) await enqueue();
    const t = await runNotificationEmailDeliveryTick({ limit: 3 });
    assert.equal(t.claimed, 3);
    const health = await getNotificationEmailQueueHealth();
    assert.equal(health.pending, 4);
    assert.ok(health.deliveredLast24h >= 3);
  });

  await check("health reports backlog, retries and failures without content", async () => {
    const { id } = await enqueue();
    outcomes = [{ kind: "retryable", httpStatus: 503 }];
    await processNotificationEmailDelivery(id);
    const h = await getNotificationEmailQueueHealth();
    assert.equal(h.retryScheduled, 1);
    assert.ok(h.failedLast24h >= 1);
    assert.deepEqual(Object.keys(h).sort(), [
      "deliveredLast24h",
      "expiredLeases",
      "failedLast24h",
      "oldestDueAgeSeconds",
      "pending",
      "processing",
      "retryScheduled",
    ]);
  });

  await check("orchestrator: an email notification persists one delivery; a duplicate event adds none", async () => {
    const payload = {
      type: "system_alert" as const,
      title: "Hinweis",
      body: "Eine Testnachricht.",
      url: "/dashboard",
      metadata: { entityId: `${tag}-evt` },
    };
    const a = await deliverUserNotification({ userId: user.id, payload, channels: { in_app: true, push: false, email: true }, dedupeKey: `${tag}-evt` });
    const b = await deliverUserNotification({ userId: user.id, payload, channels: { in_app: true, push: false, email: true }, dedupeKey: `${tag}-evt` });
    assert.ok(a.notification && b.skipped);
    const rows = await prisma.$queryRaw<{ n: bigint; key: string }[]>(Prisma.sql`
      SELECT COUNT(*) AS n, MIN(idempotency_key) AS key FROM notification_email_deliveries
      WHERE notification_id = ${a.notification!.id}`);
    assert.equal(Number(rows[0].n), 1);
    assert.equal(rows[0].key, `notification-email:${a.notification!.id}`, "same key format as before");
  });

  await check("after the outbox has worked, a missing table never triggers a direct send", async () => {
    // Operating modes are covered in depth by notification-queue-modes-runtime.
    await prisma.$executeRawUnsafe(`ALTER TABLE notification_email_deliveries RENAME TO notification_email_deliveries_off`);
    try {
      const r = await queueLocalizedUserNotificationEmail({
        to: user.email,
        userId: user.id,
        preferredLocale: "en",
        title: "Fallback",
        bodyText: "Not sent directly.",
        idempotencyKey: `${tag}:fallback`,
        kind: "test",
      });
      assert.equal(r.mode, "not_queued");
      assert.equal(sends.length, 0);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE notification_email_deliveries_off RENAME TO notification_email_deliveries`);
    }
  });

  await check("protected German tip email: the queued payload equals the direct render byte for byte", async () => {
    const input = { to: user.email, preferredLocale: "de", ...employeeTipEmailRequest("de"), actionUrl: "/employee/tip-history" };
    const direct = await renderLocalizedUserNotificationEmail(input);
    const q = await queueLocalizedUserNotificationEmail({ ...input, userId: user.id, idempotencyKey: `${tag}:tip`, kind: "tip_received_employee" });
    assert.equal(q.mode, "queued");
    const stored = await prisma.$queryRaw<{ subject: string; html: string; text: string }[]>(Prisma.sql`
      SELECT subject, html, text FROM notification_email_deliveries WHERE idempotency_key = ${`${tag}:tip`}`);
    const dUser = await renderLocalizedUserNotificationEmail({ ...input, userId: user.id });
    assert.equal(stored[0].subject, direct!.subject);
    assert.equal(stored[0].subject, "Du hast ein neues Trinkgeld erhalten");
    assert.equal(stored[0].html, dUser!.html);
    assert.equal(stored[0].text, dUser!.text);
  });

  console.log(`notification-email-queue-runtime: ok (${passed} checks)`);
} finally {
  __setSendResendEmailOutcomeFnForTests(null);
  await prisma.$executeRaw(Prisma.sql`DELETE FROM notification_email_deliveries WHERE user_id = ${user.id}`).catch(() => undefined);
  await prisma.notification.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  await prisma.$disconnect();
}
