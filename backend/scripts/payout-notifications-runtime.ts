/**
 * Payout notifications from verified Stripe payout events, through the real webhook handler
 * and a disposable database. Stripe is never called (reconciliation seams return nothing).
 * Run: CARETIP_ISOLATED_POSTGRES_URL=postgresql://...@127.0.0.1:PORT/db node scripts/safe-test.mjs test:payout-notifications
 */
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { Prisma, StripeConnectPayoutStatus } from "@prisma/client";
import { prisma } from "../src/prisma.ts";
import {
  __setListPayoutBalanceTransactionPageFnForTests,
  __setListPayoutBalanceTransactionsFnForTests,
  __setRetrievePayoutForReconFnForTests,
  handleConnectPayoutEvent,
} from "../src/services/stripeConnectPayout.service.ts";
import {
  notifyEmployeePayoutChange,
  sweepRecentPayoutNotifications,
} from "../src/services/notifications/payoutNotifications.service.ts";
import { renderNotificationTemplate } from "../src/notifications/notificationI18n.ts";
import { __setSendResendEmailOutcomeFnForTests } from "../src/services/resendClient.ts";
import { __setNotificationQueueKickForTests } from "../src/services/localizedNotificationEmail.service.ts";

if (process.env.CARETIP_TEST_ISOLATION !== "1") {
  console.error("REFUSING: run through scripts/safe-test.mjs with a disposable database");
  process.exit(1);
}
process.env.FRONTEND_URL = "https://caretip.example";
console.info = () => {};
console.warn = () => {};
__setSendResendEmailOutcomeFnForTests(async () => ({ kind: "sent", messageId: "m" }));
__setNotificationQueueKickForTests(() => undefined);
__setListPayoutBalanceTransactionsFnForTests?.(async () => [] as never);
__setListPayoutBalanceTransactionPageFnForTests?.(async () => ({ data: [], hasMore: false }) as never);
__setRetrievePayoutForReconFnForTests?.(async () => null as never);

const tag = `po${Date.now().toString(36)}`;
const nowSec = Math.floor(Date.now() / 1000);

// Business A (with an employee on their own Connect account) and business B (other tenant).
const managerA = await prisma.user.create({ data: { email: `${tag}-ma@example.test`, role: "MANAGER", preferredLocale: "en" } });
const managerB = await prisma.user.create({ data: { email: `${tag}-mb@example.test`, role: "MANAGER" } });
const bizA = await prisma.business.create({ data: { name: "Café A", slug: `${tag}-a`, userId: managerA.id, stripeAccountId: `acct_${tag}biza` } });
const bizB = await prisma.business.create({ data: { name: "Café B", slug: `${tag}-b`, userId: managerB.id } });
const empUser = await prisma.user.create({ data: { email: `${tag}-e@example.test`, role: "EMPLOYEE", preferredLocale: "de" } });
const otherEmpUser = await prisma.user.create({ data: { email: `${tag}-o@example.test`, role: "EMPLOYEE" } });
const employee = await prisma.employee.create({ data: { name: "Lea", jobTitle: "Service", businessId: bizA.id, userId: empUser.id } });
const otherEmployee = await prisma.employee.create({ data: { name: "Tom", jobTitle: "Bar", businessId: bizB.id, userId: otherEmpUser.id } });
await prisma.employeeStripeAccount.create({ data: { employeeId: employee.id, stripeAccountId: `acct_${tag}emp` } });

let evtSeq = 0;
function payoutEvent(opts: {
  account: string;
  payoutId: string;
  status: "pending" | "in_transit" | "paid" | "failed" | "canceled";
  type?: string;
  created?: number;
  payoutCreated?: number;
  amount?: number;
}): Stripe.Event {
  evtSeq += 1;
  return {
    id: `evt_${tag}_${evtSeq}`,
    type: opts.type ?? (opts.status === "paid" ? "payout.paid" : opts.status === "failed" ? "payout.failed" : opts.status === "canceled" ? "payout.canceled" : "payout.created"),
    account: opts.account,
    created: opts.created ?? nowSec + evtSeq,
    data: {
      object: {
        id: opts.payoutId,
        object: "payout",
        amount: opts.amount ?? 4250,
        currency: "eur",
        status: opts.status,
        arrival_date: nowSec + 2 * 86400,
        created: opts.payoutCreated ?? nowSec - 60,
        method: "standard",
        type: "bank_account",
        failure_code: opts.status === "failed" ? "account_closed" : null,
        failure_message: opts.status === "failed" ? "The bank account has been closed." : null,
      },
    },
  } as unknown as Stripe.Event;
}

async function notesFor(userId: string) {
  return prisma.notification.findMany({
    where: { userId, dedupeKey: { startsWith: "payout:" } },
    orderBy: { createdAt: "asc" },
    select: { dedupeKey: true, title: true, message: true, channels: true, metadata: true },
  });
}

/** Notifications are sent in the background after the payout write; wait for them to settle. */
async function settle(userId: string, expected: number) {
  for (let i = 0; i < 40; i += 1) {
    if ((await notesFor(userId)).length >= expected) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 150));
}

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

const EMP_ACCT = `acct_${tag}emp`;

try {
  await check("payout created → the employee is told it started (German copy, no arrival claim)", async () => {
    await handleConnectPayoutEvent(payoutEvent({ account: EMP_ACCT, payoutId: `po_${tag}_1`, status: "pending" }));
    await settle(empUser.id, 1);
    const n = await notesFor(empUser.id);
    assert.equal(n.length, 1);
    assert.equal(n[0].dedupeKey, `payout:po_${tag}_1:started`);
    assert.equal(n[0].title, "Auszahlung gestartet");
    assert.match(n[0].message, /42,50\s€/);
    assert.doesNotMatch(n[0].message, /angekommen|gutgeschrieben|arrived/i);
    assert.deepEqual([...n[0].channels].sort(), ["in_app", "push"], "no email for a routine start");
  });

  await check("duplicate webhook and concurrent duplicates notify once", async () => {
    const e = payoutEvent({ account: EMP_ACCT, payoutId: `po_${tag}_1`, status: "in_transit", type: "payout.updated" });
    await Promise.all([handleConnectPayoutEvent(e), handleConnectPayoutEvent(e), handleConnectPayoutEvent(e)]);
    await settle(empUser.id, 1);
    assert.equal((await notesFor(empUser.id)).length, 1, "in_transit is the same 'started' stage");
  });

  await check("payout paid → 'sent to your bank', once, even with concurrent paid events", async () => {
    const paid = payoutEvent({ account: EMP_ACCT, payoutId: `po_${tag}_1`, status: "paid" });
    await Promise.all(Array.from({ length: 5 }, () => handleConnectPayoutEvent(paid)));
    await settle(empUser.id, 2);
    const n = await notesFor(empUser.id);
    assert.equal(n.length, 2);
    assert.equal(n[1].dedupeKey, `payout:po_${tag}_1:paid`);
    assert.equal(n[1].title, "Auszahlung an Ihre Bank gesendet");
    assert.match(n[1].message, /kann es etwas dauern/);
  });

  await check("an older 'pending' event arriving after 'paid' changes nothing and notifies nothing", async () => {
    await handleConnectPayoutEvent(
      payoutEvent({ account: EMP_ACCT, payoutId: `po_${tag}_1`, status: "pending", created: nowSec - 3600 }),
    );
    await settle(empUser.id, 3);
    assert.equal((await notesFor(empUser.id)).length, 2);
    const row = await prisma.employeeStripePayout.findUnique({ where: { stripePayoutId: `po_${tag}_1` } });
    assert.equal(row?.status, StripeConnectPayoutStatus.paid);
  });

  await check("payout failed → employee is told (in-app, push and a durable email)", async () => {
    await handleConnectPayoutEvent(payoutEvent({ account: EMP_ACCT, payoutId: `po_${tag}_2`, status: "failed" }));
    await settle(empUser.id, 3);
    const n = (await notesFor(empUser.id)).find((x) => x.dedupeKey === `payout:po_${tag}_2:failed`);
    assert.ok(n);
    assert.equal(n.title, "Auszahlung fehlgeschlagen");
    assert.ok(n.channels.includes("email"));
    const deliveries = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS n FROM notification_email_deliveries WHERE user_id = ${empUser.id} AND kind = 'employee_payout_failed'`);
    assert.equal(Number(deliveries[0].n), 1, "failure email is in the durable outbox");
  });

  await check("payout cancelled → employee is told the amount stays in the Stripe balance", async () => {
    await handleConnectPayoutEvent(payoutEvent({ account: EMP_ACCT, payoutId: `po_${tag}_3`, status: "canceled" }));
    await settle(empUser.id, 4);
    const n = (await notesFor(empUser.id)).find((x) => x.dedupeKey === `payout:po_${tag}_3:canceled`);
    assert.ok(n);
    assert.match(n.message, /Stripe-Guthaben/);
  });

  await check("history from a first account sync (older than 14 days) is not announced", async () => {
    await handleConnectPayoutEvent(
      payoutEvent({ account: EMP_ACCT, payoutId: `po_${tag}_old`, status: "paid", payoutCreated: nowSec - 30 * 86400 }),
    );
    await settle(empUser.id, 5);
    assert.equal((await notesFor(empUser.id)).filter((x) => x.dedupeKey?.includes("_old")).length, 0);
  });

  await check("only the payout's own employee is notified; managers and other tenants get nothing", async () => {
    assert.equal((await notesFor(managerA.id)).length, 0, "manager A is not told about employee payouts");
    assert.equal((await notesFor(managerB.id)).length, 0);
    assert.equal((await notesFor(otherEmpUser.id)).length, 0);
  });

  await check("business payout failed → only that business owner is told", async () => {
    await handleConnectPayoutEvent(payoutEvent({ account: `acct_${tag}biza`, payoutId: `po_${tag}_biz`, status: "failed" }));
    await settle(managerA.id, 1);
    const n = await notesFor(managerA.id);
    assert.equal(n.length, 1);
    assert.equal(n[0].title, "Business payout could not be completed");
    assert.equal((await notesFor(managerB.id)).length, 0);
    assert.equal((await notesFor(empUser.id)).filter((x) => x.dedupeKey?.includes("_biz")).length, 0);
  });

  await check("a paid business payout is not announced (no noise)", async () => {
    await handleConnectPayoutEvent(payoutEvent({ account: `acct_${tag}biza`, payoutId: `po_${tag}_bizok`, status: "paid" }));
    await settle(managerA.id, 2);
    assert.equal((await notesFor(managerA.id)).length, 1);
  });

  await check("sweep repairs a notification lost to a crash, and reruns add nothing", async () => {
    // A payout row written without its notification (process stopped in between).
    const row = await prisma.employeeStripePayout.create({
      data: {
        employeeId: employee.id,
        businessId: bizA.id,
        stripeAccountId: EMP_ACCT,
        stripePayoutId: `po_${tag}_crash`,
        amountCents: 1000,
        currency: "eur",
        status: StripeConnectPayoutStatus.paid,
        stripeCreatedAt: new Date(),
        lastStripeEventCreated: nowSec,
        lastStripeEventType: "payout.paid",
        paidAt: new Date(),
      },
    });
    const before = (await notesFor(empUser.id)).length;
    await sweepRecentPayoutNotifications();
    await sweepRecentPayoutNotifications();
    const after = await notesFor(empUser.id);
    assert.equal(after.length, before + 1);
    assert.equal(after.filter((x) => x.dedupeKey === `payout:po_${tag}_crash:paid`).length, 1);
    assert.equal(await notifyEmployeePayoutChange(row.id), "already_notified");
  });

  await check("an employee moved to another business is not told about the old business's payout", async () => {
    const row = await prisma.employeeStripePayout.create({
      data: {
        employeeId: otherEmployee.id,
        businessId: bizA.id, // payout recorded under business A, employee belongs to B
        stripeAccountId: `acct_${tag}x`,
        stripePayoutId: `po_${tag}_mismatch`,
        amountCents: 500,
        currency: "eur",
        status: StripeConnectPayoutStatus.paid,
        stripeCreatedAt: new Date(),
        lastStripeEventCreated: nowSec,
        lastStripeEventType: "payout.paid",
      },
    });
    assert.equal(await notifyEmployeePayoutChange(row.id), "no_recipient");
  });

  await check("English copy and no dashes in any payout message", async () => {
    const p = { amountCents: 1999, currency: "eur", arrivalDateIso: "2026-11-21T00:00:00.000Z" };
    const ids = ["employee_payout_started", "employee_payout_paid", "employee_payout_failed", "employee_payout_canceled", "business_payout_failed"] as const;
    for (const id of ids) {
      for (const loc of ["en", "de"] as const) {
        const r = renderNotificationTemplate(loc, { id, params: p } as never);
        assert.ok(r.title && r.body, `${loc} ${id}`);
        assert.doesNotMatch(`${r.title} ${r.body}`, /[—–]/);
        assert.doesNotMatch(`${r.title} ${r.body}`, /\barrived\b|has arrived|angekommen/i, "never claims arrival");
      }
    }
    assert.equal(
      renderNotificationTemplate("en", { id: "employee_payout_started", params: p }).body,
      "A payout of €19.99 to your bank account has started. Stripe expects it to arrive on 21 Nov 2026.",
    );
  });

  console.log(`payout-notifications-runtime: ok (${passed} checks)`);
} finally {
  __setSendResendEmailOutcomeFnForTests(null);
  const users = [managerA.id, managerB.id, empUser.id, otherEmpUser.id];
  await prisma.$executeRaw(Prisma.sql`DELETE FROM notification_email_deliveries WHERE user_id = ANY(${users})`).catch(() => undefined);
  await prisma.notification.deleteMany({ where: { userId: { in: users } } }).catch(() => undefined);
  await prisma.employeeStripePayout.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } }).catch(() => undefined);
  await prisma.stripeConnectPayoutBalanceLine?.deleteMany?.({ where: { payout: { businessId: bizA.id } } }).catch(() => undefined);
  await prisma.stripeConnectPayout.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } }).catch(() => undefined);
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: { in: [employee.id, otherEmployee.id] } } }).catch(() => undefined);
  await prisma.employee.deleteMany({ where: { id: { in: [employee.id, otherEmployee.id] } } }).catch(() => undefined);
  await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => undefined);
  await prisma.$disconnect();
}
