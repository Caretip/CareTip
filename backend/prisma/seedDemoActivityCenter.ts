/**
 * Seed Activity Center rows for the primary walkthrough venue (demo@caretip.de).
 * Idempotent: replaces demo-keyed synthetic events; tip rows use canonical tip:{id}:received.
 */
import {
  ActivityEventPriority,
  ActivityEventSource,
  type PrismaClient,
} from "@prisma/client";
import { DEMO_MANAGER_EMAIL } from "./seedDemoEnvironment.js";

const DEMO_DEDUPE_PREFIX = "demo:activity:";

type SeedRow = {
  type: string;
  source: ActivityEventSource;
  priority: ActivityEventPriority;
  occurredAt: Date;
  dedupeKey: string;
  subjectType?: string;
  subjectId?: string;
  actorEmployeeId?: string | null;
  locationId?: string | null;
  tableId?: string | null;
  summary: Record<string, unknown>;
};

function minutesAgoDate(minutes: number): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() - minutes);
  return d;
}

export async function seedDemoActivityCenter(prisma: PrismaClient): Promise<number> {
  const manager = await prisma.user.findUnique({
    where: { email: DEMO_MANAGER_EMAIL },
    select: {
      id: true,
      business: {
        select: {
          id: true,
          employees: {
            where: { deletedAt: null },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
            take: 5,
          },
          locations: {
            select: { id: true, name: true },
            take: 2,
          },
        },
      },
    },
  });

  const business = manager?.business;
  if (!business) {
    console.warn(`[seedDemoActivityCenter] No business for ${DEMO_MANAGER_EMAIL}; skipped.`);
    return 0;
  }

  const staff = business.employees;
  const loc = business.locations[0] ?? null;
  const emp0 = staff[0];
  const emp1 = staff[1] ?? emp0;
  const emp2 = staff[2] ?? emp0;
  if (!emp0) {
    console.warn("[seedDemoActivityCenter] No employees; skipped.");
    return 0;
  }

  const tips = await prisma.transaction.findMany({
    where: { businessId: business.id, status: "success" },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      amount: true,
      createdAt: true,
      employeeId: true,
      employee: { select: { name: true } },
      locationId: true,
      tableId: true,
    },
  });

  const goals = await prisma.employeeGoal.findMany({
    where: {
      employeeId: { in: staff.map((e) => e.id) },
      status: "active",
    },
    take: 3,
    select: { id: true, name: true, goalAmount: true, goalPeriod: true, employeeId: true },
  });

  await prisma.businessActivityEvent.deleteMany({
    where: {
      businessId: business.id,
      dedupeKey: { startsWith: DEMO_DEDUPE_PREFIX },
    },
  });

  const rows: SeedRow[] = [];

  for (const [i, tip] of tips.entries()) {
    rows.push({
      type: "tip.received",
      source: ActivityEventSource.TIPS,
      priority: ActivityEventPriority.NORMAL,
      occurredAt: tip.createdAt,
      dedupeKey: `tip:${tip.id}:received`,
      subjectType: "tip",
      subjectId: tip.id,
      actorEmployeeId: tip.employeeId,
      locationId: tip.locationId,
      tableId: tip.tableId,
      summary: {
        amountEur: Number(tip.amount),
        employeeName: tip.employee?.name ?? emp0.name,
        customerName: null,
        status: "success",
      },
    });
    if (i >= 11) break;
  }

  const scanSpecs = [
    { minutesAgo: 7, scanType: "employee", emp: emp0 },
    { minutesAgo: 22, scanType: "table", emp: emp1 },
    { minutesAgo: 55, scanType: "location", emp: emp2 },
    { minutesAgo: 95, scanType: "employee", emp: emp1 },
  ];
  for (const [i, s] of scanSpecs.entries()) {
    const scanId = `demo_scan_${i + 1}`;
    rows.push({
      type: "qr.scanned",
      source: ActivityEventSource.QR,
      priority: ActivityEventPriority.NORMAL,
      occurredAt: minutesAgoDate(s.minutesAgo),
      dedupeKey: `${DEMO_DEDUPE_PREFIX}scan:${scanId}`,
      subjectType: "scan",
      subjectId: scanId,
      actorEmployeeId: s.emp?.id ?? emp0.id,
      locationId: loc?.id ?? null,
      summary: {
        scanType: s.scanType,
        deviceType: "mobile",
        employeeName: s.emp?.name ?? emp0.name,
      },
    });
  }

  for (const [i, g] of goals.entries()) {
    rows.push({
      type: "goal.achieved",
      source: ActivityEventSource.GOALS,
      priority: ActivityEventPriority.HIGH,
      occurredAt: minutesAgoDate(40 + i * 30),
      dedupeKey: `${DEMO_DEDUPE_PREFIX}goal:${g.id}:achieved`,
      subjectType: "goal",
      subjectId: g.id,
      actorEmployeeId: g.employeeId,
      summary: {
        goalId: g.id,
        goalName: g.name,
        goalAmount: Number(g.goalAmount),
        currentAmount: Number(g.goalAmount),
        goalPeriod: g.goalPeriod,
        employeeName: staff.find((e) => e.id === g.employeeId)?.name ?? emp0.name,
      },
    });
  }
  if (goals.length === 0) {
    rows.push({
      type: "goal.achieved",
      source: ActivityEventSource.GOALS,
      priority: ActivityEventPriority.HIGH,
      occurredAt: minutesAgoDate(48),
      dedupeKey: `${DEMO_DEDUPE_PREFIX}goal:demo:achieved`,
      subjectType: "goal",
      subjectId: "demo_goal",
      actorEmployeeId: emp0.id,
      summary: {
        goalName: "Monthly tip goal",
        goalAmount: 650,
        currentAmount: 650,
        goalPeriod: "monthly",
        employeeName: emp0.name,
      },
    });
  }

  rows.push({
    type: "employee.invited",
    source: ActivityEventSource.STAFF,
    priority: ActivityEventPriority.LOW,
    occurredAt: minutesAgoDate(180),
    dedupeKey: `${DEMO_DEDUPE_PREFIX}invite:code`,
    subjectType: "invite",
    subjectId: "demo_invite",
    summary: {
      channel: "code",
      inviteCode: "WDEM42",
    },
  });
  rows.push({
    type: "employee.joined",
    source: ActivityEventSource.STAFF,
    priority: ActivityEventPriority.LOW,
    occurredAt: minutesAgoDate(160),
    dedupeKey: `${DEMO_DEDUPE_PREFIX}joined:${emp0.id}`,
    subjectType: "employee",
    subjectId: emp0.id,
    actorEmployeeId: emp0.id,
    summary: {
      employeeName: emp0.name,
      employeeEmail: "employee@caretip.de",
      channel: "activate",
    },
  });
  if (emp1) {
    rows.push({
      type: "employee.invited",
      source: ActivityEventSource.STAFF,
      priority: ActivityEventPriority.LOW,
      occurredAt: minutesAgoDate(300),
      dedupeKey: `${DEMO_DEDUPE_PREFIX}invite:email:${emp1.id}`,
      subjectType: "employee",
      subjectId: emp1.id,
      summary: {
        channel: "email",
        employeeName: emp1.name,
        employeeEmail: "anna.staff.demo@caretip.de",
      },
    });
  }

  rows.push({
    type: "payment.refunded",
    source: ActivityEventSource.PAYMENTS,
    priority: ActivityEventPriority.HIGH,
    occurredAt: minutesAgoDate(70),
    dedupeKey: `${DEMO_DEDUPE_PREFIX}refund:demo1`,
    subjectType: "tip",
    subjectId: "demo_refund_tip",
    actorEmployeeId: emp0.id,
    summary: {
      amountEur: 12,
      employeeName: emp0.name,
      reason: "eligibility_failure",
      paymentIntentId: "pi_demo_refund",
      refundId: "re_demo_1",
    },
  });
  rows.push({
    type: "payment.failed",
    source: ActivityEventSource.PAYMENTS,
    priority: ActivityEventPriority.HIGH,
    occurredAt: minutesAgoDate(110),
    dedupeKey: `${DEMO_DEDUPE_PREFIX}failed:demo1`,
    subjectType: "tip",
    subjectId: "demo_fail_tip",
    actorEmployeeId: emp1?.id ?? emp0.id,
    summary: {
      amountEur: 8.5,
      employeeName: (emp1 ?? emp0).name,
      reason: "payment_intent_failed",
      paymentIntentId: "pi_demo_fail",
    },
  });

  let inserted = 0;
  for (const row of rows) {
    try {
      await prisma.businessActivityEvent.create({
        data: {
          businessId: business.id,
          type: row.type,
          source: row.source,
          priority: row.priority,
          occurredAt: row.occurredAt,
          dedupeKey: row.dedupeKey.slice(0, 191),
          summary: row.summary,
          subjectType: row.subjectType ?? null,
          subjectId: row.subjectId ?? null,
          actorEmployeeId: row.actorEmployeeId ?? null,
          locationId: row.locationId ?? null,
          tableId: row.tableId ?? null,
        },
      });
      inserted += 1;
    } catch {
      // Unique conflict (already projected) — skip
    }
  }

  console.log(`[seedDemoActivityCenter] ${inserted} events for ${DEMO_MANAGER_EMAIL} (${business.id})`);
  return inserted;
}
