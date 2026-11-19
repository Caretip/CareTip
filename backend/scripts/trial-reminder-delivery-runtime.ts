/**
 * Trial reminder delivery: a reminder is recorded only when Resend accepts it, and concurrent
 * job runs send it once. Needs a disposable database; Resend is reached only through the test seam.
 * Run: CARETIP_ISOLATED_POSTGRES_URL=postgresql://...@127.0.0.1:PORT/db node scripts/safe-test.mjs test:trial-reminder-delivery
 */
import assert from "node:assert/strict";
import { Prisma, SubscriptionPlanKey, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../src/prisma.ts";
import {
  __setSendResendEmailOutcomeFnForTests,
  type ResendMailPayload,
  type ResendSendOutcome,
} from "../src/services/resendClient.ts";
import {
  __setNotificationEmailRetryDelayForTests,
  __setNotificationQueueKickForTests,
} from "../src/services/localizedNotificationEmail.service.ts";
import {
  __setNotificationQueueClockForTests,
  processNotificationEmailDelivery,
  runNotificationEmailDeliveryTick,
} from "../src/services/notifications/notificationEmailQueue.service.ts";
import { runTrialReminderEmails } from "../src/services/trialReminderEmail.service.ts";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}

process.env.FRONTEND_URL = "https://caretip.example";
process.env.SUBSCRIPTION_TRIAL_ENABLED = "true";
__setNotificationEmailRetryDelayForTests(() => 0);
let queueClock = Date.now();
__setNotificationQueueClockForTests(() => queueClock);
console.info = () => {};
console.warn = () => {};

const tag = `trial-rem-${Date.now()}`;
const sends: ResendMailPayload[] = [];
let outcome: () => Promise<ResendSendOutcome> = async () => ({ kind: "sent", messageId: "m" });
__setSendResendEmailOutcomeFnForTests(async (_tag, payload) => {
  sends.push(payload);
  return outcome();
});

const user = await prisma.user.create({
  data: { email: `${tag}@example.test`, role: "MANAGER", preferredLocale: "de" },
});
const business = await prisma.business.create({
  data: { name: "Café Testphase", slug: tag, userId: user.id },
});
// ceil((3 days - 1 hour) / 1 day) = 3, so the 3-day reminder is due.
const sub = await prisma.subscription.create({
  data: {
    businessId: business.id,
    planKey: SubscriptionPlanKey.premium,
    status: SubscriptionStatus.trialing,
    trialEndsAt: new Date(Date.now() + 3 * 86_400_000 - 3_600_000),
    cancelAtPeriodEnd: false,
  },
});

async function reminderState() {
  const row = await prisma.subscription.findUnique({ where: { id: sub.id }, select: { trialReminderSent: true } });
  return row?.trialReminderSent as Record<string, string> | null;
}

const ours = () => sends.filter((p) => p.to[0] === user.email);

try {
  const kicked: string[] = [];
  __setNotificationQueueKickForTests((id) => kicked.push(id));
  const key = `trial-reminder:${sub.id}:3`;
  const deliveryRows = () =>
    prisma.$queryRaw<{ id: string; status: string; next_attempt_at: Date }[]>(Prisma.sql`
      SELECT id, status::text AS status, next_attempt_at FROM notification_email_deliveries WHERE idempotency_key = ${key}`);

  // 1. Resend is down on reminder day: the reminder is queued durably, not lost.
  outcome = async () => ({ kind: "retryable", httpStatus: 503 });
  await runTrialReminderEmails();
  assert.ok((await reminderState())?.["3"], "reminder recorded once it is in the outbox");
  let rows = await deliveryRows();
  assert.equal(rows.length, 1, "one durable delivery");
  assert.equal(kicked.length, 1);
  assert.equal(await processNotificationEmailDelivery(kicked[0]), "retry_scheduled");
  assert.equal(ours().length, 1);
  assert.equal(ours()[0].idempotencyKey, key, "same idempotency key as before the queue");

  // A rerun of the daily job adds nothing.
  await runTrialReminderEmails();
  assert.equal((await deliveryRows()).length, 1);
  assert.equal(kicked.length, 1);

  // 2. Resend recovers: the queue worker delivers it (German copy, billing link), once.
  rows = await deliveryRows();
  queueClock = rows[0].next_attempt_at.getTime() + 1000;
  outcome = async () => ({ kind: "sent", messageId: "m-ok" });
  await runNotificationEmailDeliveryTick();
  rows = await deliveryRows();
  assert.equal(rows[0].status, "delivered");
  assert.equal(ours().length, 2);
  assert.equal(new Set(ours().map((p) => p.idempotencyKey)).size, 1);
  assert.equal(ours()[1].subject, "Ihre CareTip-Testphase endet in 3 Tagen");
  assert.ok(ours()[1].html.includes('href="https://caretip.example/dashboard/billing/subscription"'));
  assert.match(ours()[1].html, />Abrechnung öffnen</);

  // 3. Already sent: no second email.
  sends.length = 0;
  await runTrialReminderEmails();
  await runNotificationEmailDeliveryTick();
  assert.equal(ours().length, 0);

  // 4. Two runs at once: one delivery, one email.
  await prisma.$executeRaw(Prisma.sql`DELETE FROM notification_email_deliveries WHERE idempotency_key = ${key}`);
  await prisma.subscription.update({ where: { id: sub.id }, data: { trialReminderSent: { "7": "2026-01-01T00:00:00.000Z" } } });
  sends.length = 0;
  kicked.length = 0;
  await Promise.all([runTrialReminderEmails(), runTrialReminderEmails()]);
  assert.equal((await deliveryRows()).length, 1, "concurrent runs must queue once");
  assert.equal(kicked.length, 1);
  await processNotificationEmailDelivery(kicked[0]);
  assert.equal(ours().length, 1, "concurrent runs must send once");
  const state = await reminderState();
  assert.equal(state?.["7"], "2026-01-01T00:00:00.000Z", "earlier reminders are kept");
  assert.ok(state?.["3"]);

  // 5. Outbox unavailable after the migration: nothing is sent directly, and the reminder claim is
  //    released so the next run tries again (pre-migration direct sending is covered by
  //    notification-queue-modes-runtime).
  await prisma.$executeRaw(Prisma.sql`DELETE FROM notification_email_deliveries WHERE idempotency_key = ${key}`);
  await prisma.subscription.update({ where: { id: sub.id }, data: { trialReminderSent: Prisma.DbNull } });
  await prisma.$executeRawUnsafe("ALTER TABLE notification_email_deliveries RENAME TO notification_email_deliveries_off");
  try {
    sends.length = 0;
    outcome = async () => ({ kind: "retryable", httpStatus: 503 });
    await runTrialReminderEmails();
    assert.equal(ours().length, 0, "no direct send once the outbox is the delivery path");
    assert.equal(await reminderState(), null, "a reminder that was neither queued nor accepted is released");
  } finally {
    await prisma.$executeRawUnsafe("ALTER TABLE notification_email_deliveries_off RENAME TO notification_email_deliveries");
  }

  console.log("trial-reminder-delivery-runtime: ok");
} finally {
  __setSendResendEmailOutcomeFnForTests(null);
  await prisma.$executeRaw(Prisma.sql`DELETE FROM notification_email_deliveries WHERE user_id = ${user.id}`).catch(() => undefined);
  await prisma.subscription.delete({ where: { id: sub.id } }).catch(() => undefined);
  await prisma.business.delete({ where: { id: business.id } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  await prisma.$disconnect();
}
