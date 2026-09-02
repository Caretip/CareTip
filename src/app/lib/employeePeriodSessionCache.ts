/**
 * Session-scoped employee overview period snapshot.
 * Survives lazy-route remounts (sidebar clicks). In-memory only — never localStorage.
 * Cleared on logout via resetAllClientSessionCaches.
 */
import { createDashboardSwrStore } from "./dashboardSwrCache";

export type EmployeePeriodTimeframe = "today" | "week" | "month";

export type EmployeePeriodSwrEntry = {
  summary: Record<string, unknown>;
  analytics: Record<string, unknown>;
  payload: Record<string, unknown>;
  at: number;
};

const store = createDashboardSwrStore<EmployeePeriodSwrEntry>();

let lastTimeframe: EmployeePeriodTimeframe = "today";
let liveSettled = false;

export function employeePeriodSwrKey(tf: EmployeePeriodTimeframe): string {
  return `employee:period:${tf}`;
}

export function getEmployeePeriodLastTimeframe(): EmployeePeriodTimeframe {
  return lastTimeframe;
}

export function setEmployeePeriodLastTimeframe(tf: EmployeePeriodTimeframe): void {
  lastTimeframe = tf;
}

export function isEmployeePeriodLiveSettled(): boolean {
  return liveSettled;
}

export function markEmployeePeriodLiveSettled(): void {
  liveSettled = true;
}

export function peekEmployeePeriodSnapshot(
  tf: EmployeePeriodTimeframe,
): EmployeePeriodSwrEntry | null {
  return store.peek(employeePeriodSwrKey(tf));
}

export function getEmployeePeriodSnapshot(
  tf: EmployeePeriodTimeframe,
  ttlMs: number,
): EmployeePeriodSwrEntry | null {
  return store.get(employeePeriodSwrKey(tf), ttlMs);
}

export function writeEmployeePeriodSnapshot(
  tf: EmployeePeriodTimeframe,
  entry: Omit<EmployeePeriodSwrEntry, "at">,
): void {
  store.set(employeePeriodSwrKey(tf), { ...entry, at: Date.now() });
  liveSettled = true;
  lastTimeframe = tf;
}

export function deleteEmployeePeriodSnapshot(tf: EmployeePeriodTimeframe): void {
  store.delete(employeePeriodSwrKey(tf));
}

export function clearEmployeePeriodSwrStore(): void {
  store.clear();
  liveSettled = false;
  lastTimeframe = "today";
}
