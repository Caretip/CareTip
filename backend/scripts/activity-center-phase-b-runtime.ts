/**
 * Activity Center Phase B — verification runtime.
 * Run: npm run test:activity-center-phase-b
 *
 * Covers: goal.achieved, payment.failed, payment.refunded,
 * employee.invited, employee.joined — dedupe, isolation, payload shape.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { ActivityEventSource, GoalPeriod } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { signAuthJwt } from "../src/services/auth.service.js";
import {
  ACTIVITY_EVENT_TYPES,
  listBusinessActivityEvents,
  writeBusinessActivityEvent,
} from "../src/services/activity/businessActivityEvent.service.js";
import { scheduleGoalAchievedProjectionsForTip } from "../src/services/activity/goalActivity.projection.js";
import {
  schedulePaymentFailedAfterPendingUpdate,
  schedulePaymentRefundedProjection,
} from "../src/services/activity/paymentActivity.projection.js";
import {
  scheduleEmployeeInvitedCodeProjection,
  scheduleEmployeeInvitedEmailProjection,
  scheduleEmployeeJoinedProjection,
} from "../src/services/activity/staffActivity.helpers.js";
import {
  REALTIME_EVENTS,
  emitActivityCreatedCanonical,
} from "../src/socket/realtimeContracts.js";
import { scheduleIsolatedActivityWork } from "../src/services/activity/activityProjection.isolation.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  pred: () => Promise<boolean>,
  label: string,
  timeoutMs = 8000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return true;
    await sleep(100);
  }
  fail(`timeout waiting: ${label}`);
  return false;
}

async function seedBusiness(label: string) {
  const tag = `actb-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const manager = await prisma.user.create({
    data: {
      email: `${tag}-mgr@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      onboardingCompletedAt: new Date(),
      business: {
        create: {
          name: `${label} Venue`,
          slug: `${tag}-venue`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
          timezone: "Europe/Berlin",
        },
      },
    },
    include: { business: true },
  });
  const empUser = await prisma.user.create({
    data: {
      email: `${tag}-emp@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      employee: {
        create: {
          name: `${label} Staff`,
          slug: `${tag}-staff`,
          jobTitle: "Host",
          businessId: manager.business!.id,
          isActive: true,
          activationStatus: "active",
        },
      },
    },
    include: { employee: true },
  });
  return {
    tag,
    managerId: manager.id,
    businessId: manager.business!.id,
    employeeId: empUser.employee!.id,
    employeeName: empUser.employee!.name,
    employeeEmail: empUser.email,
    token: signAuthJwt({
      userId: manager.id,
      id: manager.id,
      email: manager.email,
      role: "MANAGER",
      roleLabel: "MANAGER",
    }),
    cleanup: async () => {
      await prisma.businessActivityEvent.deleteMany({ where: { businessId: manager.business!.id } });
      await prisma.transaction.deleteMany({ where: { businessId: manager.business!.id } });
      await prisma.employeeGoal.deleteMany({ where: { employeeId: empUser.employee!.id } });
      await prisma.employeeInvite.deleteMany({ where: { businessId: manager.business!.id } });
      await prisma.employee.deleteMany({ where: { businessId: manager.business!.id } });
      await prisma.business.delete({ where: { id: manager.business!.id } });
      await prisma.user.deleteMany({ where: { id: { in: [manager.id, empUser.id] } } });
    },
  };
}

async function countType(businessId: string, type: string, dedupeKey?: string) {
  return prisma.businessActivityEvent.count({
    where: {
      businessId,
      type,
      ...(dedupeKey ? { dedupeKey } : {}),
    },
  });
}

async function main() {
  console.log("Activity Center Phase B verification…");
  let a: Awaited<ReturnType<typeof seedBusiness>> | null = null;
  let b: Awaited<ReturnType<typeof seedBusiness>> | null = null;

  try {
    a = await seedBusiness("A");
    b = await seedBusiness("B");

    // --- Isolation wrapper never throws ---
    let isolationThrew = false;
    try {
      scheduleIsolatedActivityWork("test.throw", async () => {
        throw new Error("intentional projection failure");
      });
      await sleep(200);
    } catch {
      isolationThrew = true;
    }
    if (!isolationThrew) pass("isolation wrapper swallows projection errors");
    else fail("isolation wrapper swallows projection errors");

    // --- goal.achieved ---
    const goal = await prisma.employeeGoal.create({
      data: {
        employeeId: a.employeeId,
        name: "Month target",
        goalAmount: 10,
        goalPeriod: GoalPeriod.monthly,
        status: "active",
        startDate: new Date(),
      },
    });

    const tipBelow = await prisma.transaction.create({
      data: {
        amount: 4,
        status: "success",
        employeeId: a.employeeId,
        businessId: a.businessId,
        stripePaymentIntentId: `pi_goal_below_${a.tag}`,
      },
    });

    scheduleGoalAchievedProjectionsForTip({
      tipId: tipBelow.id,
      tipAmount: 4,
      tipCreatedAt: tipBelow.createdAt,
      employeeId: a.employeeId,
      employeeName: a.employeeName,
      businessId: a.businessId,
    });
    await sleep(600);
    if ((await countType(a.businessId, ACTIVITY_EVENT_TYPES.GOAL_ACHIEVED)) === 0) {
      pass("goal.achieved not emitted below threshold");
    } else {
      fail("goal.achieved not emitted below threshold");
    }

    const tipCross = await prisma.transaction.create({
      data: {
        amount: 7,
        status: "success",
        employeeId: a.employeeId,
        businessId: a.businessId,
        stripePaymentIntentId: `pi_goal_cross_${a.tag}`,
      },
    });
    scheduleGoalAchievedProjectionsForTip({
      tipId: tipCross.id,
      tipAmount: 7,
      tipCreatedAt: tipCross.createdAt,
      employeeId: a.employeeId,
      employeeName: a.employeeName,
      businessId: a.businessId,
    });
    const crossed = await waitFor(
      async () => (await countType(a!.businessId, ACTIVITY_EVENT_TYPES.GOAL_ACHIEVED)) === 1,
      "goal.achieved after cross",
    );
    if (crossed) pass("goal.achieved emitted on threshold cross");

    scheduleGoalAchievedProjectionsForTip({
      tipId: tipCross.id,
      tipAmount: 7,
      tipCreatedAt: tipCross.createdAt,
      employeeId: a.employeeId,
      employeeName: a.employeeName,
      businessId: a.businessId,
    });
    await sleep(500);
    if ((await countType(a.businessId, ACTIVITY_EVENT_TYPES.GOAL_ACHIEVED)) === 1) {
      pass("goal.achieved deduped for same period");
    } else {
      fail("goal.achieved deduped for same period");
    }

    const goalRow = await prisma.businessActivityEvent.findFirst({
      where: { businessId: a.businessId, type: ACTIVITY_EVENT_TYPES.GOAL_ACHIEVED },
    });
    if (
      goalRow?.source === ActivityEventSource.GOALS &&
      goalRow.priority === "HIGH" &&
      goalRow.subjectType === "goal" &&
      goalRow.subjectId === goal.id
    ) {
      pass("goal.achieved payload fields");
    } else {
      fail("goal.achieved payload fields");
    }
    if (goalRow) {
      const env = emitActivityCreatedCanonical(a.businessId, {
        id: goalRow.id,
        type: goalRow.type,
        source: goalRow.source,
        priority: goalRow.priority,
      });
      if (env.event === REALTIME_EVENTS.ACTIVITY_CREATED) pass("goal activity.created envelope");
      else fail("goal activity.created envelope");
    }

    // second tip same period while already above — no new event
    const tipAbove = await prisma.transaction.create({
      data: {
        amount: 3,
        status: "success",
        employeeId: a.employeeId,
        businessId: a.businessId,
        stripePaymentIntentId: `pi_goal_above_${a.tag}`,
      },
    });
    scheduleGoalAchievedProjectionsForTip({
      tipId: tipAbove.id,
      tipAmount: 3,
      tipCreatedAt: tipAbove.createdAt,
      employeeId: a.employeeId,
      employeeName: a.employeeName,
      businessId: a.businessId,
    });
    await sleep(500);
    if ((await countType(a.businessId, ACTIVITY_EVENT_TYPES.GOAL_ACHIEVED)) === 1) {
      pass("goal.achieved not re-emitted when already above");
    } else {
      fail("goal.achieved not re-emitted when already above");
    }

    // --- payment.failed ---
    const pendingTip = await prisma.transaction.create({
      data: {
        amount: 12,
        status: "pending",
        employeeId: a.employeeId,
        businessId: a.businessId,
        stripePaymentIntentId: `pi_fail_${a.tag}`,
      },
    });
    const failUpdate = await prisma.transaction.updateMany({
      where: { id: pendingTip.id, status: "pending" },
      data: { status: "failed" },
    });
    schedulePaymentFailedAfterPendingUpdate(`pi_fail_${a.tag}`, failUpdate.count);
    const failedOk = await waitFor(
      async () =>
        (await countType(a!.businessId, ACTIVITY_EVENT_TYPES.PAYMENT_FAILED, `pi:pi_fail_${a!.tag}:failed`)) ===
        1,
      "payment.failed insert",
    );
    if (failedOk) pass("payment.failed projected after pending→failed");

    schedulePaymentFailedAfterPendingUpdate(`pi_fail_${a.tag}`, 1);
    await sleep(400);
    if (
      (await countType(a.businessId, ACTIVITY_EVENT_TYPES.PAYMENT_FAILED, `pi:pi_fail_${a.tag}:failed`)) === 1
    ) {
      pass("payment.failed deduped on retry");
    } else {
      fail("payment.failed deduped on retry");
    }

    schedulePaymentFailedAfterPendingUpdate(`pi_missing_${a.tag}`, 0);
    await sleep(300);
    if ((await countType(a.businessId, ACTIVITY_EVENT_TYPES.PAYMENT_FAILED)) === 1) {
      pass("payment.failed skipped when update count 0");
    } else {
      fail("payment.failed skipped when update count 0");
    }

    // --- payment.refunded (no twin failed) ---
    const refundTip = await prisma.transaction.create({
      data: {
        amount: 15,
        status: "failed",
        employeeId: a.employeeId,
        businessId: a.businessId,
        stripePaymentIntentId: `pi_ref_${a.tag}`,
      },
    });
    const refundId = `re_test_${a.tag}`;
    schedulePaymentRefundedProjection({
      paymentIntentId: `pi_ref_${a.tag}`,
      refundId,
      transactionId: refundTip.id,
      businessId: a.businessId,
      employeeId: a.employeeId,
      amountEur: 15,
      employeeName: a.employeeName,
    });
    const refOk = await waitFor(
      async () =>
        (await countType(a!.businessId, ACTIVITY_EVENT_TYPES.PAYMENT_REFUNDED, `refund:${refundId}`)) === 1,
      "payment.refunded insert",
    );
    if (refOk) pass("payment.refunded projected");

    schedulePaymentRefundedProjection({
      paymentIntentId: `pi_ref_${a.tag}`,
      refundId,
      transactionId: refundTip.id,
      businessId: a.businessId,
      employeeId: a.employeeId,
      amountEur: 15,
      employeeName: a.employeeName,
    });
    await sleep(300);
    if ((await countType(a.businessId, ACTIVITY_EVENT_TYPES.PAYMENT_REFUNDED)) === 1) {
      pass("payment.refunded deduped");
    } else {
      fail("payment.refunded deduped");
    }

    // eligibility twin rule: refund path must not require a payment.failed for same PI
    const twinFailed = await countType(
      a.businessId,
      ACTIVITY_EVENT_TYPES.PAYMENT_FAILED,
      `pi:pi_ref_${a.tag}:failed`,
    );
    if (twinFailed === 0) pass("eligibility refund has no payment.failed twin");
    else fail("eligibility refund has no payment.failed twin");

    // --- employee.invited ---
    const inviteId = `inv_${a.tag}`;
    scheduleEmployeeInvitedCodeProjection({
      businessId: a.businessId,
      inviteId,
      inviteCode: "ABCD1234",
      expiresAt: new Date(Date.now() + 86400000),
      actorUserId: a.managerId,
    });
    scheduleEmployeeInvitedEmailProjection({
      businessId: a.businessId,
      employeeId: a.employeeId,
      employeeName: a.employeeName,
      employeeEmail: a.employeeEmail,
      actorUserId: a.managerId,
    });
    await waitFor(
      async () => (await countType(a!.businessId, ACTIVITY_EVENT_TYPES.EMPLOYEE_INVITED)) === 2,
      "employee.invited both tracks",
    );
    if ((await countType(a.businessId, ACTIVITY_EVENT_TYPES.EMPLOYEE_INVITED)) === 2) {
      pass("employee.invited code + email tracks");
    } else {
      fail("employee.invited code + email tracks");
    }
    scheduleEmployeeInvitedCodeProjection({
      businessId: a.businessId,
      inviteId,
      inviteCode: "ABCD1234",
      expiresAt: new Date(Date.now() + 86400000),
      actorUserId: a.managerId,
    });
    await sleep(300);
    if ((await countType(a.businessId, ACTIVITY_EVENT_TYPES.EMPLOYEE_INVITED)) === 2) {
      pass("employee.invited deduped");
    } else {
      fail("employee.invited deduped");
    }

    // --- employee.joined ---
    scheduleEmployeeJoinedProjection({
      businessId: a.businessId,
      employeeId: a.employeeId,
      employeeName: a.employeeName,
      employeeEmail: a.employeeEmail,
      channel: "activate",
    });
    await waitFor(
      async () =>
        (await countType(a!.businessId, ACTIVITY_EVENT_TYPES.EMPLOYEE_JOINED, `employee:${a!.employeeId}:joined`)) ===
        1,
      "employee.joined insert",
    );
    scheduleEmployeeJoinedProjection({
      businessId: a.businessId,
      employeeId: a.employeeId,
      employeeName: a.employeeName,
      employeeEmail: a.employeeEmail,
      channel: "email_verify",
    });
    await sleep(300);
    if (
      (await countType(a.businessId, ACTIVITY_EVENT_TYPES.EMPLOYEE_JOINED, `employee:${a.employeeId}:joined`)) ===
      1
    ) {
      pass("employee.joined deduped across channels");
    } else {
      fail("employee.joined deduped across channels");
    }

    // --- tenant isolation ---
    writeBusinessActivityEvent({
      businessId: b.businessId,
      type: ACTIVITY_EVENT_TYPES.EMPLOYEE_JOINED,
      source: ActivityEventSource.STAFF,
      occurredAt: new Date(),
      dedupeKey: `employee:secret-b:joined`,
      summary: { employeeName: "SecretB" },
      subjectType: "employee",
      subjectId: "secret-b",
    });
    await sleep(200);
    const listA = await listBusinessActivityEvents(a.businessId, { limit: 100 });
    const leaked = listA.items.some((i) => i.params.employeeName === "SecretB");
    if (!leaked) pass("tenant isolation list service");
    else fail("tenant isolation list service");

    const listB = await listBusinessActivityEvents(b.businessId, {
      source: ActivityEventSource.STAFF,
    });
    if (listB.items.every((i) => i.source === ActivityEventSource.STAFF)) {
      pass("source filter STAFF on Phase B events");
    } else {
      fail("source filter STAFF on Phase B events");
    }
  } catch (err) {
    fail(`unexpected: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (a) await a.cleanup().catch(() => undefined);
    if (b) await b.cleanup().catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log("\n--- Results ---");
  for (const line of results) console.log(line);
  const failed = results.filter((r) => r.startsWith("FAIL:")).length;
  if (failed > 0) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\nAll Phase B checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
