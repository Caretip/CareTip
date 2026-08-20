import { formatEur } from "../../utils/format";
import type { EmployeeDataExportPayload } from "./employeeDataExportTypes";

export type EmployeeDataExportPdfLocale = "en" | "de";

type PdfCopy = {
  title: string;
  exportDate: string;
  profileHeading: string;
  name: string;
  email: string;
  jobTitle: string;
  bio: string;
  monthlyGoal: string;
  accountCreated: string;
  tipsHeading: string;
  dateColumn: string;
  amountColumn: string;
  noTips: string;
  totalTips: string;
  emptyValue: string;
};

const COPY: Record<EmployeeDataExportPdfLocale, PdfCopy> = {
  en: {
    title: "CareTip: My Data Export",
    exportDate: "Export date",
    profileHeading: "My Profile",
    name: "Name",
    email: "Email",
    jobTitle: "Job title",
    bio: "Bio",
    monthlyGoal: "Monthly tip goal",
    accountCreated: "Account created",
    tipsHeading: "My Tips",
    dateColumn: "Date",
    amountColumn: "Tip amount",
    noTips: "No tips recorded.",
    totalTips: "Total Tips",
    emptyValue: "—",
  },
  de: {
    title: "CareTip: Mein Datenexport",
    exportDate: "Exportdatum",
    profileHeading: "Mein Profil",
    name: "Name",
    email: "E-Mail",
    jobTitle: "Jobtitel",
    bio: "Bio",
    monthlyGoal: "Monatliches Trinkgeld-Ziel",
    accountCreated: "Konto erstellt",
    tipsHeading: "Meine Trinkgelder",
    dateColumn: "Datum",
    amountColumn: "Betrag",
    noTips: "Keine Trinkgelder vorhanden.",
    totalTips: "Trinkgelder gesamt",
    emptyValue: "—",
  },
};

/** Human-readable calendar date for export PDFs. */
export function formatExportDate(iso: string, locale: EmployeeDataExportPdfLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function dataExportPdfFileName(exportedAtIso?: string): string {
  const source = exportedAtIso ? new Date(exportedAtIso) : new Date();
  const date = Number.isNaN(source.getTime()) ? new Date() : source;
  const yyyyMmDd = date.toISOString().slice(0, 10);
  return `caretip-my-data-${yyyyMmDd}.pdf`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function displayOrDash(value: string | null | undefined, emptyValue: string): string {
  return value && value.trim() ? escapeHtml(value.trim()) : emptyValue;
}

/**
 * Build HTML for expo-print. No tip IDs, no raw JSON, no debug fields.
 * Currency uses CareTip euro formatting (export API has no currency field).
 */
export function buildEmployeeDataExportHtml(
  payload: EmployeeDataExportPayload,
  locale: EmployeeDataExportPdfLocale = "en",
): string {
  const copy = COPY[locale];
  const total = payload.tips.reduce((sum, tip) => sum + tip.amount, 0);
  const tipRows =
    payload.tips.length === 0
      ? `<tr><td colspan="2">${escapeHtml(copy.noTips)}</td></tr>`
      : payload.tips
          .map(
            (tip) => `<tr>
              <td>${escapeHtml(formatExportDate(tip.createdAt, locale))}</td>
              <td class="amount">${escapeHtml(formatEur(tip.amount))}</td>
            </tr>`,
          )
          .join("\n");

  const monthlyGoal =
    payload.profile.monthlyGoal == null
      ? copy.emptyValue
      : escapeHtml(formatEur(payload.profile.monthlyGoal));

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(copy.title)}</title>
  <style>
    @page { margin: 48px 40px; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: #0B1220;
      font-size: 12px;
      line-height: 1.45;
    }
    h1 {
      font-size: 22px;
      margin: 0 0 8px;
      color: #0B1220;
    }
    .meta {
      color: #5B6577;
      margin-bottom: 28px;
    }
    h2 {
      font-size: 15px;
      margin: 24px 0 10px;
      padding-bottom: 4px;
      border-bottom: 1px solid #E5E7EB;
      color: #0B1220;
    }
    .row {
      display: flex;
      gap: 12px;
      margin: 6px 0;
    }
    .label {
      width: 140px;
      flex-shrink: 0;
      color: #5B6577;
      font-weight: 600;
    }
    .value {
      flex: 1;
      word-break: break-word;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }
    th, td {
      text-align: left;
      padding: 8px 6px;
      border-bottom: 1px solid #EEF0F3;
      vertical-align: top;
    }
    th {
      color: #5B6577;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    td.amount, th.amount {
      text-align: right;
      white-space: nowrap;
    }
    .total {
      margin-top: 18px;
      font-size: 14px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(copy.title)}</h1>
  <p class="meta">${escapeHtml(copy.exportDate)}: ${escapeHtml(
    formatExportDate(payload.exportedAt, locale),
  )}</p>

  <h2>${escapeHtml(copy.profileHeading)}</h2>
  <div class="row"><div class="label">${escapeHtml(copy.name)}</div><div class="value">${displayOrDash(
    payload.profile.name,
    copy.emptyValue,
  )}</div></div>
  <div class="row"><div class="label">${escapeHtml(copy.email)}</div><div class="value">${displayOrDash(
    payload.profile.email,
    copy.emptyValue,
  )}</div></div>
  <div class="row"><div class="label">${escapeHtml(copy.jobTitle)}</div><div class="value">${displayOrDash(
    payload.profile.jobTitle,
    copy.emptyValue,
  )}</div></div>
  <div class="row"><div class="label">${escapeHtml(copy.bio)}</div><div class="value">${displayOrDash(
    payload.profile.bio,
    copy.emptyValue,
  )}</div></div>
  <div class="row"><div class="label">${escapeHtml(copy.monthlyGoal)}</div><div class="value">${monthlyGoal}</div></div>
  <div class="row"><div class="label">${escapeHtml(copy.accountCreated)}</div><div class="value">${
    payload.profile.accountCreatedAt
      ? escapeHtml(formatExportDate(payload.profile.accountCreatedAt, locale))
      : copy.emptyValue
  }</div></div>

  <h2>${escapeHtml(copy.tipsHeading)}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(copy.dateColumn)}</th>
        <th class="amount">${escapeHtml(copy.amountColumn)}</th>
      </tr>
    </thead>
    <tbody>
      ${tipRows}
    </tbody>
  </table>

  <p class="total">${escapeHtml(copy.totalTips)}: ${escapeHtml(formatEur(total))}</p>
</body>
</html>`;
}
