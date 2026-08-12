/**
 * Employee human-readable data-export PDF (mobile) — pure helpers.
 *
 *   npm run test:data-export
 *   npx tsx scripts/data-export-pdf-runtime.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEmployeeDataExportHtml,
  dataExportPdfFileName,
  escapeHtml,
  formatExportDate,
} from "../services/export/buildEmployeeDataExportHtml";
import { parseEmployeeDataExport } from "../services/export/employeeDataExportTypes";
import { isCareTipDataExportCacheFile } from "../services/share/tempFiles";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

function main(): void {
  assert.equal(dataExportPdfFileName("2026-08-12T10:00:00.000Z"), "caretip-my-data-2026-08-12.pdf");
  assert.match(dataExportPdfFileName(), /^caretip-my-data-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.equal(isCareTipDataExportCacheFile("caretip-my-data-2026-08-12.pdf"), true);
  assert.equal(isCareTipDataExportCacheFile("caretip-data-export.json"), true);
  assert.equal(isCareTipDataExportCacheFile("other.pdf"), false);

  assert.equal(formatExportDate("2026-08-01T12:00:00.000Z", "en"), "1 August 2026");
  assert.match(formatExportDate("2026-08-01T12:00:00.000Z", "de"), /August 2026/);

  assert.equal(escapeHtml(`A <B> & "x"`), "A &lt;B&gt; &amp; &quot;x&quot;");

  const payload = parseEmployeeDataExport({
    exportedAt: "2026-08-12T09:00:00.000Z",
    profile: {
      name: "Ada <Tip>",
      email: "ada@caretip.de",
      jobTitle: "Server",
      bio: null,
      monthlyGoal: 500,
      accountCreatedAt: "2025-01-15T00:00:00.000Z",
    },
    tips: [
      { id: "tip-secret-1", amount: 10, createdAt: "2026-08-01T10:00:00.000Z" },
      { id: "tip-secret-2", amount: 35.5, createdAt: "2026-07-22T10:00:00.000Z" },
    ],
  });

  assert.equal(payload.tips.length, 2);
  assert.equal(payload.profile.name, "Ada <Tip>");

  const html = buildEmployeeDataExportHtml(payload, "en");
  assert.match(html, /CareTip — My Data Export/);
  assert.match(html, /My Profile/);
  assert.match(html, /My Tips/);
  assert.match(html, /Total Tips/);
  assert.match(html, /€10\.00/);
  assert.match(html, /€35\.50/);
  assert.match(html, /€45\.50/);
  assert.match(html, /Ada &lt;Tip&gt;/);
  assert.doesNotMatch(html, /tip-secret/);
  assert.doesNotMatch(html, /"id"/);
  assert.doesNotMatch(html, /createdAt/);
  assert.doesNotMatch(html, /\{[\s\S]*"tips"/);

  const emptyHtml = buildEmployeeDataExportHtml(
    parseEmployeeDataExport({
      exportedAt: "2026-08-12T09:00:00.000Z",
      profile: { name: "Sam", email: "sam@caretip.de" },
      tips: [],
    }),
    "en",
  );
  assert.match(emptyHtml, /No tips recorded/);
  assert.match(emptyHtml, /€0\.00/);

  const service = read("services/api/employeeService.ts");
  assert.match(service, /API_ENDPOINTS\.employees\.meExport/);
  assert.match(service, /writeEmployeeDataExportPdf/);
  assert.match(service, /sharePdf/);
  assert.doesNotMatch(service, /shareJsonExport/);

  const screen = read("features/settings/sections/EmployeePrivacyDataSettingsScreen.tsx");
  assert.match(screen, /downloadEmployeeDataExport/);
  assert.match(screen, /exportStarted/);

  const businessMenu = read("features/settings/settingsMenuConfig.ts");
  const businessOnly = businessMenu.slice(
    businessMenu.indexOf("export function buildBusinessSettingsMenu"),
    businessMenu.indexOf("export function buildEmployeeSettingsMenu"),
  );
  assert.doesNotMatch(businessOnly, /privacy-data/);
  assert.doesNotMatch(businessOnly, /privacyData/);
  assert.match(businessOnly, /settings\.privacy/);

  const employeeOnly = businessMenu.slice(
    businessMenu.indexOf("export function buildEmployeeSettingsMenu"),
  );
  assert.match(employeeOnly, /privacy-data/);
  assert.match(employeeOnly, /privacyData/);

  const backendRoute = fs.readFileSync(
    path.join(mobileRoot, "..", "backend", "src", "routes", "employee.routes.ts"),
    "utf8",
  );
  assert.match(backendRoute, /\/me\/export/);
  assert.match(backendRoute, /requireRole\(Role\.EMPLOYEE\)/);

  console.log("data-export-pdf-runtime: OK");
}

main();
