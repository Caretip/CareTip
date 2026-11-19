/**
 * Notification email outbox operating modes against a disposable database.
 * Optional real-outage check: set CARETIP_TEST_PG_CTL (path to pg_ctl) and CARETIP_TEST_PGDATA.
 * Run: CARETIP_ISOLATED_POSTGRES_URL=postgresql://...@127.0.0.1:PORT/db node scripts/safe-test.mjs test:notification-queue-modes
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/prisma.ts";
import { __setSendResendEmailOutcomeFnForTests, type ResendMailPayload } from "../src/services/resendClient.ts";
import {
  QUEUE_MIGRATION_NAME,
  __resetQueueModeForTests,
  runNotificationEmailDeliveryTick,
} from "../src/services/notifications/notificationEmailQueue.service.ts";
import {
  __setNotificationQueueKickForTests,
  queueLocalizedUserNotificationEmail,
} from "../src/services/localizedNotificationEmail.service.ts";
import {
  __setNotificationRepairClockForTests,
  repairMissingNotificationEmails,
} from "../src/services/notifications/notificationEmailRepair.service.ts";
import { deliverUserNotification } from "../src/services/notifications/notificationOrchestrator.service.ts";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}
process.env.FRONTEND_URL = "https://caretip.example";
console.info = () => {};
console.warn = () => {};
const realError = console.error;
console.error = () => {};

const sends: ResendMailPayload[] = [];
__setSendResendEmailOutcomeFnForTests(async (_t, p) => {
  sends.push(p);
  return { kind: "sent", messageId: "m" };
});
__setNotificationQueueKickForTests(() => undefined);

const tag = `qm${Date.now().toString(36)}`;
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, role: "MANAGER", preferredLocale: "en" } });
const input = (key: string) => ({
  to: user.email,
  userId: user.id,
  preferredLocale: "en",
  title: "Mode check",
  bodyText: "Testing the outbox mode.",
  idempotencyKey: key,
  kind: "test",
});
const off = () => prisma.$executeRawUnsafe(`ALTER TABLE notification_email_deliveries RENAME TO notification_email_deliveries_off`);
const on = () => prisma.$executeRawUnsafe(`ALTER TABLE notification_email_deliveries_off RENAME TO notification_email_deliveries`);
type MigRow = { id: string; checksum: string; finished_at: Date | null; migration_name: string; logs: string | null; rolled_back_at: Date | null; started_at: Date; applied_steps_count: number };
const migRow = (await prisma.$queryRaw<MigRow[]>(Prisma.sql`SELECT * FROM "_prisma_migrations" WHERE migration_name = ${QUEUE_MIGRATION_NAME}`))[0];
assert.ok(migRow, "queue migration must be applied in the disposable database");

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    sends.length = 0;
    __resetQueueModeForTests();
    await fn();
    passed += 1;
  } catch (err) {
    console.error = realError;
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

try {
  await check("pre-migration (no table, migration never applied): sends directly", async () => {
    await off();
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "_prisma_migrations" WHERE id = ${migRow.id}`);
    try {
      const r = await queueLocalizedUserNotificationEmail(input(`${tag}:pre`));
      assert.equal(r.mode, "direct");
      assert.equal(sends.length, 1);
    } finally {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        VALUES (${migRow.id}, ${migRow.checksum}, ${migRow.finished_at}, ${migRow.migration_name}, ${migRow.logs}, ${migRow.rolled_back_at}, ${migRow.started_at}, ${migRow.applied_steps_count})`);
      await on();
    }
  });

  await check("inconsistent (migration recorded, table missing): nothing is sent", async () => {
    await off();
    try {
      const r = await queueLocalizedUserNotificationEmail(input(`${tag}:inconsistent`));
      assert.deepEqual(r, { mode: "not_queued", reason: "queue_state_unknown" });
      assert.equal(sends.length, 0);
    } finally {
      await on();
    }
  });

  await check("durable mode: once the outbox worked, a later failure never sends directly", async () => {
    const ok = await queueLocalizedUserNotificationEmail(input(`${tag}:durable-1`));
    assert.equal(ok.mode, "queued");
    await off();
    try {
      const r = await queueLocalizedUserNotificationEmail(input(`${tag}:durable-2`));
      assert.deepEqual(r, { mode: "not_queued", reason: "durable_write_failed" });
      assert.equal(sends.length, 0);
    } finally {
      await on();
    }
  });

  await check("restart: the latch resets, and the first working write latches durable again", async () => {
    __resetQueueModeForTests();
    const r = await queueLocalizedUserNotificationEmail(input(`${tag}:restart`));
    assert.equal(r.mode, "queued");
    assert.equal(sends.length, 0, "queued, not sent directly (kick disabled in this test)");
  });

  await check("outbox failure keeps the in-app notification, and repair enqueues the email once", async () => {
    // Make the outbox look live for > 10 minutes so the repair window includes this notification.
    await prisma.$executeRaw(Prisma.sql`UPDATE "_prisma_migrations" SET finished_at = finished_at - interval '2 hours' WHERE id = ${migRow.id}`);
    await off();
    let notificationId = "";
    try {
      const res = await deliverUserNotification({
        userId: user.id,
        payload: { type: "system_alert", title: "Outage check", body: "This email must not be lost.", url: "/dashboard", metadata: { entityId: `${tag}-outage` } },
        channels: { in_app: true, push: false, email: true },
        dedupeKey: `${tag}-outage`,
      });
      assert.ok(res.notification, "in-app notification created despite the outbox failure");
      notificationId = res.notification!.id;
      assert.equal(sends.length, 0, "no direct send");
    } finally {
      await on();
    }
    __setNotificationRepairClockForTests(() => Date.now() + 5 * 60_000);
    const [a, b] = await Promise.all([repairMissingNotificationEmails(), repairMissingNotificationEmails()]);
    // Other suites may leave notifications the repair also picks up; the guarantee checked here is
    // about this notification: one delivery row and one send, however many repairs race.
    assert.ok(a.queued + b.queued >= 1, "the missing email was re-enqueued");
    const rows = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS n FROM notification_email_deliveries WHERE idempotency_key = ${`notification-email:${notificationId}`}`);
    assert.equal(Number(rows[0].n), 1);
    assert.equal((await repairMissingNotificationEmails()).queued, 0, "rerun finds nothing");
    await runNotificationEmailDeliveryTick({ limit: 50 });
    assert.equal(sends.filter((s) => s.idempotencyKey === `notification-email:${notificationId}`).length, 1, "delivered exactly once");
    __setNotificationRepairClockForTests(null);
  });

  await check("worker unavailable: deliveries wait durably and go out on the next tick", async () => {
    const r = await queueLocalizedUserNotificationEmail(input(`${tag}:waiting`));
    assert.equal(r.mode, "queued");
    assert.equal(sends.length, 0);
    await runNotificationEmailDeliveryTick({ limit: 50 });
    assert.ok(sends.some((s) => s.idempotencyKey === `${tag}:waiting`));
  });

  const pgCtl = process.env.CARETIP_TEST_PG_CTL?.trim();
  const pgData = process.env.CARETIP_TEST_PGDATA?.trim();
  if (pgCtl && pgData) {
    await check("real database outage: nothing sent while down; recovers afterwards", async () => {
      assert.equal((await queueLocalizedUserNotificationEmail(input(`${tag}:pre-outage`))).mode, "queued");
      spawnSync(pgCtl, ["-D", pgData, "-m", "fast", "stop"], { stdio: "ignore" });
      try {
        const r = await queueLocalizedUserNotificationEmail(input(`${tag}:during-outage`)).catch(() => ({ mode: "threw" as const }));
        assert.notEqual(r.mode, "direct", "a database outage must never trigger a direct send");
        assert.equal(sends.length, 0);
      } finally {
        spawnSync(pgCtl, ["-D", pgData, "-l", `${pgData}/../pg.log`, "-w", "start"], { stdio: "ignore" });
      }
      for (let i = 0; i < 20; i += 1) {
        try {
          await prisma.$queryRaw`SELECT 1`;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      // Pooled connections killed by the restart fail once each; a caller retrying gets through.
      let after: { mode: string } = { mode: "none" };
      for (let i = 0; i < 10 && after.mode !== "queued"; i += 1) {
        after = await queueLocalizedUserNotificationEmail(input(`${tag}:after-outage`)).catch(() => ({ mode: "threw" }));
        if (after.mode !== "queued") await new Promise((r) => setTimeout(r, 300));
      }
      assert.equal(after.mode, "queued", "the outbox works again after the database returns");
      assert.equal(sends.length, 0, "still no direct send");
    });
  } else {
    console.info = console.log;
    console.log("SKIP: real database outage (set CARETIP_TEST_PG_CTL and CARETIP_TEST_PGDATA)");
  }

  console.error = realError;
  console.log(`notification-queue-modes-runtime: ok (${passed} checks)`);
} finally {
  __setSendResendEmailOutcomeFnForTests(null);
  await prisma.$executeRaw(Prisma.sql`UPDATE "_prisma_migrations" SET finished_at = ${migRow.finished_at} WHERE id = ${migRow.id}`).catch(() => undefined);
  await prisma.$executeRaw(Prisma.sql`DELETE FROM notification_email_deliveries WHERE user_id = ${user.id}`).catch(() => undefined);
  await prisma.notification.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  await prisma.$disconnect();
}
