/**
 * Read-only scheduled bank payout diagnostic. SELECT-only via Prisma.
 * DELETE after use — not for commit unless team wants to keep it.
 */
import "../src/loadEnv.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/prisma.js";

function maskStripeId(id) {
  if (!id || typeof id !== "string") return null;
  const t = id.trim();
  if (t.length <= 8) return "***";
  return `${t.slice(0, 5)}…${t.slice(-4)}`;
}

function scheduleWindowKeyFromDate(d) {
  return d.toISOString();
}

async function main() {
  const now = new Date();
  const dueBusinesses = await prisma.business.findMany({
    where: {
      bankPayoutSchedule: "every_3_days",
      bankPayoutNextScheduledAt: { lte: now },
      deletedAt: null,
      legalHold: false,
      stripeAccountId: { not: null },
      stripePayoutsEnabled: true,
    },
    select: {
      id: true,
      bankPayoutSchedule: true,
      bankPayoutNextScheduledAt: true,
      stripeAccountId: true,
      stripePayoutsEnabled: true,
      deletedAt: true,
      legalHold: true,
      timezone: true,
    },
    take: 50,
    orderBy: { bankPayoutNextScheduledAt: "asc" },
  });

  const businessDiagnostics = [];
  for (const b of dueBusinesses) {
    const dueAt = b.bankPayoutNextScheduledAt;
    const windowKey = dueAt ? scheduleWindowKeyFromDate(dueAt) : null;
    const ledger = windowKey
      ? await prisma.stripeConnectScheduledPayoutRequest.findUnique({
          where: {
            businessId_scheduleWindowKey: { businessId: b.id, scheduleWindowKey: windowKey },
          },
          select: {
            status: true,
            failureCode: true,
            scheduleWindowKey: true,
            amountCents: true,
            stripePayoutId: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : null;
    const recentLedger = await prisma.stripeConnectScheduledPayoutRequest.findMany({
      where: { businessId: b.id },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        status: true,
        failureCode: true,
        scheduleWindowKey: true,
        amountCents: true,
        stripePayoutId: true,
        createdAt: true,
      },
    });
    businessDiagnostics.push({
      businessId: b.id,
      bankPayoutSchedule: b.bankPayoutSchedule,
      bankPayoutNextScheduledAt: dueAt?.toISOString() ?? null,
      scheduleWindowKey: windowKey,
      stripeAccountIdMasked: maskStripeId(b.stripeAccountId),
      stripePayoutsEnabled: b.stripePayoutsEnabled,
      deletedAt: b.deletedAt?.toISOString() ?? null,
      legalHold: b.legalHold,
      timezone: b.timezone,
      ledgerForCurrentWindow: ledger
        ? {
            status: ledger.status,
            failureCode: ledger.failureCode,
            scheduleWindowKey: ledger.scheduleWindowKey,
            amountCents: ledger.amountCents,
            stripePayoutIdMasked: maskStripeId(ledger.stripePayoutId),
            createdAt: ledger.createdAt.toISOString(),
            updatedAt: ledger.updatedAt.toISOString(),
          }
        : null,
      recentLedgerRows: recentLedger.map((r) => ({
        status: r.status,
        failureCode: r.failureCode,
        scheduleWindowKey: r.scheduleWindowKey,
        amountCents: r.amountCents,
        stripePayoutIdMasked: maskStripeId(r.stripePayoutId),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }

  const dueEmployees = await prisma.employeeStripeAccount.findMany({
    where: {
      bankPayoutSchedule: "every_3_days",
      bankPayoutNextScheduledAt: { lte: now },
      stripePayoutsEnabled: true,
      employee: {
        isDeleted: false,
        isActive: true,
        activationStatus: "active",
        user: { isActive: true, legalHold: false },
        business: { deletedAt: null, legalHold: false },
      },
    },
    select: { employeeId: true },
    take: 50,
  });

  const employeeCandidates = await prisma.employeeStripeAccount.findMany({
    where: {
      employee: {
        businessId: { in: dueBusinesses.map((b) => b.id) },
      },
    },
    select: {
      employeeId: true,
      bankPayoutSchedule: true,
      bankPayoutNextScheduledAt: true,
      stripeAccountId: true,
      stripePayoutsEnabled: true,
      employee: {
        select: {
          businessId: true,
          isDeleted: true,
          isActive: true,
          activationStatus: true,
          user: { select: { isActive: true, legalHold: true } },
          business: { select: { deletedAt: true, legalHold: true } },
        },
      },
    },
    take: 100,
  });

  const employeeDiagnostics = employeeCandidates.map((row) => {
    const emp = row.employee;
    const dueAt = row.bankPayoutNextScheduledAt;
    const isDue =
      row.bankPayoutSchedule === "every_3_days" &&
      dueAt != null &&
      dueAt.getTime() <= now.getTime();
    const tickWouldSelect =
      row.bankPayoutSchedule === "every_3_days" &&
      dueAt != null &&
      dueAt.getTime() <= now.getTime() &&
      row.stripePayoutsEnabled === true &&
      !emp.isDeleted &&
      emp.isActive &&
      emp.activationStatus === "active" &&
      emp.user?.isActive === true &&
      !emp.user?.legalHold &&
      emp.business.deletedAt == null &&
      !emp.business.legalHold;

    const blockers = [];
    if (!row.bankPayoutSchedule || row.bankPayoutSchedule !== "every_3_days") {
      blockers.push("schedule_not_every_3_days");
    }
    if (!dueAt) blockers.push("bank_payout_next_scheduled_at_null");
    else if (dueAt.getTime() > now.getTime()) blockers.push("not_due_yet");
    if (!row.stripePayoutsEnabled) blockers.push("stripe_payouts_disabled");
    if (!row.stripeAccountId?.trim()) blockers.push("missing_stripe_account_id");
    if (emp.isDeleted) blockers.push("employee_deleted");
    if (!emp.isActive) blockers.push("employee_inactive");
    if (emp.activationStatus !== "active") blockers.push(`activation_${emp.activationStatus}`);
    if (!emp.user?.isActive) blockers.push("user_inactive");
    if (emp.user?.legalHold) blockers.push("user_legal_hold");
    if (emp.business.deletedAt) blockers.push("business_deleted");
    if (emp.business.legalHold) blockers.push("business_legal_hold");

    return {
      employeeId: row.employeeId,
      businessId: emp.businessId,
      bankPayoutSchedule: row.bankPayoutSchedule,
      bankPayoutNextScheduledAt: dueAt?.toISOString() ?? null,
      stripeAccountIdMasked: maskStripeId(row.stripeAccountId),
      stripePayoutsEnabled: row.stripePayoutsEnabled,
      isDueByTimestamp: isDue,
      tickQueryWouldSelect: tickWouldSelect,
      eligibilityBlockers: blockers.length ? blockers : ["none_tick_eligible_if_due"],
    };
  });

  console.log(
    JSON.stringify(
      {
        diagnosticAtUtc: now.toISOString(),
        cronBusinessDueCount: dueBusinesses.length,
        cronEmployeeDueCount: dueEmployees.length,
        investigationA_dueBusinesses: businessDiagnostics,
        investigationB_employeesLinkedToDueBusinesses: employeeDiagnostics,
        note:
          "Stripe pending payout status requires Stripe API or Dashboard; not queried here.",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 400) }));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
