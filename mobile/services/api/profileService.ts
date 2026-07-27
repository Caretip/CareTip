/** Thin API wrappers — no business logic. */

export { fetchBusinessProfile, fetchBusinessStats } from "@/services/api/businessService";
export { fetchEmployeeProfile, fetchEmployeeTips } from "@/services/api/employeeService";

// Back-compat alias used by Phase 1 stores.
export { fetchEmployeeProfile as fetchEmployeeMe } from "@/services/api/employeeService";
