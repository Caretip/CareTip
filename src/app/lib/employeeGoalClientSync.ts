import { invalidatePageSessionCacheByPrefix } from "./pageSessionCache";
import { clearEmployeePeriodSwrStore } from "./employeePeriodSessionCache";
import {
  EMPLOYEE_GOALS_CACHE_PREFIX,
  EMPLOYEE_SETTINGS_CACHE_PREFIX,
} from "./employeePageSessionCache";

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeEmployeeGoalClientInvalidation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Drop Overview/settings/goals session snapshots after an authoritative goal mutation.
 * Does not clear tip history.
 */
export function invalidateEmployeeGoalClientCaches(): void {
  clearEmployeePeriodSwrStore();
  invalidatePageSessionCacheByPrefix(EMPLOYEE_GOALS_CACHE_PREFIX);
  invalidatePageSessionCacheByPrefix(EMPLOYEE_SETTINGS_CACHE_PREFIX);
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // isolate subscriber failures
    }
  }
}
