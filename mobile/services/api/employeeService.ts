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

export async function downloadEmployeeDataExport(): Promise<void> {
  const { data } = await apiClient.get<unknown>(API_ENDPOINTS.employees.meExport);
  const { shareAsync, isAvailableAsync } = await import("expo-sharing");
  const FileSystem = await import("expo-file-system/legacy");
  const path = `${FileSystem.cacheDirectory ?? ""}caretip-data-export.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2));
  if (await isAvailableAsync()) {
    await shareAsync(path, { mimeType: "application/json", dialogTitle: "CareTip data export" });
  }
}

export async function deleteEmployeeAccount(): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.employees.me);
}
