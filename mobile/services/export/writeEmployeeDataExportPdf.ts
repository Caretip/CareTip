import * as Print from "expo-print";
import {
  buildEmployeeDataExportHtml,
  dataExportPdfFileName,
  type EmployeeDataExportPdfLocale,
} from "@/services/export/buildEmployeeDataExportHtml";
import {
  parseEmployeeDataExport,
  type EmployeeDataExportPayload,
} from "@/services/export/employeeDataExportTypes";
import { resolveCacheDirectory } from "@/services/share/tempFiles";

/**
 * Generate a human-readable CareTip PDF from the authorized employee export JSON.
 * Does not call the network — caller must already have fetched /api/employees/me/export.
 */
export async function writeEmployeeDataExportPdf(options: {
  data: unknown;
  locale?: EmployeeDataExportPdfLocale;
}): Promise<{ fileUri: string; fileName: string; payload: EmployeeDataExportPayload }> {
  const payload = parseEmployeeDataExport(options.data);
  const locale = options.locale ?? "en";
  const html = buildEmployeeDataExportHtml(payload, locale);
  const fileName = dataExportPdfFileName(payload.exportedAt);

  const printed = await Print.printToFileAsync({ html });
  if (!printed.uri) {
    throw new Error("PDF generation failed.");
  }

  const FileSystem = await import("expo-file-system/legacy");
  const dir = await resolveCacheDirectory();
  const dest = `${dir}${fileName}`;
  try {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  } catch {
    // Best-effort replace.
  }
  await FileSystem.copyAsync({ from: printed.uri, to: dest });
  try {
    await FileSystem.deleteAsync(printed.uri, { idempotent: true });
  } catch {
    // Ignore temp cleanup failures.
  }

  return { fileUri: dest, fileName, payload };
}
