import { GoalPeriod } from "@prisma/client";

export type ActiveGoalMirrorRow = {
  goalAmount: unknown;
  goalPeriod: GoalPeriod;
  updatedAt: Date;
};

/**
 * Legacy `employees.monthly_goal` mirror. Authoritative rows live in `employee_goals`.
 * Prefer the latest active monthly goal; otherwise the latest active goal of any period.
 */
export function selectMonthlyGoalMirrorAmount(rows: ActiveGoalMirrorRow[]): number | null {
  if (rows.length === 0) return null;
  const monthly = rows.filter((r) => r.goalPeriod === "monthly");
  const pool = monthly.length > 0 ? monthly : rows;
  const latest = [...pool].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const n = Number(latest?.goalAmount);
  return Number.isFinite(n) ? n : null;
}
