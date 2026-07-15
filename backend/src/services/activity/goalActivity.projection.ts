import { ActivityEventSource, EmployeeGoalStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { sanitizeIanaTimezone } from "../../utils/businessTime.js";
import {
  ACTIVITY_EVENT_TYPES,
  projectBusinessActivityEvent,
} from "./businessActivityEvent.service.js";
import { scheduleIsolatedActivityWork } from "./activityProjection.isolation.js";
import { effectivePeriodBounds } from "../goal.service.js";

export type TipGoalAchievementContext = {
  tipId: string;
  tipAmount: number;
  tipCreatedAt: Date;
  employeeId: string;
  employeeName: string;
  businessId: string;
};

/**
 * After tip success commit: detect newly crossed active EmployeeGoal thresholds
 * and project goal.achieved (period-scoped dedupe). Isolated — never throws out.
 */
export function scheduleGoalAchievedProjectionsForTip(ctx: TipGoalAchievementContext): void {
  scheduleIsolatedActivityWork(
    "goal.achieved",
    () => evaluateAndProjectGoalAchievements(ctx),
    {
      tipId: ctx.tipId,
      employeeId: ctx.employeeId,
      businessId: ctx.businessId,
    },
  );
}

async function evaluateAndProjectGoalAchievements(ctx: TipGoalAchievementContext): Promise<void> {
  const tipAmount = Number(ctx.tipAmount);
  if (!(tipAmount > 0)) return;

  const employee = await prisma.employee.findFirst({
    where: { id: ctx.employeeId, businessId: ctx.businessId },
    select: {
      name: true,
      business: { select: { timezone: true } },
    },
  });
  if (!employee) return;

  const tz = sanitizeIanaTimezone(employee.business.timezone);
  const now = ctx.tipCreatedAt;

  const goals = await prisma.employeeGoal.findMany({
    where: {
      employeeId: ctx.employeeId,
      status: EmployeeGoalStatus.active,
    },
    select: {
      id: true,
      name: true,
      goalAmount: true,
      goalPeriod: true,
      startDate: true,
    },
  });

  if (goals.length === 0) return;

  const employeeName = ctx.employeeName || employee.name;

  for (const goal of goals) {
    const goalAmount = Number(goal.goalAmount);
    if (!(goalAmount > 0)) continue;

    const { start, end } = effectivePeriodBounds(goal.goalPeriod, goal.startDate, now, tz);
    const agg = await prisma.transaction.aggregate({
      where: {
        employeeId: ctx.employeeId,
        status: "success",
        createdAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
    });
    const current = agg._sum.amount != null ? Number(agg._sum.amount) : 0;
    const before = current - tipAmount;
    const crossed = current >= goalAmount && before < goalAmount;
    if (!crossed) continue;

    const periodStartIso = start.toISOString();
    projectBusinessActivityEvent({
      businessId: ctx.businessId,
      type: ACTIVITY_EVENT_TYPES.GOAL_ACHIEVED,
      source: ActivityEventSource.GOALS,
      occurredAt: ctx.tipCreatedAt,
      dedupeKey: `goal:${goal.id}:achieved:${periodStartIso}`,
      subjectType: "goal",
      subjectId: goal.id,
      actorEmployeeId: ctx.employeeId,
      summary: {
        goalId: goal.id,
        goalName: goal.name,
        goalAmount,
        currentAmount: current,
        goalPeriod: goal.goalPeriod,
        employeeName,
        tipId: ctx.tipId,
      },
    });
  }
}
