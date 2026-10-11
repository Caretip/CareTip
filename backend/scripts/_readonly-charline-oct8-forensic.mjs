/**
 * Read-only forensic: Test Hotel / Charline Test / Oct 8 2026 payout
 */
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { DateTime } from "luxon";

function mask(id) {
  if (!id) return null;
  const s = String(id);
  if (s.length <= 10) return `${s.slice(0, 3)}…`;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function maskStripe(id) {
  if (!id) return null;
  const s = String(id).trim();
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/** Mirror computeNextEvery3DaysPayoutAt from businessBankPayoutSchedule.service.ts */
function computeNextEvery3DaysPayoutAt(timezone, previousAnchorUtc) {
  const tz = timezone || "UTC";
  const base =
    previousAnchorUtc != null
      ? DateTime.fromJSDate(previousAnchorUtc, { zone: "utc" }).setZone(tz)
      : DateTime.now().setZone(tz);
  return base
    .plus({ days: 3 })
    .set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
    .toUTC()
    .toJSDate();
}

const diagnosticAt = new Date();

// 1) Find businesses named like Test Hotel
const businesses = await prisma.business.findMany({
  where: {
    name: { contains: "Test Hotel", mode: "insensitive" },
  },
  select: {
    id: true,
    name: true,
    timezone: true,
    deletedAt: true,
    legalHold: true,
    bankPayoutSchedule: true,
    bankPayoutNextScheduledAt: true,
    stripeAccountId: true,
    stripePayoutsEnabled: true,
  },
});

// 2) Find Charline employees (all businesses if ambiguous)
const charlineEmployees = await prisma.employee.findMany({
  where: {
    OR: [
      { name: { contains: "Charline", mode: "insensitive" } },
      { name: { contains: "Charline Test", mode: "insensitive" } },
    ],
  },
  select: {
    id: true,
    businessId: true,
    name: true,
    isDeleted: true,
    isActive: true,
    activationStatus: true,
    createdAt: true,
    userId: true,
    user: {
      select: {
        id: true,
        isActive: true,
        legalHold: true,
        email: true,
      },
    },
    business: {
      select: {
        id: true,
        name: true,
        timezone: true,
        deletedAt: true,
        legalHold: true,
      },
    },
  },
  take: 25,
});

// Match Charline at Test Hotel
const testHotelIds = new Set(businesses.map((b) => b.id));
const charlineAtTestHotel = charlineEmployees.filter((e) => testHotelIds.has(e.businessId));
const charlineElsewhere = charlineEmployees.filter((e) => !testHotelIds.has(e.businessId));

const targetEmployees =
  charlineAtTestHotel.length > 0
    ? charlineAtTestHotel
    : charlineEmployees.filter((e) => /charline/i.test(e.name || "") && /test/i.test(e.name || ""));

const employeeForensics = [];
for (const emp of targetEmployees) {
  const esa = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId: emp.id },
  });

  const ledger = await prisma.employeeStripeScheduledPayoutRequest.findMany({
    where: { employeeId: emp.id },
    orderBy: { createdAt: "asc" },
  });

  const stripePayouts = await prisma.employeeStripePayout.findMany({
    where: { employeeId: emp.id },
    orderBy: { stripeCreatedAt: "desc" },
    take: 20,
  });

  const tz = emp.business.timezone || "UTC";
  const oct8LocalStart = DateTime.fromObject(
    { year: 2026, month: 10, day: 8, hour: 0, minute: 0 },
    { zone: tz },
  );
  const oct8LocalEnd = oct8LocalStart.plus({ days: 1 });
  const oct8UtcStart = oct8LocalStart.toUTC().toJSDate();
  const oct8UtcEnd = oct8LocalEnd.toUTC().toJSDate();

  const ledgerNearOct8 = ledger.filter((r) => {
    const w = Date.parse(r.scheduleWindowKey);
    return w >= oct8UtcStart.getTime() - 4 * 86400000 && w <= oct8UtcEnd.getTime() + 4 * 86400000;
  });

  const payoutsNearOct8 = stripePayouts.filter(
    (p) => p.stripeCreatedAt >= oct8UtcStart && p.stripeCreatedAt < oct8UtcEnd,
  );

  // Would tick select on Oct 8 12:00 UTC?
  const probeTimes = [
    DateTime.fromISO("2026-10-08T07:00:00.000Z").toJSDate(),
    DateTime.fromISO("2026-10-08T12:00:00.000Z").toJSDate(),
    DateTime.fromISO("2026-10-09T07:00:00.000Z").toJSDate(),
  ];

  const tickEligibilityAt = probeTimes.map((t) => {
    const dueAt = esa?.bankPayoutNextScheduledAt;
    const wouldSelect =
      esa &&
      esa.bankPayoutSchedule === "every_3_days" &&
      esa.bankPayoutNextScheduledAt &&
      esa.bankPayoutNextScheduledAt.getTime() <= t.getTime() &&
      esa.stripePayoutsEnabled &&
      !emp.isDeleted &&
      emp.isActive &&
      emp.activationStatus === "active" &&
      emp.user?.isActive &&
      !emp.user?.legalHold &&
      !emp.business.deletedAt &&
      !emp.business.legalHold;

    return {
      probeUtc: t.toISOString(),
      wouldMatchTickQuery: Boolean(wouldSelect),
      storedNextScheduledAt: dueAt?.toISOString() ?? null,
      nextIsDue: dueAt ? dueAt.getTime() <= t.getTime() : false,
      schedule: esa?.bankPayoutSchedule ?? null,
    };
  });

  // Audit logs for schedule changes
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { metadata: { contains: emp.id } },
        { action: "employee_bank_payout_schedule_changed" },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, action: true, metadata: true, createdAt: true, userId: true },
  });
  const relevantAudit = auditLogs.filter(
    (a) =>
      a.action === "employee_bank_payout_schedule_changed" &&
      a.metadata?.includes(emp.id),
  );

  employeeForensics.push({
    employeeId: emp.id,
    employeeIdMasked: mask(emp.id),
    businessId: emp.businessId,
    businessIdMasked: mask(emp.businessId),
    businessName: emp.business.name,
    employeeName: emp.name,
    userEmailMasked: emp.user?.email ? `${emp.user.email.slice(0, 2)}…@…` : null,
    employeeFlags: {
      isDeleted: emp.isDeleted,
      isActive: emp.isActive,
      activationStatus: emp.activationStatus,
      userActive: emp.user?.isActive,
      userLegalHold: emp.user?.legalHold,
      businessDeleted: emp.business.deletedAt != null,
      businessLegalHold: emp.business.legalHold,
    },
    employeeStripeAccount: esa
      ? {
          bankPayoutSchedule: esa.bankPayoutSchedule,
          bankPayoutNextScheduledAt: esa.bankPayoutNextScheduledAt?.toISOString() ?? null,
          bankPayoutNextScheduledAtLocal: esa.bankPayoutNextScheduledAt
            ? DateTime.fromJSDate(esa.bankPayoutNextScheduledAt, { zone: "utc" })
                .setZone(tz)
                .toISO()
            : null,
          stripePayoutsEnabled: esa.stripePayoutsEnabled,
          stripeAccountIdMasked: maskStripe(esa.stripeAccountId),
          createdAt: esa.createdAt.toISOString(),
          updatedAt: esa.updatedAt.toISOString(),
        }
      : null,
    tickEligibilityProbes: tickEligibilityAt,
    scheduledPayoutLedgerAll: ledger.map((r) => ({
      scheduleWindowKey: r.scheduleWindowKey,
      status: r.status,
      failureCode: r.failureCode,
      amountCents: r.amountCents,
      stripePayoutIdMasked: maskStripe(r.stripePayoutId),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    ledgerNearOct8Window: ledgerNearOct8.map((r) => ({
      scheduleWindowKey: r.scheduleWindowKey,
      status: r.status,
      failureCode: r.failureCode,
      amountCents: r.amountCents,
      stripePayoutIdMasked: maskStripe(r.stripePayoutId),
      createdAt: r.createdAt.toISOString(),
    })),
    employeeStripePayoutsRecent: stripePayouts.map((p) => ({
      stripePayoutIdMasked: maskStripe(p.stripePayoutId),
      status: p.status,
      amountCents: p.amountCents,
      stripeCreatedAt: p.stripeCreatedAt.toISOString(),
      lastStripeEventType: p.lastStripeEventType,
      paidAt: p.paidAt?.toISOString() ?? null,
      failedAt: p.failedAt?.toISOString() ?? null,
    })),
    payoutsCreatedOnOct8LocalCalendar: payoutsNearOct8.map((p) => ({
      stripePayoutIdMasked: maskStripe(p.stripePayoutId),
      status: p.status,
      amountCents: p.amountCents,
      stripeCreatedAt: p.stripeCreatedAt.toISOString(),
    })),
    auditScheduleChanges: relevantAudit.map((a) => ({
      createdAt: a.createdAt.toISOString(),
      metadata: a.metadata,
    })),
  });
}

// Business-level for Test Hotel
const businessForensics = [];
for (const b of businesses) {
  const auditBiz = await prisma.auditLog.findMany({
    where: {
      action: "business_bank_payout_schedule_changed",
      metadata: { contains: b.id },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { createdAt: true, metadata: true },
  });
  businessForensics.push({
    businessId: b.id,
    businessIdMasked: mask(b.id),
    name: b.name,
    timezone: b.timezone,
    bankPayoutSchedule: b.bankPayoutSchedule,
    bankPayoutNextScheduledAt: b.bankPayoutNextScheduledAt?.toISOString() ?? null,
    stripePayoutsEnabled: b.stripePayoutsEnabled,
    stripeAccountIdMasked: maskStripe(b.stripeAccountId),
    deletedAt: b.deletedAt?.toISOString() ?? null,
    legalHold: b.legalHold,
    auditScheduleChanges: auditBiz,
  });
}

// Oct 8 09:00 local candidates for common TZ
const oct8Interpretation = {
  note:
    "every_3_days windows are stored as UTC ISO from 09:00 business-local via computeNextEvery3DaysPayoutAt",
  examplesForEuropeBerlin: {
    oct8_9am_berlin_asUtc: DateTime.fromObject(
      { year: 2026, month: 10, day: 8, hour: 9, minute: 0 },
      { zone: "Europe/Berlin" },
    )
      .toUTC()
      .toISO(),
    oct7_9am_berlin_asUtc: DateTime.fromObject(
      { year: 2026, month: 10, day: 7, hour: 9, minute: 0 },
      { zone: "Europe/Berlin" },
    )
      .toUTC()
      .toISO(),
  },
};

console.log(
  JSON.stringify(
    {
      diagnosticAtUtc: diagnosticAt.toISOString(),
      businessesMatchingTestHotel: businessForensics,
      charlineEmployeeCandidates: {
        atTestHotelCount: charlineAtTestHotel.length,
        elsewhereCount: charlineElsewhere.length,
        allCharlineMatches: charlineEmployees.map((e) => ({
          employeeIdMasked: mask(e.id),
          businessIdMasked: mask(e.businessId),
          businessName: e.business.name,
          employeeName: e.name,
        })),
      },
      employeeForensics,
      oct8WindowInterpretation: oct8Interpretation,
      limitations: [
        "Render cron HTTP logs not queried in this run",
        "Stripe API payouts.list not invoked (read-only policy)",
        "Historical bank_payout_next_scheduled_at not in DB except audit metadata",
      ],
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
