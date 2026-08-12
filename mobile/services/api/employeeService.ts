import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import { writeEmployeeDataExportPdf } from "@/services/export/writeEmployeeDataExportPdf";
import type { EmployeeDataExportPdfLocale } from "@/services/export/buildEmployeeDataExportHtml";
import { sharePdf, cleanupShareTempFiles, type ShareOutcome } from "@/services/share";
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

/**
 * Employee "Download my data":
 * 1) Fetch authorized JSON from GET /api/employees/me/export (unchanged backend contract)
 * 2) Render a human-readable PDF on-device
 * 3) Open the native share sheet (save/share) — does not auto-save without user action
 */
export async function downloadEmployeeDataExport(options?: {
  dialogTitle?: string;
  locale?: EmployeeDataExportPdfLocale;
}): Promise<ShareOutcome> {
  const { data } = await apiClient.get<unknown>(API_ENDPOINTS.employees.meExport);
  await cleanupShareTempFiles({ includeExport: true });
  const { fileUri } = await writeEmployeeDataExportPdf({
    data,
    locale: options?.locale,
  });

  const outcome = await sharePdf({
    fileUri,
    dialogTitle: options?.dialogTitle ?? "CareTip data export",
    deleteAfterShare: false,
  });

  if (outcome === "failed" || outcome === "unavailable") {
    throw new Error("SHARE_EXPORT_UNAVAILABLE");
  }
  return outcome;
}

export async function deleteEmployeeAccount(): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.employees.me);
}
