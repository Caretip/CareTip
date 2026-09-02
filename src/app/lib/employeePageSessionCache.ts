/**
 * Session-scoped employee secondary-page snapshots (assignment, goals, settings, tip history).
 * In-memory only (pageSessionCache). Never localStorage. Cleared on logout.
 */
import type { EmployeeGoalRow, EmployeeSelfAssignment, TipActivityRow } from "./api";
import {
  getPageSessionCache,
  invalidatePageSessionCacheByPrefix,
  PAGE_CACHE_TTL_LOW_MS,
  setPageSessionCache,
} from "./pageSessionCache";

export const EMPLOYEE_ASSIGNMENT_CACHE_PREFIX = "employee:assignment:";
export const EMPLOYEE_GOALS_CACHE_PREFIX = "employee:goals:";
export const EMPLOYEE_SETTINGS_CACHE_PREFIX = "employee:settings:";
export const EMPLOYEE_TIPS_HISTORY_CACHE_PREFIX = "tips-activity:employee-history:";

export type EmployeeSettingsSnapshot = {
  name: string;
  bio: string;
  businessName: string;
  monthlyGoal: string;
  emailNotif: boolean;
  pushNotif: boolean;
};

export type EmployeeTipsActivitySnapshot = {
  items: TipActivityRow[];
  total: number;
  timezone: string | null;
};

export function employeeAssignmentCacheKey(userId: string): string {
  return `${EMPLOYEE_ASSIGNMENT_CACHE_PREFIX}${userId.trim()}`;
}

export function employeeGoalsCacheKey(userId: string): string {
  return `${EMPLOYEE_GOALS_CACHE_PREFIX}${userId.trim()}`;
}

export function employeeSettingsCacheKey(userId: string): string {
  return `${EMPLOYEE_SETTINGS_CACHE_PREFIX}${userId.trim()}`;
}

/** Default Tip History list key (all / month / first page / empty search). */
export function employeeTipsHistoryDefaultCacheKey(userId: string, role: string): string {
  return `${EMPLOYEE_TIPS_HISTORY_CACHE_PREFIX}${userId.trim()}:${role}:all:month:0:::`;
}

export function readEmployeeAssignmentSnapshot(
  userId: string | null | undefined,
): EmployeeSelfAssignment | null {
  const id = userId?.trim();
  if (!id) return null;
  return getPageSessionCache<EmployeeSelfAssignment>(
    employeeAssignmentCacheKey(id),
    PAGE_CACHE_TTL_LOW_MS,
  );
}

export function writeEmployeeAssignmentSnapshot(
  userId: string,
  assignment: EmployeeSelfAssignment,
): void {
  const id = userId.trim();
  if (!id) return;
  setPageSessionCache(employeeAssignmentCacheKey(id), assignment);
}

export function readEmployeeGoalsSnapshot(userId: string | null | undefined): EmployeeGoalRow[] | null {
  const id = userId?.trim();
  if (!id) return null;
  return getPageSessionCache<EmployeeGoalRow[]>(employeeGoalsCacheKey(id), PAGE_CACHE_TTL_LOW_MS);
}

export function writeEmployeeGoalsSnapshot(userId: string, goals: EmployeeGoalRow[]): void {
  const id = userId.trim();
  if (!id) return;
  setPageSessionCache(employeeGoalsCacheKey(id), goals);
}

export function readEmployeeSettingsSnapshot(
  userId: string | null | undefined,
): EmployeeSettingsSnapshot | null {
  const id = userId?.trim();
  if (!id) return null;
  return getPageSessionCache<EmployeeSettingsSnapshot>(
    employeeSettingsCacheKey(id),
    PAGE_CACHE_TTL_LOW_MS,
  );
}

export function writeEmployeeSettingsSnapshot(
  userId: string,
  snapshot: EmployeeSettingsSnapshot,
): void {
  const id = userId.trim();
  if (!id) return;
  setPageSessionCache(employeeSettingsCacheKey(id), snapshot);
}

export function readEmployeeTipsHistorySnapshot(
  userId: string | null | undefined,
  role: string | null | undefined,
): EmployeeTipsActivitySnapshot | null {
  const id = userId?.trim();
  const r = role?.trim();
  if (!id || !r) return null;
  return getPageSessionCache<EmployeeTipsActivitySnapshot>(
    employeeTipsHistoryDefaultCacheKey(id, r),
    PAGE_CACHE_TTL_LOW_MS,
  );
}

export function clearEmployeePageSessionCache(): void {
  invalidatePageSessionCacheByPrefix(EMPLOYEE_ASSIGNMENT_CACHE_PREFIX);
  invalidatePageSessionCacheByPrefix(EMPLOYEE_GOALS_CACHE_PREFIX);
  invalidatePageSessionCacheByPrefix(EMPLOYEE_SETTINGS_CACHE_PREFIX);
  invalidatePageSessionCacheByPrefix(EMPLOYEE_TIPS_HISTORY_CACHE_PREFIX);
}
