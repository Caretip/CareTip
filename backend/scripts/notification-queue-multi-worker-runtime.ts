/**
 * Two worker processes drain one outbox at the same time: every row is sent exactly once.
 * Run: CARETIP_ISOLATED_POSTGRES_URL=postgresql://...@127.0.0.1:PORT/db node scripts/safe-test.mjs test:notification-queue-multi-worker
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/prisma.ts";
import { __setSendResendEmailOutcomeFnForTests } from "../src/services/resendClient.ts";
import {
  enqueueNotificationEmail,
  runNotificationEmailDeliveryTick,
} from "../src/services/notifications/notificationEmailQueue.service.ts";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}
console.info = () => {};

const role = process.argv[2];

if (role === "child") {
  const log = process.argv[3]!;
  __setSendResendEmailOutcomeFnForTests(async (_t, p) => {
    appendFileSync(log, `${process.pid} ${p.idempotencyKey}\n`);
    await new Promise((r) => setTimeout(r, 15)); // a real request takes time
    return { kind: "sent", messageId: `m-${p.idempotencyKey}` };
  });
  for (let i = 0; i < 40; i += 1) {
    const t = await runNotificationEmailDeliveryTick({ limit: 4 });
    if (t.claimed === 0) break;
  }
  await prisma.$disconnect();
  process.exit(0);
}

const N = 40;
const tag = `mw-${Date.now()}`;
const dir = mkdtempSync(path.join(tmpdir(), "caretip-mw-"));
const log = path.join(dir, "sends.log");
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, role: "MANAGER" } });
try {
  await prisma.$executeRaw(Prisma.sql`UPDATE notification_email_deliveries SET status = 'cancelled' WHERE status IN ('pending','retry_scheduled','processing')`);
  for (let i = 0; i < N; i += 1) {
    await enqueueNotificationEmail({
      idempotencyKey: `${tag}:${i}`,
      userId: user.id,
      kind: "test",
      to: user.email,
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
  }
  const self = fileURLToPath(import.meta.url);
  const tsx = path.resolve(path.dirname(self), "../node_modules/tsx/dist/cli.mjs");
  const run = () =>
    new Promise<number>((resolve) => {
      const c = spawn(process.execPath, [tsx, self, "child", log], { env: process.env, stdio: "inherit" });
      c.on("exit", (code) => resolve(code ?? 1));
    });
  const codes = await Promise.all([run(), run()]);
  assert.deepEqual(codes, [0, 0]);

  const lines = readFileSync(log, "utf8").trim().split("\n");
  const keys = lines.map((l) => l.split(" ")[1]);
  const pids = new Set(lines.map((l) => l.split(" ")[0]));
  assert.equal(keys.length, N, "every row sent once");
  assert.equal(new Set(keys).size, N, "no row sent twice");
  assert.equal(pids.size, 2, "both processes did work");
  const delivered = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS n FROM notification_email_deliveries WHERE user_id = ${user.id} AND status = 'delivered'`);
  assert.equal(Number(delivered[0].n), N);
  console.log(`notification-queue-multi-worker-runtime: ok (${N} rows, 2 processes, ${[...pids].length} workers, 0 duplicates)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
  await prisma.$executeRaw(Prisma.sql`DELETE FROM notification_email_deliveries WHERE user_id = ${user.id}`).catch(() => undefined);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  await prisma.$disconnect();
}
