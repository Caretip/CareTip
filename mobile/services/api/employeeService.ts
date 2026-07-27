import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { EmployeeProfile, EmployeeTimeframe, EmployeeTipsStats } from "@/types/employee";

export async function fetchEmployeeProfile(): Promise<EmployeeProfile> {
  const { data } = await apiClient.get<EmployeeProfile>(API_ENDPOINTS.employees.me);
  return data;
}

export async function fetchEmployeeTips(
  timeframe: EmployeeTimeframe = "week",
): Promise<EmployeeTipsStats> {
  // Match web employee dashboard: summary is allowed on all tiers and avoids
  // the heavy scope=full analytics path that often times out on device.
  const { data } = await apiClient.get<EmployeeTipsStats>(API_ENDPOINTS.employees.tips, {
    params: { timeframe, scope: "summary" },
  });
  return data;
}
