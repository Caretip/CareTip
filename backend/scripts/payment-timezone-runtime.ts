/**
 * Financial/payment SQL is independent of the database session TimeZone (audit L2), and German
 * business days/months stay correct across daylight-saving changes.
 *
 * The whole run uses a session TimeZone of Pacific/Kiritimati (UTC+14) so any raw-SQL comparison that
 * still depended on a UTC session would be off by 14 hours. A negative control proves it.
 *
 *   CARETIP_ISOLATED_POSTGRES_URL=postgresql://…@127.0.0.1:…/db node scripts/safe-test.mjs test:payment-timezone
 */
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

const isolated = await completeIsolatedPostgresBootstrap();
const SESSION_TZ = "Pacific/Kiritimati";
process.env.DATABASE_URL = `${isolated}${isolated.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c TimeZone=${SESSION_TZ}`)}`;

const { prisma } = await import("../src/prisma.js");
const { businessUtcRangeForTimeframe } = await import("../src/utils/businessTime.js");
const { loadBusinessFinancialMetrics } = await import("../src/services/businessFinancialMetrics.service.js");
const { queryDailyTipBuckets } = await import("../src/utils/tipChartBuckets.js");
const { tryClaimPhysicalQrMonthlyFreeOrder, hasPaidPhysicalQrMonthlyFreeOrderThisMonth } = await import(
  "../src/services/physicalQr/physicalQrPricing.service.js"
);
const { berlinCalendarMonthStart } = await import("../src/lib/physicalQr/quote.js");
const { warnIfDatabaseSessionNotUtc } = await import("../src/lib/databaseSessionTimezone.js");

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

const BERLIN = "Europe/Berlin";
const utc = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });
const hours = (r: { startUtc: Date; endUtc: Date }) => (r.endUtc.getTime() + 1 - r.startUtc.getTime()) / 3_600_000;

const sfx = Date.now().toString(36);
const user = await prisma.user.create({ data: { email: `tz-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true } });
const business = await prisma.business.create({ data: { name: `TZ ${sfx}`, slug: `tz-${sfx}`, userId: user.id, timezone: BERLIN } });
const employee = await prisma.employee.create({ data: { name: "TZ", jobTitle: "Server", businessId: business.id } });
let seq = 0;
async function tipAt(at: Date, amount = 10) {
  seq += 1;
  return prisma.transaction.create({
    data: { amount, status: "success", businessId: business.id, employeeId: employee.id, stripePaymentIntentId: `pi_tz_${sfx}_${seq}`, createdAt: at },
  });
}

await check("Z0 the session TimeZone really is non-UTC (and the startup check reports it)", async () => {
  const rows = await prisma.$queryRaw<Array<{ tz: string }>>`SELECT current_setting('TimeZone') AS tz`;
  assert.equal(rows[0]?.tz, SESSION_TZ);
  assert.equal(await warnIfDatabaseSessionNotUtc(), SESSION_TZ);
});

await check("Z1 negative control: an unconverted bound date is shifted by the session offset", async () => {
  const at = utc("2026-05-10T12:00:00Z").toJSDate();
  const tip = await tipAt(at);
  const naive = await prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM tips WHERE id = ${tip.id} AND created_at >= ${at}`;
  const fixed = await prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM tips WHERE id = ${tip.id} AND created_at >= (${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  assert.equal(naive[0]!.n, 0, "the old pattern misses a tip at exactly the boundary under a +14h session");
  assert.equal(fixed[0]!.n, 1);
});

await check("D1 German DST start (2026-03-29) is a 23-hour business day", async () => {
  const r = businessUtcRangeForTimeframe("today", BERLIN, utc("2026-03-29T12:00:00Z"))!;
  assert.equal(r.startUtc.toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(r.endUtc.toISOString(), "2026-03-29T21:59:59.999Z");
  assert.equal(hours(r), 23);
});

await check("D2 German DST end (2026-10-25) is a 25-hour business day", async () => {
  const r = businessUtcRangeForTimeframe("today", BERLIN, utc("2026-10-25T12:00:00Z"))!;
  assert.equal(r.startUtc.toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(r.endUtc.toISOString(), "2026-10-25T22:59:59.999Z");
  assert.equal(hours(r), 25);
});

await check("D3 March 2026 (contains DST start) month bounds in Berlin", async () => {
  const r = businessUtcRangeForTimeframe("month", BERLIN, utc("2026-03-15T12:00:00Z"))!;
  assert.equal(r.startUtc.toISOString(), "2026-02-28T23:00:00.000Z");
  assert.equal(r.endUtc.toISOString(), "2026-03-31T21:59:59.999Z");
});

await check("B1 daily tip buckets on the 23-hour day: German local-day edges, any session TimeZone", async () => {
  const day = businessUtcRangeForTimeframe("today", BERLIN, utc("2026-03-29T12:00:00Z"))!;
  await tipAt(utc("2026-03-28T22:59:59.999Z").toJSDate(), 1); // 23:59:59.999 on 28 Mar (CET): previous day
  await tipAt(utc("2026-03-28T23:00:00.000Z").toJSDate(), 2); // 00:00 on 29 Mar (CET): first instant
  await tipAt(utc("2026-03-29T21:59:59.999Z").toJSDate(), 4); // 23:59:59.999 on 29 Mar (CEST): last instant
  await tipAt(utc("2026-03-29T22:00:00.000Z").toJSDate(), 8); // 00:00 on 30 Mar (CEST): next day
  const buckets = await queryDailyTipBuckets({ businessId: business.id, startUtc: day.startUtc, endUtc: day.endUtc, timezone: BERLIN });
  assert.deepEqual([...buckets.entries()], [["2026-03-29", 6]]);
});

await check("B2 daily tip buckets on the 25-hour day (2026-10-25)", async () => {
  const day = businessUtcRangeForTimeframe("today", BERLIN, utc("2026-10-25T12:00:00Z"))!;
  await tipAt(utc("2026-10-24T21:59:59.999Z").toJSDate(), 1); // 23:59:59.999 on 24 Oct (CEST)
  await tipAt(utc("2026-10-24T22:00:00.000Z").toJSDate(), 2); // 00:00 on 25 Oct (CEST)
  await tipAt(utc("2026-10-25T22:59:59.999Z").toJSDate(), 4); // 23:59:59.999 on 25 Oct (CET)
  await tipAt(utc("2026-10-25T23:00:00.000Z").toJSDate(), 8); // 00:00 on 26 Oct (CET)
  const buckets = await queryDailyTipBuckets({ businessId: business.id, startUtc: day.startUtc, endUtc: day.endUtc, timezone: BERLIN });
  assert.deepEqual([...buckets.entries()], [["2026-10-25", 6]]);
});

await check("M1 financial metrics include tips at the exact month edges (session TimeZone ignored)", async () => {
  const b2User = await prisma.user.create({ data: { email: `tz2-${sfx}@example.com`, passwordHash: "x", role: "MANAGER", emailVerified: true } });
  const b2 = await prisma.business.create({ data: { name: `TZ2 ${sfx}`, slug: `tz2-${sfx}`, userId: b2User.id, timezone: BERLIN } });
  const emp = await prisma.employee.create({ data: { name: "TZ2", jobTitle: "Server", businessId: b2.id } });
  const range = businessUtcRangeForTimeframe("month", BERLIN)!;
  const at = (d: Date, amount: number, tag: string) =>
    prisma.transaction.create({ data: { amount, status: "success", businessId: b2.id, employeeId: emp.id, stripePaymentIntentId: `pi_tz2_${sfx}_${tag}`, createdAt: d } });
  await at(new Date(range.startUtc.getTime() - 1), 1, "before");
  await at(range.startUtc, 2, "start");
  await at(range.endUtc, 4, "end");
  await at(new Date(range.endUtc.getTime() + 1), 8, "after");
  const m = await loadBusinessFinancialMetrics(b2.id, { period: "month", businessTimezone: BERLIN });
  assert.equal(m.tipCount, 2);
  assert.equal(m.totalCustomerTipsEur, 6);
});

await check("Q1 QR monthly free order: claim stores the exact instant and resets at the German month edge", async () => {
  const lastMarch = utc("2026-03-31T21:30:00Z").toJSDate(); // 23:30 on 31 Mar (CEST)
  const firstApril = utc("2026-03-31T22:30:00Z").toJSDate(); // 00:30 on 1 Apr (CEST)
  const first = await tryClaimPhysicalQrMonthlyFreeOrder({ businessId: business.id, now: lastMarch, timezone: BERLIN });
  assert.equal(first.claimed, true);
  const stored = (await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).physicalQrFreeOrderUsedAt;
  assert.equal(stored?.toISOString(), lastMarch.toISOString(), "no session-offset shift on write");
  const sameMonth = await tryClaimPhysicalQrMonthlyFreeOrder({ businessId: business.id, now: utc("2026-03-31T21:45:00Z").toJSDate(), timezone: BERLIN });
  assert.equal(sameMonth.claimed, false, "still March in Berlin");
  const nextMonth = await tryClaimPhysicalQrMonthlyFreeOrder({ businessId: business.id, now: firstApril, timezone: BERLIN });
  assert.equal(nextMonth.claimed, true, "April in Berlin");
});

await check("Q2 'paid free order this month' uses the German month start exactly", async () => {
  const monthStart = berlinCalendarMonthStart(utc("2026-04-15T12:00:00Z").toJSDate(), BERLIN); // 2026-03-31T22:00Z
  assert.equal(monthStart.toISOString(), "2026-03-31T22:00:00.000Z");
  const mk = (paidAt: Date) =>
    prisma.physicalQrOrder.create({
      data: {
        businessId: business.id, userId: user.id, totalAmount: 0, currency: "EUR", placedAt: paidAt, processingClass: "WITHIN_24_HOURS",
        processingDeadlineAt: paidAt, processingCopySnapshot: {}, businessNameSnapshot: "TZ", paymentStatus: "PAID",
        fulfillmentStatus: "PROCESSING", monthlyFreeQuotaApplied: true, paidAt,
      },
    });
  const before = await mk(new Date(monthStart.getTime() - 1));
  assert.equal(await hasPaidPhysicalQrMonthlyFreeOrderThisMonth(business.id, monthStart), false, "1 ms before the month is last month");
  await prisma.physicalQrOrder.delete({ where: { id: before.id } });
  await mk(monthStart);
  assert.equal(await hasPaidPhysicalQrMonthlyFreeOrderThisMonth(business.id, monthStart), true, "the first instant counts");
});

await prisma.$disconnect();
console.log(`\npayment-timezone: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
