import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import { shareJsonExport, type ShareOutcome } from "@/services/share";
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

export async function downloadEmployeeDataExport(options?: {
  dialogTitle?: string;
}): Promise<ShareOutcome> {
  const { data } = await apiClient.get<unknown>(API_ENDPOINTS.employees.meExport);
  const outcome = await shareJsonExport({
    data,
    dialogTitle: options?.dialogTitle ?? "CareTip data export",
  });
  if (outcome === "failed" || outcome === "unavailable") {
    throw new Error("SHARE_EXPORT_UNAVAILABLE");
  }
  return outcome;
}

export async function deleteEmployeeAccount(): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.employees.me);
}
