/**
 * Returned payouts (paid, then sent back by the bank) through the real webhook handler and a
 * disposable database. Stripe is never called.
 * Run: CARETIP_ISOLATED_POSTGRES_URL=postgresql://...@127.0.0.1:PORT/db node scripts/safe-test.mjs test:payout-returns
 */
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { Prisma, StripeConnectPayoutStatus } from "@prisma/client";
import { prisma } from "../src/prisma.ts";
import {
  __setListConnectPayoutsFnForTests,
  __setListPayoutBalanceTransactionPageFnForTests,
  __setListPayoutBalanceTransactionsFnForTests,
  __setRetrievePayoutForReconFnForTests,
  detectPayoutReturn,
  handleConnectPayoutEvent,
  listPayoutsForBusiness,
} from "../src/services/stripeConnectPayout.service.ts";
import { persistEmployeePayoutFromStripeObject } from "../src/services/employeeStripePayout.service.ts";
import { sweepRecentPayoutNotifications } from "../src/services/notifications/payoutNotifications.service.ts";
import { getPlatformPayoutAnalytics } from "../src/services/platformPayoutAnalytics.service.ts";
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
__setListConnectPayoutsFnForTests(async () => ({ data: [], hasMore: false }));

const tag = `rt${Date.now().toString(36)}`;
const nowSec = Math.floor(Date.now() / 1000);
const managerA = await prisma.user.create({ data: { email: `${tag}-ma@example.test`, role: "MANAGER", preferredLocale: "en" } });
const managerB = await prisma.user.create({ data: { email: `${tag}-mb@example.test`, role: "MANAGER" } });
const bizA = await prisma.business.create({ data: { name: "Café A", slug: `${tag}-a`, userId: managerA.id, stripeAccountId: `acct_${tag}biza` } });
const bizB = await prisma.business.create({ data: { name: "Café B", slug: `${tag}-b`, userId: managerB.id } });
const empUser = await prisma.user.create({ data: { email: `${tag}-e@example.test`, role: "EMPLOYEE", preferredLocale: "de" } });
const otherEmpUser = await prisma.user.create({ data: { email: `${tag}-o@example.test`, role: "EMPLOYEE" } });
const employee = await prisma.employee.create({ data: { name: "Lea", jobTitle: "Service", businessId: bizA.id, userId: empUser.id } });
const otherEmployee = await prisma.employee.create({ data: { name: "Tom", jobTitle: "Bar", businessId: bizB.id, userId: otherEmpUser.id } });
await prisma.employeeStripeAccount.create({ data: { employeeId: employee.id, stripeAccountId: `acct_${tag}emp` } });
const EMP = `acct_${tag}emp`;
const BIZ = `acct_${tag}biza`;

let seq = 0;
function payout(id: string, status: string, extra: Record<string, unknown> = {}): Stripe.Payout {
  return {
    id,
    object: "payout",
    amount: 7500,
    currency: "eur",
    status,
    arrival_date: nowSec + 86400,
    created: nowSec - 120,
    method: "standard",
    type: "bank_account",
    failure_code: status === "failed" ? "account_closed" : null,
    failure_message: status === "failed" ? "The bank account has been closed." : null,
    failure_balance_transaction: status === "failed" ? "txn_return_123" : null,
    ...extra,
  } as unknown as Stripe.Payout;
}
function event(account: string, p: Stripe.Payout, created?: number): Stripe.Event {
  seq += 1;
  const type = p.status === "paid" ? "payout.paid" : p.status === "failed" ? "payout.failed" : "payout.created";
  return { id: `evt_${tag}_${seq}`, type, account, created: created ?? nowSec + seq, data: { object: p } } as unknown as Stripe.Event;
}
type ReturnRow = { payout_kind: string; stripe_payout_id: string; amount_cents: number; original_paid_at: Date | null; failure_balance_transaction_id: string | null; detected_via: string; stripe_event_id: string | null };
const returns = (poId: string) =>
  prisma.$queryRaw<ReturnRow[]>(Prisma.sql`SELECT payout_kind, stripe_payout_id, amount_cents, original_paid_at, failure_balance_transaction_id, detected_via, stripe_event_id FROM stripe_payout_returns WHERE stripe_payout_id = ${poId}`);
const notes = (userId: string, poId: string) =>
  prisma.notification.findMany({ where: { userId, dedupeKey: { startsWith: `payout:${poId}:` } }, orderBy: { createdAt: "asc" }, select: { dedupeKey: true, title: true, message: true, channels: true } });
async function settle() {
  await new Promise((r) => setTimeout(r, 400));
}

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

try {
  const PO1 = `po_${tag}_1`;

  await check("return detection: paid then failed in either order, nothing else", () => {
    const paid = StripeConnectPayoutStatus.paid, failed = StripeConnectPayoutStatus.failed;
    const at = new Date("2026-11-18T10:00:00Z");
    assert.deepEqual(detectPayoutReturn({ storedStatus: paid, storedEventCreated: 10, storedPaidAt: at, incomingStatus: failed, incomingEventCreated: 20 }), { originalPaidAt: at });
    assert.ok(detectPayoutReturn({ storedStatus: failed, storedEventCreated: 20, storedPaidAt: null, incomingStatus: paid, incomingEventCreated: 10 }));
    assert.equal(detectPayoutReturn({ storedStatus: paid, storedEventCreated: 20, storedPaidAt: at, incomingStatus: failed, incomingEventCreated: 10 }), null, "older failed is stale, not a return");
    assert.equal(detectPayoutReturn({ storedStatus: StripeConnectPayoutStatus.canceled, storedEventCreated: 10, storedPaidAt: null, incomingStatus: failed, incomingEventCreated: 20 }), null);
    assert.equal(detectPayoutReturn({ storedStatus: StripeConnectPayoutStatus.pending, storedEventCreated: 10, storedPaidAt: null, incomingStatus: failed, incomingEventCreated: 20 }), null);
  });

  await check("employee payout paid, then returned: history kept, return recorded once", async () => {
    await handleConnectPayoutEvent(event(EMP, payout(PO1, "paid")));
    await settle();
    const paidRow = await prisma.employeeStripePayout.findUnique({ where: { stripePayoutId: PO1 } });
    assert.equal(paidRow?.status, StripeConnectPayoutStatus.paid);
    const paidAt = paidRow!.paidAt!;

    await handleConnectPayoutEvent(event(EMP, payout(PO1, "failed")));
    await settle();
    const after = await prisma.employeeStripePayout.findUnique({ where: { stripePayoutId: PO1 } });
    assert.equal(after?.status, StripeConnectPayoutStatus.paid, "the payout row keeps its paid history");
    assert.equal(after?.paidAt?.getTime(), paidAt.getTime(), "original paid time preserved");
    assert.equal(after?.amountCents, 7500, "amount unchanged");
    const r = await returns(PO1);
    assert.equal(r.length, 1);
    assert.equal(r[0].payout_kind, "employee");
    assert.equal(r[0].amount_cents, 7500);
    assert.equal(r[0].original_paid_at?.getTime(), paidAt.getTime());
    assert.equal(r[0].failure_balance_transaction_id, "txn_return_123", "Stripe's return evidence kept");
    assert.equal(r[0].detected_via, "webhook");
    assert.ok(r[0].stripe_event_id?.startsWith("evt_"));
  });

  await check("the employee is told it was returned (German), with no claim the money is available", async () => {
    const n = await notes(empUser.id, PO1);
    const ret = n.find((x) => x.dedupeKey === `payout:${PO1}:returned`);
    assert.ok(ret, "returned notification exists");
    assert.equal(ret.title, "Auszahlung von Ihrer Bank zurückgebucht");
    assert.match(ret.message, /75,00\s€/);
    assert.match(ret.message, /sobald die Rückbuchung abgeschlossen ist/);
    assert.doesNotMatch(ret.message, /verfügbar|available/i);
    assert.ok(ret.channels.includes("email"));
    const d = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM notification_email_deliveries WHERE user_id = ${empUser.id} AND kind = 'employee_payout_returned'`);
    assert.equal(Number(d[0].n), 1, "durable email queued once");
  });

  await check("duplicate, concurrent and API sync reruns record and notify nothing new", async () => {
    const dup = event(EMP, payout(PO1, "failed"));
    await Promise.all([handleConnectPayoutEvent(dup), handleConnectPayoutEvent(dup), handleConnectPayoutEvent(event(EMP, payout(PO1, "failed")))]);
    await persistEmployeePayoutFromStripeObject({ employeeId: employee.id, stripeAccountId: EMP, payout: payout(PO1, "failed") });
    await sweepRecentPayoutNotifications();
    await settle();
    assert.equal((await returns(PO1)).length, 1);
    assert.equal((await notes(empUser.id, PO1)).filter((x) => x.dedupeKey?.endsWith(":returned")).length, 1);
  });

  await check("API sync alone detects a return the webhook missed", async () => {
    const PO = `po_${tag}_sync`;
    // A real webhook is never newer than the sync that follows it.
    await handleConnectPayoutEvent(event(EMP, payout(PO, "paid"), nowSec - 60));
    await settle();
    await persistEmployeePayoutFromStripeObject({ employeeId: employee.id, stripeAccountId: EMP, payout: payout(PO, "failed") });
    await settle();
    const r = await returns(PO);
    assert.equal(r.length, 1);
    assert.equal(r[0].detected_via, "api_sync");
    assert.ok((await notes(empUser.id, PO)).some((x) => x.dedupeKey?.endsWith(":returned")));
  });

  await check("reversed delivery (failed first, older paid later): recorded, not announced twice", async () => {
    const PO = `po_${tag}_rev`;
    await handleConnectPayoutEvent(event(EMP, payout(PO, "failed"), nowSec + 500));
    await settle();
    await handleConnectPayoutEvent(event(EMP, payout(PO, "paid"), nowSec + 100));
    await settle();
    const row = await prisma.employeeStripePayout.findUnique({ where: { stripePayoutId: PO } });
    assert.equal(row?.status, StripeConnectPayoutStatus.failed, "current state stays failed");
    const r = await returns(PO);
    assert.equal(r.length, 1, "the return is still on record");
    assert.equal(r[0].original_paid_at?.getTime(), (nowSec + 100) * 1000);
    const n = await notes(empUser.id, PO);
    assert.ok(n.some((x) => x.dedupeKey?.endsWith(":failed")));
    assert.equal(n.filter((x) => x.dedupeKey?.endsWith(":returned")).length, 0, "already told it failed");
  });

  await check("business payout returned: owner told; list shows returned with paid history", async () => {
    const PO = `po_${tag}_biz`;
    await handleConnectPayoutEvent(event(BIZ, payout(PO, "paid")));
    await handleConnectPayoutEvent(event(BIZ, payout(PO, "failed")));
    await settle();
    const r = await returns(PO);
    assert.equal(r.length, 1);
    assert.equal(r[0].payout_kind, "business");
    const n = await notes(managerA.id, PO);
    assert.equal(n.length, 1);
    assert.equal(n[0].title, "Business payout returned by the bank");
    const list = await listPayoutsForBusiness(bizA.id, {});
    const item = list.items.find((i) => i.stripePayoutId === PO);
    assert.equal(item?.status, "paid", "stored status unchanged");
    assert.ok(item?.returnedAt, "returnedAt exposed for the badge");
    assert.equal(item?.returnFailureCode, "account_closed");
  });

  await check("platform analytics count the return as returned, not paid", async () => {
    const res = await getPlatformPayoutAnalytics({
      startUtc: new Date((nowSec - 3600) * 1000),
      endUtc: new Date((nowSec + 3600) * 1000),
      timezone: "UTC",
    });
    assert.ok(res.summary.returnedCount >= 3, `returnedCount ${res.summary.returnedCount}`);
    const paidRows = await prisma.$queryRaw<{ c: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS c FROM (
        SELECT status, stripe_created_at FROM stripe_connect_payouts UNION ALL SELECT status, stripe_created_at FROM employee_stripe_payouts
      ) s WHERE status = 'paid'`);
    assert.equal(res.summary.paidCount, paidRows[0].c - (res.summary.returnedCount), "paid excludes returned payouts that keep status paid");
  });

  await check("tenant isolation: nobody else hears about these returns", async () => {
    const others = await prisma.notification.count({ where: { userId: { in: [managerB.id, otherEmpUser.id] }, dedupeKey: { startsWith: "payout:" } } });
    assert.equal(others, 0);
    const empNotes = await prisma.notification.count({ where: { userId: empUser.id, dedupeKey: `payout:po_${tag}_biz:returned` } });
    assert.equal(empNotes, 0, "employee is not told about the business payout");
    void otherEmployee;
  });

  await check("the regenerated Prisma client reads the new tables", async () => {
    const n = await (prisma as unknown as { stripePayoutReturn: { count(args: unknown): Promise<number> } }).stripePayoutReturn.count({ where: { businessId: bizA.id } });
    assert.ok(n >= 4);
    const q = await (prisma as unknown as { notificationEmailDelivery: { count(): Promise<number> } }).notificationEmailDelivery.count();
    assert.ok(q >= 1);
  });

  await check("English copy, and no dashes or availability claims in either language", () => {
    const p = { amountCents: 1250, currency: "eur" };
    for (const id of ["employee_payout_returned", "business_payout_returned"] as const) {
      for (const loc of ["en", "de"] as const) {
        const r = renderNotificationTemplate(loc, { id, params: p });
        assert.doesNotMatch(`${r.title} ${r.body}`, /[—–]/);
        assert.doesNotMatch(r.body, /\bis available\b|ist verfügbar/i);
      }
    }
    assert.equal(renderNotificationTemplate("en", { id: "employee_payout_returned", params: p }).title, "Payout returned by your bank");
  });

  console.log(`payout-returns-runtime: ok (${passed} checks)`);
} finally {
  __setSendResendEmailOutcomeFnForTests(null);
  const users = [managerA.id, managerB.id, empUser.id, otherEmpUser.id];
  await prisma.$executeRaw(Prisma.sql`DELETE FROM notification_email_deliveries WHERE user_id = ANY(${users})`).catch(() => undefined);
  await prisma.$executeRaw(Prisma.sql`DELETE FROM stripe_payout_returns WHERE business_id = ANY(${[bizA.id, bizB.id]})`).catch(() => undefined);
  await prisma.notification.deleteMany({ where: { userId: { in: users } } }).catch(() => undefined);
  await prisma.employeeStripePayout.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } }).catch(() => undefined);
  await prisma.stripeConnectPayout.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } }).catch(() => undefined);
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: { in: [employee.id, otherEmployee.id] } } }).catch(() => undefined);
  await prisma.employee.deleteMany({ where: { id: { in: [employee.id, otherEmployee.id] } } }).catch(() => undefined);
  await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => undefined);
  await prisma.$disconnect();
}
