import type { EmployeeSelfAssignment } from "./api";

export type EmployeeTipLocation = {
  id: string;
  name: string;
};

/**
 * Every distinct tip location on the employee's existing assignment.
 * The primary location comes first. Table locations are appended and never replace it.
 */
export function employeeTipLocations(
  assignment: EmployeeSelfAssignment | null | undefined,
): EmployeeTipLocation[] {
  if (!assignment) return [];
  const seen = new Map<string, string>();
  const primaryName = assignment.location?.name?.trim() ?? "";
  if (assignment.location?.id && primaryName) {
    seen.set(assignment.location.id, primaryName);
  }
  for (const table of assignment.tables ?? []) {
    const name = table.location?.name?.trim() ?? "";
    if (table.location?.id && name && !seen.has(table.location.id)) {
      seen.set(table.location.id, name);
    }
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}
